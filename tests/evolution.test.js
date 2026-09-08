import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STORAGE_INTERNAL_LIMIT_BYTES
} from "../cloudflare/src/constants.js";
import {
  createTextItem,
  initializeFileUpload,
  listActiveItems
} from "../cloudflare/src/items.js";
import {
  closeRoom,
  createRoom,
  createRoomSessionToken,
  hashRoomCode,
  joinRoom,
  requireRoomRequest,
  verifyRoomSessionToken
} from "../cloudflare/src/rooms.js";
import { getTodayUsage } from "../cloudflare/src/usage.js";
import { TestD1 } from "./d1-test-helper.js";

const schema = readFileSync(new URL("../cloudflare/schema.sql", import.meta.url), "utf8");
const secret = "hopper-test-session-secret-2026-abcdefghijklmnopqrstuvwxyz";

function createEnv() {
  return { DB: new TestD1(schema), SESSION_SECRET: secret };
}

test("genera códigos de sala, guarda hash y emite tokens firmados", async () => {
  const env = createEnv();

  try {
    const created = await createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.10" });
    assert.match(created.code, /^[A-Z]{2}-\d{4}$/);
    assert.equal(created.room.status, "active");
    assert.equal(created.room.maxItems, 25);
    const raw = await env.DB.prepare("SELECT code_hash AS codeHash FROM rooms WHERE id = ?1").bind(created.room.id).first();
    assert.notEqual(raw.codeHash, created.code);
    assert.equal(raw.codeHash, await hashRoomCode(created.code, secret));
    const payload = await verifyRoomSessionToken(created.token, secret);
    assert.equal(payload.rid, created.room.id);
    assert.equal(payload.ver, 1);
    const joined = await joinRoom(env, created.code);
    assert.equal(joined.room.id, created.room.id);
    assert.ok(await verifyRoomSessionToken(joined.token, secret));
  } finally {
    env.DB.close();
  }
});

test("limita a dos salas y revoca de inmediato los tokens al cerrar", async () => {
  const env = createEnv();

  try {
    const first = await createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.11" });
    await createRoom(env, { ttlMinutes: 15 }, { ip: "198.51.100.11" });
    await assert.rejects(
      () => createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.11" }),
      (error) => error?.code === "room-limit"
    );
    const request = new Request("https://example.test/api/room/status", {
      headers: { Authorization: `Bearer ${first.token}` }
    });
    const active = await requireRoomRequest(request, env);
    assert.equal(active.room.id, first.room.id);
    await closeRoom(env, first.room.id);
    await assert.rejects(
      () => requireRoomRequest(request, env),
      (error) => error?.code === "invalid-room-session"
    );
  } finally {
    env.DB.close();
  }
});

test("mantiene el máximo de dos salas ante creaciones concurrentes", async () => {
  const env = createEnv();

  try {
    const results = await Promise.allSettled([
      createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.21" }),
      createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.22" }),
      createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.23" })
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    const active = await env.DB.prepare("SELECT COUNT(*) AS count FROM rooms WHERE status = 'active'").first();
    assert.equal(fulfilled.length, 2);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason?.code, "room-limit");
    assert.equal(active.count, 2);
  } finally {
    env.DB.close();
  }
});

test("aísla los scopes personal y sala, limita elementos y recorta expiración", async () => {
  const env = createEnv();

  try {
    const roomResult = await createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.12" });
    const personal = await createTextItem(env, { content: "personal", ttlMinutes: 5 });
    const roomContext = {
      spaceType: "room",
      roomId: roomResult.room.id,
      roomExpiresAt: new Date(Date.now() + 90_000).toISOString(),
      maxFileBytes: roomResult.room.maxFileBytes,
      maxBytes: roomResult.room.maxBytes,
      maxItems: 1,
      ttlOptions: [5, 15, 30, 60]
    };
    const roomItem = await createTextItem(env, { content: "sala", ttlMinutes: 60 }, roomContext);
    assert.ok(Date.parse(roomItem.expiresAt) <= Date.parse(roomContext.roomExpiresAt));
    const personalItems = await listActiveItems(env);
    const roomItems = await listActiveItems(env, roomContext);
    assert.deepEqual(personalItems.map((item) => item.id), [personal.id]);
    assert.deepEqual(roomItems.map((item) => item.id), [roomItem.id]);
    await assert.rejects(
      () => createTextItem(env, { content: "segundo", ttlMinutes: 5 }, roomContext),
      (error) => error?.code === "room-item-limit"
    );
    const usage = await getTodayUsage(env.DB);
    assert.equal(usage.uploadsCount, 2);
    assert.equal(usage.textCount, 2);
    assert.equal(usage.roomUploadsCount, 1);
  } finally {
    env.DB.close();
  }
});

test("bloquea una carga antes de firmar URL cuando supera el límite interno", async () => {
  const env = createEnv();

  try {
    const now = new Date();
    await env.DB.prepare(`
      INSERT INTO drop_items (
        id, type, status, name, size, mime_type, storage_key,
        created_at, expires_at, ttl_minutes, updated_at, space_type, room_id
      ) VALUES (?1, 'file', 'pending', 'ocupado.bin', ?2, 'application/octet-stream', ?3, ?4, ?5, 5, ?4, 'personal', NULL)
    `).bind(
      crypto.randomUUID(),
      STORAGE_INTERNAL_LIMIT_BYTES,
      `drop/personal/${crypto.randomUUID()}/ocupado.bin`,
      now.toISOString(),
      new Date(now.getTime() + 300_000).toISOString()
    ).run();
    await assert.rejects(
      () => initializeFileUpload(env, {
        name: "nuevo.bin",
        size: 1,
        mimeType: "application/octet-stream",
        ttlMinutes: 5
      }),
      (error) => error?.code === "storage-limit" && error?.status === 507
    );
  } finally {
    env.DB.close();
  }
});

test("rechaza tokens de sala alterados y expirados", async () => {
  const room = {
    id: crypto.randomUUID(),
    version: 3,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
  const token = await createRoomSessionToken(secret, room, Date.now());
  assert.ok(await verifyRoomSessionToken(token, secret));
  const altered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.equal(await verifyRoomSessionToken(altered, secret), null);
  assert.equal(await verifyRoomSessionToken(token, secret, Date.now() + 120_000), null);
});
