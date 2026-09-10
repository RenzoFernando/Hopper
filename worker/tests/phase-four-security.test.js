import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.ts";
import { base64UrlEncodeBytes, sha256Bytes } from "../src/lib/crypto.ts";
import {
  createSessionToken,
  getSessionVersion,
  verifyConfiguredPin,
  writePinCredentials
} from "../src/services/security.ts";
import { createRoom } from "../src/services/rooms.ts";
import { TestD1 } from "../../tests/d1-test-helper.js";

const schema = readFileSync(new URL("../migrations/0001_baseline.sql", import.meta.url), "utf8");
const origin = "https://hopper.pages.dev";
const secret = "hopper-phase-four-session-secret-2026-abcdefghijklmnopqrstuvwxyz";

function createEnv() {
  return {
    DB: new TestD1(schema),
    SESSION_SECRET: secret,
    ALLOWED_ORIGINS: origin
  };
}

function request(path, { method = "GET", token = "", body, requestOrigin = origin } = {}) {
  const headers = {
    Origin: requestOrigin,
    "CF-Connecting-IP": "198.51.100.80"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return new Request(`https://hopper-api.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function responseJson(response) {
  return response.json();
}

async function seedRecoveryToken(db, token, expiresAt) {
  const hash = base64UrlEncodeBytes(await sha256Bytes(token));
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO recovery_tokens (
      id, token_hash, created_at, expires_at, requested_ip
    ) VALUES (?1, ?2, ?3, ?4, ?5)
  `).bind(crypto.randomUUID(), hash, now, expiresAt, "198.51.100.80").run();
}

test("PIN incorrecto se rechaza y las respuestas incluyen cabeceras de seguridad", async () => {
  const env = createEnv();

  try {
    await writePinCredentials(env.DB, "1234", env);
    const response = await worker.fetch(request("/api/auth/login", {
      method: "POST",
      body: { pin: "9999" }
    }), env);
    const body = await responseJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.status, "invalid-pin");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("X-Frame-Options"), "DENY");
    assert.match(response.headers.get("Content-Security-Policy") || "", /frame-ancestors 'none'/);
  } finally {
    env.DB.close();
  }
});

test("cambio de PIN exige PIN actual e invalida la sesión anterior", async () => {
  const env = createEnv();

  try {
    await writePinCredentials(env.DB, "1234", env);
    const token = await createSessionToken(secret, await getSessionVersion(env.DB));

    const denied = await worker.fetch(request("/api/admin/pin", {
      method: "POST",
      token,
      body: { currentPin: "0000", pin: "2468", confirmation: "2468" }
    }), env);
    assert.equal(denied.status, 403);
    assert.equal((await responseJson(denied)).code, "reauthentication-failed");

    const changed = await worker.fetch(request("/api/admin/pin", {
      method: "POST",
      token,
      body: { currentPin: "1234", pin: "2468", confirmation: "2468" }
    }), env);
    assert.equal(changed.status, 200);
    assert.equal((await responseJson(changed)).status, "updated");
    assert.equal(await verifyConfiguredPin(env, "2468"), true);

    const oldSession = await worker.fetch(request("/api/admin/usage", { token }), env);
    assert.equal(oldSession.status, 401);
  } finally {
    env.DB.close();
  }
});

test("recuperación rechaza tokens reutilizados y expirados", async () => {
  const env = createEnv();

  try {
    await writePinCredentials(env.DB, "1234", env);
    const validToken = "A".repeat(43);
    await seedRecoveryToken(env.DB, validToken, new Date(Date.now() + 60_000).toISOString());

    const first = await worker.fetch(request("/api/recovery/reset", {
      method: "POST",
      body: { token: validToken, pin: "2468", confirmation: "2468" }
    }), env);
    assert.equal(first.status, 200);
    assert.deepEqual(await responseJson(first), { ok: true, status: "updated" });

    const reused = await worker.fetch(request("/api/recovery/reset", {
      method: "POST",
      body: { token: validToken, pin: "1357", confirmation: "1357" }
    }), env);
    assert.equal(reused.status, 200);
    assert.equal((await responseJson(reused)).status, "used");

    const expiredToken = "B".repeat(43);
    await seedRecoveryToken(env.DB, expiredToken, new Date(Date.now() - 60_000).toISOString());
    const expired = await worker.fetch(request("/api/recovery/verify", {
      method: "POST",
      body: { token: expiredToken }
    }), env);
    assert.equal(expired.status, 200);
    assert.deepEqual(await responseJson(expired), { ok: false, status: "expired" });
  } finally {
    env.DB.close();
  }
});

test("scopes, expiración, reautenticación, uploads y CORS se rechazan correctamente", async () => {
  const env = createEnv();

  try {
    await writePinCredentials(env.DB, "1234", env);
    const personalToken = await createSessionToken(secret, await getSessionVersion(env.DB));
    const created = await createRoom(env, {}, { ip: "198.51.100.80", country: "", userAgent: "" });

    const roomAsPersonal = await worker.fetch(request("/api/admin/usage", { token: created.token }), env);
    assert.equal(roomAsPersonal.status, 401);

    const invalidPersonal = await worker.fetch(request("/api/admin/usage", { token: "invalid.token" }), env);
    assert.equal(invalidPersonal.status, 401);

    const uploadWithoutSession = await worker.fetch(request("/api/uploads/init", {
      method: "POST",
      body: { name: "a.txt", size: 1, mimeType: "text/plain", ttlMinutes: 5 }
    }), env);
    assert.equal(uploadWithoutSession.status, 401);

    const adminWithoutReauth = await worker.fetch(request("/api/admin/reset-system", {
      method: "POST",
      token: personalToken,
      body: { currentPin: "", confirmation: "RESET_SYSTEM" }
    }), env);
    assert.equal(adminWithoutReauth.status, 403);

    await env.DB.prepare(`
      UPDATE rooms
      SET expires_at = ?2
      WHERE id = ?1
    `).bind(created.room.id, new Date(Date.now() - 60_000).toISOString()).run();

    const expiredRoom = await worker.fetch(request("/api/room/status", { token: created.token }), env);
    assert.equal(expiredRoom.status, 401);

    const deniedOrigin = await worker.fetch(request("/api/security/status", {
      requestOrigin: "https://evil.example"
    }), env);
    assert.equal(deniedOrigin.status, 403);
    assert.equal((await responseJson(deniedOrigin)).code, "origin-not-allowed");
  } finally {
    env.DB.close();
  }
});

test("reinicio administrativo falla si B2 no puede confirmar el estado vacío", async () => {
  const env = createEnv();

  try {
    await writePinCredentials(env.DB, "1234", env);
    const token = await createSessionToken(secret, await getSessionVersion(env.DB));
    const response = await worker.fetch(request("/api/admin/reset-system", {
      method: "POST",
      token,
      body: { currentPin: "1234", confirmation: "RESET_SYSTEM" }
    }), env);
    const body = await responseJson(response);

    assert.equal(response.status, 502);
    assert.equal(body.code, "system-reset-incomplete");
  } finally {
    env.DB.close();
  }
});
