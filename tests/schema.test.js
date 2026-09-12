import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TestD1 } from "./d1-test-helper.js";

const baseline = readFileSync(new URL("../worker/migrations/0001_baseline.sql", import.meta.url), "utf8");
const tuning = readFileSync(new URL("../worker/migrations/0002_product_tuning.sql", import.meta.url), "utf8");
const schema = `${baseline}\n${tuning}`;

test("las migraciones crean el esquema actual y sus índices", async () => {
  const db = new TestD1(schema);

  try {
    const tables = await db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name
    `).all();
    const names = new Set((tables.results || []).map((row) => row.name));

    for (const name of [
      "blocked_clients",
      "drop_items",
      "maintenance_state",
      "pin_credentials",
      "rate_limits",
      "recovery_tokens",
      "rooms",
      "security_events",
      "security_state",
      "session_state",
      "usage_daily"
    ]) {
      assert.equal(names.has(name), true, `Falta la tabla ${name}`);
    }

    const indexes = await db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
    `).all();
    const indexNames = new Set((indexes.results || []).map((row) => row.name));
    assert.equal(indexNames.has("idx_drop_items_space_room_status_created"), true);
    assert.equal(indexNames.has("idx_recovery_tokens_created_at"), true);
    assert.equal(indexNames.has("idx_rooms_status_last_activity"), true);

    const roomColumns = await db.prepare("PRAGMA table_info(rooms)").all();
    assert.equal((roomColumns.results || []).some((column) => column.name === "last_activity_at"), true);

    const dropColumns = await db.prepare("PRAGMA table_info(drop_items)").all();
    const expiresAt = (dropColumns.results || []).find((column) => column.name === "expires_at");
    assert.equal(expiresAt?.notnull, 0);
  } finally {
    db.close();
  }
});

test("la migración de producto conserva datos y habilita expiración indefinida", async () => {
  const db = new TestD1(baseline);
  const id = crypto.randomUUID();
  const roomId = crypto.randomUUID();
  const now = new Date();
  const oldExpiry = new Date(now.getTime() + 5 * 60_000).toISOString();

  try {
    await db.prepare(`
      INSERT INTO rooms (
        id, code_hash, status, version, created_at, expires_at,
        max_bytes, max_file_bytes, max_items, created_client_hash
      ) VALUES (?1, ?2, 'active', 1, ?3, ?4, 100, 50, 25, 'client')
    `).bind(roomId, `hash-${roomId}`, now.toISOString(), oldExpiry).run();

    await db.prepare(`
      INSERT INTO drop_items (
        id, type, status, content, size, created_at, expires_at,
        ttl_minutes, updated_at, space_type, room_id
      ) VALUES (?1, 'text', 'ready', 'conservar', 0, ?2, ?3, 5, ?2, 'personal', NULL)
    `).bind(id, now.toISOString(), oldExpiry).run();

    db.exec(tuning);

    const row = await db.prepare(`
      SELECT id, content, ttl_minutes AS ttl, space_type AS scope
      FROM drop_items
      WHERE id = ?1
    `).bind(id).first();
    assert.deepEqual(row, { id, content: "conservar", ttl: 5, scope: "personal" });

    const migratedRoom = await db.prepare(`
      SELECT expires_at AS expiresAt, last_activity_at AS lastActivityAt
      FROM rooms
      WHERE id = ?1
    `).bind(roomId).first();
    assert.ok(migratedRoom.lastActivityAt);
    assert.ok(Date.parse(migratedRoom.expiresAt) > Date.parse(now.toISOString()));

    await db.prepare(`
      INSERT INTO drop_items (
        id, type, status, content, size, created_at, expires_at,
        ttl_minutes, updated_at, space_type, room_id
      ) VALUES (?1, 'text', 'ready', 'indefinido', 0, ?2, NULL, 0, ?2, 'personal', NULL)
    `).bind(crypto.randomUUID(), now.toISOString()).run();
  } finally {
    db.close();
  }
});
