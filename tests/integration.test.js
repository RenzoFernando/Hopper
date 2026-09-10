import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../worker/src/index.ts";
import { createSessionToken, verifyConfiguredPin, writePinCredentials } from "../worker/src/services/security.ts";
import { TestD1 } from "./d1-test-helper.js";

const schema = readFileSync(new URL("../worker/migrations/0001_baseline.sql", import.meta.url), "utf8");
const origin = "https://hopper.pages.dev";
const secret = "hopper-integration-session-secret-2026-abcdefghijklmnopqrstuvwxyz";

function request(path, { method = "GET", token = "", body } = {}) {
  const headers = {
    Origin: origin,
    "CF-Connecting-IP": "198.51.100.50"
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

function b2Xml(key, size = 4) {
  return `<?xml version="1.0" encoding="UTF-8"?><ListVersionsResult><IsTruncated>false</IsTruncated><Version><Key>${key}</Key><VersionId>4_zintegration</VersionId><IsLatest>true</IsLatest><LastModified>2026-09-08T15:00:00.000Z</LastModified><ETag>&quot;etag-integration&quot;</ETag><Size>${size}</Size></Version></ListVersionsResult>`;
}

async function json(response) {
  return response.json();
}

test("flujo integrado de sala: crear, unir, transferir, descargar y revocar", async () => {
  const db = new TestD1(schema);
  const env = {
    DB: db,
    SESSION_SECRET: secret,
    ALLOWED_ORIGINS: origin,
    B2_BUCKET_NAME: "hopper-test",
    B2_ENDPOINT: "https://s3.us-east-005.backblazeb2.com",
    B2_KEY_ID: "004testkeyid",
    B2_APPLICATION_KEY: "integration-b2-application-key-abcdefghijklmnopqrstuvwxyz",
    MAX_FILE_BYTES: String(512 * 1024 * 1024)
  };
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      const method = String(init.method || input?.method || "GET").toUpperCase();

      if (url.hostname === "s3.us-east-005.backblazeb2.com" && method === "GET" && url.searchParams.has("versions")) {
        const key = url.searchParams.get("prefix") || "";
        return new Response(b2Xml(key), { status: 200, headers: { "Content-Type": "application/xml" } });
      }

      if (url.hostname === "s3.us-east-005.backblazeb2.com" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Fetch inesperado en integración: ${method} ${url}`);
    };

    const capacityBeforeResponse = await worker.fetch(request("/api/rooms/capacity"), env);
    assert.equal(capacityBeforeResponse.status, 200);
    const capacityBefore = await json(capacityBeforeResponse);
    assert.equal(capacityBefore.available, 2);

    const personalToken = await createSessionToken(secret, 1);
    const createResponse = await worker.fetch(request("/api/rooms", {
      method: "POST",
      body: { ttlMinutes: 60 }
    }), env);
    assert.equal(createResponse.status, 201);
    const created = await json(createResponse);
    assert.match(created.code, /^[A-Z]{2}-\d{4}$/);
    assert.ok(Date.parse(created.room.expiresAt) - Date.now() <= 5 * 60_000 + 2000);
    const capacityAfter = await json(await worker.fetch(request("/api/rooms/capacity"), env));
    assert.equal(capacityAfter.available, 1);

    const joinResponse = await worker.fetch(request("/api/rooms/join", {
      method: "POST",
      body: { code: created.code }
    }), env);
    assert.equal(joinResponse.status, 200);
    const joined = await json(joinResponse);
    const roomToken = joined.token;

    const textResponse = await worker.fetch(request("/api/room/items/text", {
      method: "POST",
      token: roomToken,
      body: { content: "hola integración", ttlMinutes: 60 }
    }), env);
    assert.equal(textResponse.status, 201);
    const textCreated = await json(textResponse);
    assert.equal(textCreated.item.ttlMinutes, 5);

    const beforeActivity = await db.prepare("SELECT expires_at AS expiresAt FROM rooms WHERE id = ?1").bind(created.room.id).first();
    await db.prepare("UPDATE rooms SET expires_at = ?2 WHERE id = ?1").bind(created.room.id, new Date(Date.now() + 20_000).toISOString()).run();
    const activityResponse = await worker.fetch(request("/api/room/activity", { method: "POST", token: roomToken, body: {} }), env);
    assert.equal(activityResponse.status, 200);
    const activity = await json(activityResponse);
    assert.ok(Date.parse(activity.room.expiresAt) > Date.now() + 4 * 60_000);
    assert.ok(beforeActivity.expiresAt);

    const ttlResetResponse = await worker.fetch(request(`/api/room/items/${textCreated.item.id}/ttl`, {
      method: "PATCH", token: roomToken, body: { ttlMinutes: 60 }
    }), env);
    assert.equal(ttlResetResponse.status, 403);
    assert.equal((await json(ttlResetResponse)).code, "room-ttl-fixed");

    const initResponse = await worker.fetch(request("/api/room/uploads/init", {
      method: "POST",
      token: roomToken,
      body: {
        name: "nota.txt",
        size: 4,
        mimeType: "text/plain",
        ttlMinutes: 5
      }
    }), env);
    assert.equal(initResponse.status, 201);
    const initialized = await json(initResponse);
    assert.ok(initialized.upload.uploadUrl.includes("hopper-test"));

    const completeResponse = await worker.fetch(request(`/api/room/uploads/${initialized.upload.id}/complete`, {
      method: "POST",
      token: roomToken,
      body: {}
    }), env);
    assert.equal(completeResponse.status, 200);
    const completed = await json(completeResponse);
    assert.equal(completed.item.name, "nota.txt");
    assert.equal(completed.item.size, 4);

    const listResponse = await worker.fetch(request("/api/room/items", { token: roomToken }), env);
    assert.equal(listResponse.status, 200);
    const listed = await json(listResponse);
    assert.equal(listed.items.length, 2);

    const file = listed.items.find((item) => item.type === "file");
    const downloadResponse = await worker.fetch(request(`/api/room/items/${file.id}/url?mode=download`, { token: roomToken }), env);
    assert.equal(downloadResponse.status, 200);
    const download = await json(downloadResponse);
    assert.ok(download.url.startsWith("https://s3.us-east-005.backblazeb2.com/"));

    const adminOpenResponse = await worker.fetch(request(`/api/admin/rooms/${created.room.id}/session`, {
      method: "POST",
      token: personalToken,
      body: {}
    }), env);
    assert.equal(adminOpenResponse.status, 200);
    assert.ok((await json(adminOpenResponse)).token);

    const closeResponse = await worker.fetch(request(`/api/rooms/${created.room.id}`, {
      method: "DELETE",
      token: personalToken
    }), env);
    assert.equal(closeResponse.status, 200);
    const closed = await json(closeResponse);
    assert.equal(closed.closed, true);
    assert.equal(closed.deleted, 2);

    const revokedResponse = await worker.fetch(request("/api/room/items", { token: roomToken }), env);
    assert.equal(revokedResponse.status, 401);
    const revoked = await json(revokedResponse);
    assert.equal(revoked.code, "invalid-room-session");

    const usageResponse = await worker.fetch(request("/api/admin/usage", { token: personalToken }), env);
    assert.equal(usageResponse.status, 200);
    const usage = await json(usageResponse);
    assert.equal(usage.today.uploadsCount, 2);
    assert.equal(usage.today.roomUploadsCount, 2);
    assert.equal(usage.today.uploadBytes, 4);
    assert.equal(usage.today.deletedCount, 2);
    assert.equal(usage.today.deletedBytes, 4);

    const remaining = await db.prepare("SELECT COUNT(*) AS count FROM drop_items WHERE room_id = ?1").bind(created.room.id).first();
    assert.equal(remaining.count, 0);

    const expiringResponse = await worker.fetch(request("/api/rooms", {
      method: "POST",
      body: {}
    }), env);
    const expiring = await json(expiringResponse);
    const expiringText = await worker.fetch(request("/api/room/items/text", {
      method: "POST",
      token: expiring.token,
      body: { content: "expira", ttlMinutes: 5 }
    }), env);
    assert.equal(expiringText.status, 201);
    const past = new Date(Date.now() - 60_000).toISOString();
    await db.prepare("UPDATE rooms SET expires_at = ?2 WHERE id = ?1").bind(expiring.room.id, past).run();

    const cleanupResponse = await worker.fetch(request("/api/admin/cleanup", {
      method: "POST",
      token: personalToken,
      body: {}
    }), env);
    assert.equal(cleanupResponse.status, 200);
    const cleanup = await json(cleanupResponse);
    assert.equal(cleanup.rooms.closed, 1);
    assert.equal(cleanup.rooms.failed, 0);
    const expiredRoom = await db.prepare("SELECT status FROM rooms WHERE id = ?1").bind(expiring.room.id).first();
    assert.equal(expiredRoom.status, "closed");
    const expiredItems = await db.prepare("SELECT COUNT(*) AS count FROM drop_items WHERE room_id = ?1").bind(expiring.room.id).first();
    assert.equal(expiredItems.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("Administración cambia el PIN y reinicia el estado temporal sin perder el PIN", async () => {
  const db = new TestD1(schema);
  const env = {
    DB: db,
    SESSION_SECRET: secret,
    ALLOWED_ORIGINS: origin,
    B2_BUCKET_NAME: "hopper-test",
    B2_ENDPOINT: "https://s3.us-east-005.backblazeb2.com",
    B2_KEY_ID: "004testkeyid",
    B2_APPLICATION_KEY: "integration-b2-application-key-abcdefghijklmnopqrstuvwxyz"
  };
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      const method = String(init.method || input?.method || "GET").toUpperCase();

      if (url.hostname === "s3.us-east-005.backblazeb2.com" && method === "GET" && url.searchParams.has("versions")) {
        return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><ListVersionsResult><IsTruncated>false</IsTruncated></ListVersionsResult>", {
          status: 200,
          headers: { "Content-Type": "application/xml" }
        });
      }

      if (url.hostname === "s3.us-east-005.backblazeb2.com" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Fetch inesperado en reinicio: ${method} ${url}`);
    };
    await writePinCredentials(db, "1234", env);
    const initialToken = await createSessionToken(secret, 1);
    const changePinResponse = await worker.fetch(request("/api/admin/pin", {
      method: "POST",
      token: initialToken,
      body: { currentPin: "1234", pin: "2468", confirmation: "2468" }
    }), env);
    assert.equal(changePinResponse.status, 200);
    assert.equal((await json(changePinResponse)).status, "updated");

    const revokedInitialResponse = await worker.fetch(request("/api/admin/usage", { token: initialToken }), env);
    assert.equal(revokedInitialResponse.status, 401);

    assert.equal(await verifyConfiguredPin(env, "2468"), true);
    const sessionAfterPinChange = await db.prepare("SELECT version FROM session_state WHERE id = 1").first();
    const personalToken = await createSessionToken(secret, Number(sessionAfterPinChange.version));

    const personalTextResponse = await worker.fetch(request("/api/items/text", {
      method: "POST",
      token: personalToken,
      body: { content: "temporal personal", ttlMinutes: 30 }
    }), env);
    assert.equal(personalTextResponse.status, 201);

    const roomResponse = await worker.fetch(request("/api/rooms", {
      method: "POST",
      body: {}
    }), env);
    assert.equal(roomResponse.status, 201);
    const room = await json(roomResponse);

    const roomTextResponse = await worker.fetch(request("/api/room/items/text", {
      method: "POST",
      token: room.token,
      body: { content: "temporal sala", ttlMinutes: 5 }
    }), env);
    assert.equal(roomTextResponse.status, 201);

    const resetResponse = await worker.fetch(request("/api/admin/reset-system", {
      method: "POST",
      token: personalToken,
      body: { currentPin: "2468", confirmation: "RESET_SYSTEM" }
    }), env);
    assert.equal(resetResponse.status, 200);
    const reset = await json(resetResponse);
    assert.equal(reset.status, "reset");
    assert.equal(reset.failed, 0);

    const remainingItems = await db.prepare("SELECT COUNT(*) AS count FROM drop_items").first();
    assert.equal(remainingItems.count, 0);
    const activeRooms = await db.prepare("SELECT COUNT(*) AS count FROM rooms WHERE status = 'active'").first();
    assert.equal(activeRooms.count, 0);

    const revokedPersonalResponse = await worker.fetch(request("/api/admin/usage", { token: personalToken }), env);
    assert.equal(revokedPersonalResponse.status, 401);
    const revokedRoomResponse = await worker.fetch(request("/api/room/status", { token: room.token }), env);
    assert.equal(revokedRoomResponse.status, 401);

    assert.equal(await verifyConfiguredPin(env, "2468"), true);
    const sessionAfterReset = await db.prepare("SELECT version FROM session_state WHERE id = 1").first();
    assert.ok(Number(sessionAfterReset.version) > Number(sessionAfterPinChange.version));
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});