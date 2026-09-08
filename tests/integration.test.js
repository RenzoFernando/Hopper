import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../cloudflare/src/index.js";
import { createSessionToken } from "../cloudflare/src/security.js";
import { TestD1 } from "./d1-test-helper.js";

const schema = readFileSync(new URL("../cloudflare/schema.sql", import.meta.url), "utf8");
const origin = "https://renzofernando.github.io";
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

    const personalToken = await createSessionToken(secret, 1);
    const createResponse = await worker.fetch(request("/api/rooms", {
      method: "POST",
      token: personalToken,
      body: { ttlMinutes: 5 }
    }), env);
    assert.equal(createResponse.status, 201);
    const created = await json(createResponse);
    assert.match(created.code, /^[A-Z]{2}-\d{4}$/);

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
      body: { content: "hola integración", ttlMinutes: 5 }
    }), env);
    assert.equal(textResponse.status, 201);

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
      token: personalToken,
      body: { ttlMinutes: 5 }
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
