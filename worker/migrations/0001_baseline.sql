CREATE TABLE IF NOT EXISTS security_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  lock_event_recorded INTEGER NOT NULL DEFAULT 0 CHECK (lock_event_recorded IN (0, 1)),
  locked_at TEXT,
  last_failed_at TEXT,
  last_success_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO security_state (
  id,
  failed_attempts,
  locked,
  lock_event_recorded,
  updated_at
) VALUES (
  1,
  0,
  0,
  0,
  datetime('now')
);

CREATE TABLE IF NOT EXISTS session_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO session_state (
  id,
  version,
  updated_at
) VALUES (
  1,
  1,
  datetime('now')
);

CREATE TABLE IF NOT EXISTS pin_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm = 'hmac-sha256-v1'),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  requested_ip TEXT,
  used_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_recovery_tokens_expires_at
ON recovery_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_recovery_tokens_created_at
ON recovery_tokens (created_at DESC);

CREATE TABLE IF NOT EXISTS blocked_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('ip', 'cidr')),
  created_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_security_events_created_at
ON security_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_type_created_at
ON security_events (type, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at
ON rate_limits (expires_at);

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
);

CREATE INDEX IF NOT EXISTS idx_rooms_status_expires_at
ON rooms (status, expires_at);

CREATE TABLE IF NOT EXISTS drop_items (
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
);

CREATE INDEX IF NOT EXISTS idx_drop_items_status_expires_at
ON drop_items (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_drop_items_status_created_at
ON drop_items (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drop_items_expires_at
ON drop_items (expires_at);

CREATE INDEX IF NOT EXISTS idx_drop_items_space_room_status_created
ON drop_items (space_type, room_id, status, created_at DESC);

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
);

CREATE TABLE IF NOT EXISTS maintenance_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_cleanup_at TEXT,
  last_cleanup_failed INTEGER NOT NULL DEFAULT 0 CHECK (last_cleanup_failed >= 0),
  last_reconcile_at TEXT,
  orphan_count INTEGER NOT NULL DEFAULT 0 CHECK (orphan_count >= 0),
  orphan_bytes INTEGER NOT NULL DEFAULT 0 CHECK (orphan_bytes >= 0),
  missing_count INTEGER NOT NULL DEFAULT 0 CHECK (missing_count >= 0),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO maintenance_state (
  id,
  updated_at
) VALUES (
  1,
  datetime('now')
);
