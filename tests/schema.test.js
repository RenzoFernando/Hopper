import test from "node:test";
import assert from "node:assert/strict";
import { ensureEvolutionSchema } from "../cloudflare/src/schema.js";
import { TestD1 } from "./d1-test-helper.js";

const legacySchema = `
CREATE TABLE drop_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('text', 'file')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
  content TEXT,
  name TEXT,
  size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
  mime_type TEXT,
  storage_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ttl_minutes INTEGER NOT NULL CHECK (ttl_minutes IN (15, 30, 60, 360)),
  updated_at TEXT NOT NULL
);
`;

test("migra una D1 existente para aceptar 5 minutos y scopes sin perder datos", async () => {
  const db = new TestD1(legacySchema);
  const now = new Date().toISOString();

  try {
    await db.prepare(`
      INSERT INTO drop_items (
        id, type, status, content, size, created_at, expires_at, ttl_minutes, updated_at
      ) VALUES (?1, 'text', 'ready', 'antes', 0, ?2, ?3, 15, ?2)
    `).bind(crypto.randomUUID(), now, new Date(Date.now() + 900_000).toISOString()).run();
    await ensureEvolutionSchema({ DB: db });
    const migrated = await db.prepare("SELECT content, ttl_minutes AS ttl, space_type AS scope, room_id AS roomId FROM drop_items LIMIT 1").first();
    assert.deepEqual(migrated, { content: "antes", ttl: 15, scope: "personal", roomId: null });
    await db.prepare(`
      INSERT INTO drop_items (
        id, type, status, content, size, created_at, expires_at, ttl_minutes, updated_at, space_type, room_id
      ) VALUES (?1, 'text', 'ready', 'después', 0, ?2, ?3, 5, ?2, 'personal', NULL)
    `).bind(crypto.randomUUID(), now, new Date(Date.now() + 300_000).toISOString()).run();
    const row = await db.prepare("SELECT COUNT(*) AS count FROM drop_items WHERE ttl_minutes = 5").first();
    assert.equal(row.count, 1);
  } finally {
    db.close();
  }
});
