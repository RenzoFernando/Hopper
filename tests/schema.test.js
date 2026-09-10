import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TestD1 } from "./d1-test-helper.js";

const baseline = readFileSync(new URL("../worker/migrations/0001_baseline.sql", import.meta.url), "utf8");

test("la migración baseline crea el esquema actual y los índices de Fase 4", async () => {
  const db = new TestD1(baseline);

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
  } finally {
    db.close();
  }
});

test("reaplicar el baseline sobre el esquema vigente conserva los datos existentes", async () => {
  const db = new TestD1(baseline);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await db.prepare(`
      INSERT INTO drop_items (
        id, type, status, content, size, created_at, expires_at,
        ttl_minutes, updated_at, space_type, room_id
      ) VALUES (?1, 'text', 'ready', 'conservar', 0, ?2, ?3, 5, ?2, 'personal', NULL)
    `).bind(id, now, new Date(Date.now() + 300_000).toISOString()).run();

    db.exec(baseline);
    const row = await db.prepare(`
      SELECT id, content, ttl_minutes AS ttl, space_type AS scope
      FROM drop_items
      WHERE id = ?1
    `).bind(id).first();

    assert.deepEqual(row, {
      id,
      content: "conservar",
      ttl: 5,
      scope: "personal"
    });
  } finally {
    db.close();
  }
});
