import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROOM_SESSION_TTL_SECONDS,
  STORAGE_INTERNAL_LIMIT_BYTES
} from "../worker/src/lib/constants.ts";
import {
  createTextItem,
  initializeFileUpload,
  listActiveItems,
  resetItemTtl
} from "../worker/src/services/items.ts";
import {
  cleanupExpiredRooms,
  closeRoom,
  createRoom,
  createRoomSessionToken,
  getRoomCapacity,
  hashRoomCode,
  joinRoom,
  requireRoomRequest,
  touchRoomActivity,
  verifyRoomSessionToken
} from "../worker/src/services/rooms.ts";
import { getTodayUsage } from "../worker/src/services/usage.ts";
import { TestD1 } from "./d1-test-helper.js";

const baseline = readFileSync(new URL("../worker/migrations/0001_baseline.sql", import.meta.url), "utf8");
const tuning = readFileSync(new URL("../worker/migrations/0002_product_tuning.sql", import.meta.url), "utf8");
const schema = `${baseline}\n${tuning}`;
const secret = "hopper-test-session-secret-2026-abcdefghijklmnopqrstuvwxyz";

function createEnv() {
  return { DB: new TestD1(schema), SESSION_SECRET: secret };
}

test("genera códigos de sala, guarda hash y emite tokens firmados", async () => {
  const env = createEnv();

  try {
    env.ROOM_MAX_FILE_BYTES = String(1024 * 1024 * 1024);
    env.ROOM_MAX_BYTES = String(2 * 1024 * 1024 * 1024);
    const created = await createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.10" });
    assert.match(created.code, /^[A-Z]{2}-\d{4}$/);
    assert.equal(created.room.status, "active");
    assert.equal(created.room.maxFileBytes, 256 * 1024 * 1024);
    assert.equal(created.room.maxBytes, 512 * 1024 * 1024);
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

test("limita a tres salas y revoca de inmediato los tokens al cerrar", async () => {
  const env = createEnv();

  try {
    const first = await createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.11" });
    const second = await createRoom(env, { ttlMinutes: 15 }, { ip: "198.51.100.11" });
    const third = await createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.11" });
    assert.ok(Date.parse(second.room.expiresAt) - Date.now() <= 10 * 60_000 + 2000);
    assert.equal(third.room.status, "active");
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

test("mantiene el máximo de tres salas ante creaciones concurrentes", async () => {
  const env = createEnv();

  try {
    const results = await Promise.allSettled([
      createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.21" }),
      createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.22" }),
      createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.23" }),
      createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.24" })
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    const active = await env.DB.prepare("SELECT COUNT(*) AS count FROM rooms WHERE status = 'active'").first();
    assert.equal(fulfilled.length, 3);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason?.code, "room-limit");
    assert.equal(active.count, 3);
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
      ttlOptions: [10]
    };
    const roomItem = await createTextItem(env, { content: "sala", ttlMinutes: 10 }, roomContext);
    assert.ok(Date.parse(roomItem.expiresAt) <= Date.parse(roomContext.roomExpiresAt));
    const personalItems = await listActiveItems(env);
    const roomItems = await listActiveItems(env, roomContext);
    assert.deepEqual(personalItems.map((item) => item.id), [personal.id]);
    assert.deepEqual(roomItems.map((item) => item.id), [roomItem.id]);
    await assert.rejects(
      () => createTextItem(env, { content: "segundo", ttlMinutes: 10 }, roomContext),
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

test("aplica límites de sala de forma atómica ante operaciones concurrentes", async () => {
  const env = {
    DB: new TestD1(schema),
    SESSION_SECRET: secret,
    B2_BUCKET_NAME: "hopper-test",
    B2_ENDPOINT: "https://s3.us-east-005.backblazeb2.com",
    B2_KEY_ID: "004testkeyid",
    B2_APPLICATION_KEY: "test-b2-application-key-abcdefghijklmnopqrstuvwxyz"
  };

  try {
    const roomResult = await createRoom(env, { ttlMinutes: 5 }, { ip: "198.51.100.30" });
    const textContext = {
      spaceType: "room",
      roomId: roomResult.room.id,
      roomExpiresAt: roomResult.room.expiresAt,
      maxFileBytes: roomResult.room.maxFileBytes,
      maxBytes: roomResult.room.maxBytes,
      maxItems: 1,
      ttlOptions: [10]
    };
    const texts = await Promise.allSettled([
      createTextItem(env, { content: "uno", ttlMinutes: 10 }, textContext),
      createTextItem(env, { content: "dos", ttlMinutes: 10 }, textContext)
    ]);
    assert.equal(texts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(texts.filter((result) => result.status === "rejected")[0].reason?.code, "room-item-limit");

    await env.DB.prepare("DELETE FROM drop_items WHERE room_id = ?1").bind(roomResult.room.id).run();
    const fileContext = {
      ...textContext,
      maxItems: 25,
      maxBytes: 10
    };
    const uploads = await Promise.allSettled([
      initializeFileUpload(env, { name: "a.bin", size: 6, mimeType: "application/octet-stream", ttlMinutes: 10 }, fileContext),
      initializeFileUpload(env, { name: "b.bin", size: 6, mimeType: "application/octet-stream", ttlMinutes: 10 }, fileContext)
    ]);
    assert.equal(uploads.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(uploads.filter((result) => result.status === "rejected")[0].reason?.code, "room-storage-limit");
    const usage = await env.DB.prepare(`
      SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS count
      FROM drop_items
      WHERE room_id = ?1 AND status IN ('pending', 'ready')
    `).bind(roomResult.room.id).first();
    assert.equal(usage.bytes, 6);
    assert.equal(usage.count, 1);
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

test("mantiene el guardarraíl global ante reservas concurrentes", async () => {
  const env = {
    DB: new TestD1(schema),
    SESSION_SECRET: secret,
    B2_BUCKET_NAME: "hopper-test",
    B2_ENDPOINT: "https://s3.us-east-005.backblazeb2.com",
    B2_KEY_ID: "004testkeyid",
    B2_APPLICATION_KEY: "test-b2-application-key-abcdefghijklmnopqrstuvwxyz"
  };

  try {
    const now = new Date();
    await env.DB.prepare(`
      INSERT INTO drop_items (
        id, type, status, name, size, mime_type, storage_key,
        created_at, expires_at, ttl_minutes, updated_at, space_type, room_id
      ) VALUES (?1, 'file', 'pending', 'ocupado.bin', ?2, 'application/octet-stream', ?3, ?4, ?5, 5, ?4, 'personal', NULL)
    `).bind(
      crypto.randomUUID(),
      STORAGE_INTERNAL_LIMIT_BYTES - 5,
      `drop/personal/${crypto.randomUUID()}/ocupado.bin`,
      now.toISOString(),
      new Date(now.getTime() + 300_000).toISOString()
    ).run();

    const results = await Promise.allSettled([
      initializeFileUpload(env, { name: "uno.bin", size: 4, mimeType: "application/octet-stream", ttlMinutes: 5 }),
      initializeFileUpload(env, { name: "dos.bin", size: 4, mimeType: "application/octet-stream", ttlMinutes: 5 })
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected")[0].reason?.code, "storage-limit");
    const usage = await env.DB.prepare(`
      SELECT COALESCE(SUM(size), 0) AS bytes
      FROM drop_items
      WHERE type = 'file' AND status IN ('pending', 'ready')
    `).first();
    assert.equal(usage.bytes, STORAGE_INTERNAL_LIMIT_BYTES - 1);
  } finally {
    env.DB.close();
  }
});

test("la actividad mantiene viva la sala sin extender su cierre duro de 10 minutos", async () => {
  const env = createEnv();

  try {
    const created = await createRoom(env, {}, { ip: "198.51.100.40" });
    const hardExpiry = created.room.expiresAt;
    const oldActivity = new Date(Date.now() - 4 * 60_000).toISOString();
    await env.DB.prepare("UPDATE rooms SET last_activity_at = ?2 WHERE id = ?1").bind(created.room.id, oldActivity).run();

    const touched = await touchRoomActivity(env, created.room.id);
    assert.equal(touched.expiresAt, hardExpiry);
    assert.ok(Date.parse(touched.lastActivityAt) > Date.parse(oldActivity));
    assert.ok(Date.parse(hardExpiry) - Date.now() <= 10 * 60_000 + 2000);
  } finally {
    env.DB.close();
  }
});

test("cierra una sala después de cinco minutos reales sin actividad", async () => {
  const env = createEnv();

  try {
    const created = await createRoom(env, {}, { ip: "198.51.100.41" });
    const staleActivity = new Date(Date.now() - 5 * 60_000 - 1000).toISOString();
    await env.DB.prepare("UPDATE rooms SET last_activity_at = ?2 WHERE id = ?1").bind(created.room.id, staleActivity).run();

    const capacity = await getRoomCapacity(env.DB);
    assert.equal(capacity.active, 0);
    assert.equal(capacity.maximum, 3);
    assert.equal(capacity.available, 3);

    const cleanup = await cleanupExpiredRooms(env);
    assert.equal(cleanup.closed, 1);
    const row = await env.DB.prepare("SELECT status FROM rooms WHERE id = ?1").bind(created.room.id).first();
    assert.equal(row.status, "closed");
  } finally {
    env.DB.close();
  }
});

test("permite un día e indefinido y puede fijar un elemento existente como indefinido", async () => {
  const env = createEnv();

  try {
    const oneDay = await createTextItem(env, { content: "un día", ttlMinutes: 1440 });
    const remaining = Date.parse(oneDay.expiresAt) - Date.now();
    assert.ok(remaining > 23 * 60 * 60_000);
    assert.ok(remaining <= 24 * 60 * 60_000 + 2000);

    const item = await createTextItem(env, { content: "conservar", ttlMinutes: 5 });
    const pinned = await resetItemTtl(env, item.id, 0);
    assert.equal(pinned.expiresAt, null);
    assert.equal(pinned.ttlMinutes, 0);
    const items = await listActiveItems(env);
    assert.equal(items.some((entry) => entry.id === item.id), true);
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
  const [body, signature] = token.split(".");
  const index = Math.floor(signature.length / 2);
  const replacement = signature[index] === "A" ? "B" : "A";
  const altered = `${body}.${signature.slice(0, index)}${replacement}${signature.slice(index + 1)}`;
  assert.equal(await verifyRoomSessionToken(altered, secret), null);
  assert.equal(await verifyRoomSessionToken(token, secret, Date.now() + (ROOM_SESSION_TTL_SECONDS + 10) * 1000), null);
});
