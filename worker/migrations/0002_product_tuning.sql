-- Amplía retenciones personales y separa la vida máxima de una sala de su inactividad.

ALTER TABLE drop_items RENAME TO drop_items_legacy;

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
  expires_at TEXT,
  ttl_minutes INTEGER NOT NULL CHECK (ttl_minutes IN (0, 5, 10, 15, 30, 60, 360, 1440)),
  updated_at TEXT NOT NULL,
  space_type TEXT NOT NULL DEFAULT 'personal' CHECK (space_type IN ('personal', 'room')),
  room_id TEXT,
  etag TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CHECK (
    (space_type = 'personal' AND room_id IS NULL)
    OR (space_type = 'room' AND room_id IS NOT NULL)
  ),
  CHECK (
    (ttl_minutes = 0 AND space_type = 'personal' AND status = 'ready' AND expires_at IS NULL)
    OR ttl_minutes <> 0
    OR status = 'pending'
  )
);

INSERT INTO drop_items (
  id,
  type,
  status,
  content,
  name,
  size,
  mime_type,
  storage_key,
  created_at,
  expires_at,
  ttl_minutes,
  updated_at,
  space_type,
  room_id,
  etag
)
SELECT
  id,
  type,
  status,
  content,
  name,
  size,
  mime_type,
  storage_key,
  created_at,
  expires_at,
  ttl_minutes,
  updated_at,
  space_type,
  room_id,
  etag
FROM drop_items_legacy;

DROP TABLE drop_items_legacy;

CREATE INDEX idx_drop_items_status_expires_at
ON drop_items (status, expires_at);

CREATE INDEX idx_drop_items_status_created_at
ON drop_items (status, created_at DESC);

CREATE INDEX idx_drop_items_expires_at
ON drop_items (expires_at);

CREATE INDEX idx_drop_items_space_room_status_created
ON drop_items (space_type, room_id, status, created_at DESC);

ALTER TABLE rooms ADD COLUMN last_activity_at TEXT;

-- En el modelo anterior expires_at era "última actividad + 5 min".
UPDATE rooms
SET last_activity_at = COALESCE(
  last_activity_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', expires_at, '-5 minutes'),
  created_at
);

-- Desde ahora expires_at representa el cierre duro a los 10 minutos de creación.
UPDATE rooms
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+10 minutes')
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_rooms_status_last_activity
ON rooms (status, last_activity_at);
