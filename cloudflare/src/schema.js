import {
  DEFAULT_ROOM_MAX_BYTES,
  DEFAULT_ROOM_MAX_FILE_BYTES,
  DEFAULT_ROOM_MAX_ITEMS
} from "./constants.js";

let schemaPromise = null;

async function createEvolutionTables(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        closed_at TEXT,
        max_bytes INTEGER NOT NULL CHECK (max_bytes > 0),
        max_file_bytes INTEGER NOT NULL CHECK (max_file_bytes > 0),
        max_items INTEGER NOT NULL CHECK (max_items > 0),
        created_client_hash TEXT
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_rooms_status_expires_at
      ON rooms (status, expires_at)
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS usage_daily (
        date TEXT PRIMARY KEY,
        uploads_count INTEGER NOT NULL DEFAULT 0 CHECK (uploads_count >= 0),
        upload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (upload_bytes >= 0),
        deleted_count INTEGER NOT NULL DEFAULT 0 CHECK (deleted_count >= 0),
        deleted_bytes INTEGER NOT NULL DEFAULT 0 CHECK (deleted_bytes >= 0),
        text_count INTEGER NOT NULL DEFAULT 0 CHECK (text_count >= 0),
        file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
        room_uploads_count INTEGER NOT NULL DEFAULT 0 CHECK (room_uploads_count >= 0),
        room_upload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (room_upload_bytes >= 0),
        failed_uploads INTEGER NOT NULL DEFAULT 0 CHECK (failed_uploads >= 0),
        recovered_failures INTEGER NOT NULL DEFAULT 0 CHECK (recovered_failures >= 0),
        cleanup_failures INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_failures >= 0),
        rooms_created INTEGER NOT NULL DEFAULT 0 CHECK (rooms_created >= 0)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS maintenance_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_cleanup_at TEXT,
        last_cleanup_failed INTEGER NOT NULL DEFAULT 0 CHECK (last_cleanup_failed >= 0),
        last_reconcile_at TEXT,
        orphan_count INTEGER NOT NULL DEFAULT 0 CHECK (orphan_count >= 0),
        orphan_bytes INTEGER NOT NULL DEFAULT 0 CHECK (orphan_bytes >= 0),
        missing_count INTEGER NOT NULL DEFAULT 0 CHECK (missing_count >= 0),
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      INSERT OR IGNORE INTO maintenance_state (id, updated_at)
      VALUES (1, ?1)
    `).bind(new Date().toISOString())
  ]);
}

async function migrateDropItems(db) {
  const definition = await db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = 'drop_items'
  `).first();
  const sql = String(definition?.sql || "");

  if (!sql) {
    return;
  }

  if (sql.includes("space_type") && /ttl_minutes\s+IN\s*\(5\s*,/i.test(sql)) {
    await db.batch([
      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_drop_items_space_room_status_created
        ON drop_items (space_type, room_id, status, created_at DESC)
      `)
    ]);
    return;
  }

  const columnsResult = await db.prepare(`PRAGMA table_info(drop_items)`).all();
  const columns = new Set((columnsResult.results || []).map((row) => String(row.name || "")));
  const spaceTypeExpression = columns.has("space_type") ? "space_type" : "'personal'";
  const roomIdExpression = columns.has("room_id") ? "room_id" : "NULL";
  const etagExpression = columns.has("etag") ? "etag" : "NULL";

  await db.prepare(`DROP TABLE IF EXISTS drop_items_next`).run();
  await db.batch([
    db.prepare(`
      CREATE TABLE drop_items_next (
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
        ttl_minutes INTEGER NOT NULL CHECK (ttl_minutes IN (5, 15, 30, 60, 360)),
        updated_at TEXT NOT NULL,
        space_type TEXT NOT NULL DEFAULT 'personal' CHECK (space_type IN ('personal', 'room')),
        room_id TEXT,
        etag TEXT,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        CHECK (
          (space_type = 'personal' AND room_id IS NULL)
          OR (space_type = 'room' AND room_id IS NOT NULL)
        )
      )
    `),
    db.prepare(`
      INSERT INTO drop_items_next (
        id, type, status, content, name, size, mime_type, storage_key,
        created_at, expires_at, ttl_minutes, updated_at, space_type, room_id, etag
      )
      SELECT
        id, type, status, content, name, size, mime_type, storage_key,
        created_at, expires_at,
        CASE WHEN ttl_minutes IN (5, 15, 30, 60, 360) THEN ttl_minutes ELSE 15 END,
        updated_at,
        ${spaceTypeExpression}, ${roomIdExpression}, ${etagExpression}
      FROM drop_items
    `),
    db.prepare(`DROP TABLE drop_items`),
    db.prepare(`ALTER TABLE drop_items_next RENAME TO drop_items`),
    db.prepare(`
      CREATE INDEX idx_drop_items_status_expires_at
      ON drop_items (status, expires_at)
    `),
    db.prepare(`
      CREATE INDEX idx_drop_items_status_created_at
      ON drop_items (status, created_at DESC)
    `),
    db.prepare(`
      CREATE INDEX idx_drop_items_expires_at
      ON drop_items (expires_at)
    `),
    db.prepare(`
      CREATE INDEX idx_drop_items_space_room_status_created
      ON drop_items (space_type, room_id, status, created_at DESC)
    `)
  ]);
}

async function initializeSchema(env) {
  if (!env?.DB) {
    throw new Error("D1 no está configurado.");
  }

  await createEvolutionTables(env.DB);
  await migrateDropItems(env.DB);

  await env.DB.prepare(`
    UPDATE rooms
    SET
      max_bytes = CASE WHEN max_bytes > 0 THEN max_bytes ELSE ?1 END,
      max_file_bytes = CASE WHEN max_file_bytes > 0 THEN max_file_bytes ELSE ?2 END,
      max_items = CASE WHEN max_items > 0 THEN max_items ELSE ?3 END
    WHERE status = 'active'
  `).bind(
    DEFAULT_ROOM_MAX_BYTES,
    DEFAULT_ROOM_MAX_FILE_BYTES,
    DEFAULT_ROOM_MAX_ITEMS
  ).run();
}

export async function ensureEvolutionSchema(env) {
  if (!schemaPromise) {
    schemaPromise = initializeSchema(env).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}
