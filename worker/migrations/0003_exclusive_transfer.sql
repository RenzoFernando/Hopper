-- Modo exclusivo temporal: la fila única funciona como bloqueo global persistente.
CREATE TABLE IF NOT EXISTS exclusive_mode (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL CHECK (status IN ('preparing', 'active', 'closing', 'inactive')),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS exclusive_uploads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 10737418240),
  mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  upload_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completing', 'ready')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exclusive_uploads_status ON exclusive_uploads(status);
