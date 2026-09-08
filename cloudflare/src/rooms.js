import {
  DEFAULT_ROOM_MAX_BYTES,
  DEFAULT_ROOM_MAX_FILE_BYTES,
  DEFAULT_ROOM_MAX_ITEMS,
  MAX_ACTIVE_ROOMS,
  ROOM_DEFAULT_TTL_MINUTES,
  ROOM_TTL_OPTIONS
} from "./constants.js";
import {
  base64UrlDecodeBytes,
  base64UrlEncodeBytes,
  base64UrlEncodeText,
  randomBytes,
  sha256Bytes,
  timingSafeEqualBytes
} from "./crypto.js";
import { bearerToken, HttpError, normalizeText } from "./http.js";
import { deleteItemsForRoom } from "./items.js";
import { incrementUsage, recordCleanupFailure } from "./usage.js";

function normalizeRoomTtl(value) {
  const minutes = Number(value ?? ROOM_DEFAULT_TTL_MINUTES);

  if (!ROOM_TTL_OPTIONS.includes(minutes)) {
    throw new HttpError(400, "invalid-room-ttl", "La duración de la sala no es válida.");
  }

  return minutes;
}

function normalizeRoomCode(value) {
  const code = normalizeText(value).toUpperCase();

  if (!/^[A-Z]{2}-\d{4}$/.test(code)) {
    throw new HttpError(400, "invalid-room-code", "El código de sala no es válido.");
  }

  return code;
}

export function generateRoomCode(bytes = randomBytes(6)) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 6) {
    throw new TypeError("Se requieren al menos 6 bytes aleatorios.");
  }

  const first = String.fromCharCode(65 + bytes[0] % 26);
  const second = String.fromCharCode(65 + bytes[1] % 26);
  const digits = Array.from(bytes.slice(2, 6), (value) => String(value % 10)).join("");
  return `${first}${second}-${digits}`;
}

async function importRoomKey(secret, namespace) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
  }

  const keyBytes = await sha256Bytes(`hopper-${namespace}-key-v1:${secret}`);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function hmacBytes(secret, namespace, value) {
  const key = await importRoomKey(secret, namespace);
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(value)))
  );
}

export async function hashRoomCode(code, secret) {
  const normalized = normalizeRoomCode(code);
  return base64UrlEncodeBytes(await hmacBytes(secret, "room-code", `hopper-room-code-v1:${normalized}`));
}

async function signRoomTokenBody(body, secret) {
  return base64UrlEncodeBytes(
    await hmacBytes(secret, "room-session", `hopper-room-session-v1:${body}`)
  );
}

export async function createRoomSessionToken(secret, room, now = Date.now()) {
  const roomExpiry = Date.parse(room?.expiresAt || room?.expires_at || "");
  const expiresAt = Number.isFinite(roomExpiry) ? roomExpiry : now + 60 * 60 * 1000;
  const payload = {
    typ: "room",
    rid: String(room.id),
    ver: Number(room.version),
    iat: Math.floor(now / 1000),
    exp: Math.floor(Math.min(expiresAt, now + 60 * 60 * 1000) / 1000),
    nonce: base64UrlEncodeBytes(randomBytes(12))
  };
  const body = base64UrlEncodeText(JSON.stringify(payload));
  const signature = await signRoomTokenBody(body, secret);
  return `${body}.${signature}`;
}

export async function verifyRoomSessionToken(token, secret, now = Date.now()) {
  const parts = normalizeText(token).split(".");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  const expectedSignature = await signRoomTokenBody(parts[0], secret);
  let first;
  let second;

  try {
    first = base64UrlDecodeBytes(parts[1]);
    second = base64UrlDecodeBytes(expectedSignature);
  } catch {
    return null;
  }

  if (!timingSafeEqualBytes(first, second)) {
    return null;
  }

  let payload;

  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeBytes(parts[0])));
  } catch {
    return null;
  }

  const nowSeconds = Math.floor(now / 1000);

  if (
    payload?.typ !== "room"
    || !/^[0-9a-f-]{36}$/i.test(String(payload?.rid || ""))
    || !Number.isInteger(payload?.ver)
    || !Number.isFinite(payload?.exp)
    || payload.exp <= nowSeconds
  ) {
    return null;
  }

  return payload;
}

function mapRoom(row) {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id || ""),
    status: String(row.status || ""),
    version: Number(row.version || 1),
    createdAt: String(row.created_at || row.createdAt || ""),
    expiresAt: String(row.expires_at || row.expiresAt || ""),
    closedAt: row.closed_at || row.closedAt || null,
    maxBytes: Number(row.max_bytes || row.maxBytes || DEFAULT_ROOM_MAX_BYTES),
    maxFileBytes: Number(row.max_file_bytes || row.maxFileBytes || DEFAULT_ROOM_MAX_FILE_BYTES),
    maxItems: Number(row.max_items || row.maxItems || DEFAULT_ROOM_MAX_ITEMS),
    usedBytes: Number(row.used_bytes || row.usedBytes || 0),
    itemCount: Number(row.item_count || row.itemCount || 0)
  };
}

async function clientHash(client) {
  const digest = await sha256Bytes(client?.ip || "unknown");
  return base64UrlEncodeBytes(digest).slice(0, 32);
}

export async function getRoomById(db, id) {
  const row = await db.prepare(`
    SELECT
      r.*,
      COALESCE(SUM(CASE WHEN d.status IN ('pending', 'ready') THEN d.size ELSE 0 END), 0) AS used_bytes,
      COALESCE(SUM(CASE WHEN d.status IN ('pending', 'ready') THEN 1 ELSE 0 END), 0) AS item_count
    FROM rooms r
    LEFT JOIN drop_items d ON d.room_id = r.id AND d.space_type = 'room'
    WHERE r.id = ?1
    GROUP BY r.id
    LIMIT 1
  `).bind(String(id || "")).first();

  return mapRoom(row);
}

export async function listActiveRooms(db) {
  const now = new Date().toISOString();
  const result = await db.prepare(`
    SELECT
      r.*,
      COALESCE(SUM(CASE WHEN d.status IN ('pending', 'ready') THEN d.size ELSE 0 END), 0) AS used_bytes,
      COALESCE(SUM(CASE WHEN d.status IN ('pending', 'ready') THEN 1 ELSE 0 END), 0) AS item_count
    FROM rooms r
    LEFT JOIN drop_items d ON d.room_id = r.id AND d.space_type = 'room'
    WHERE r.status = 'active' AND r.expires_at > ?1
    GROUP BY r.id
    ORDER BY r.created_at ASC
    LIMIT ?2
  `).bind(now, MAX_ACTIVE_ROOMS).all();

  return (result.results || []).map(mapRoom);
}

export async function createRoom(env, payload, client) {
  const ttlMinutes = normalizeRoomTtl(payload?.ttlMinutes);
  const now = new Date();
  const nowIso = now.toISOString();
  await env.DB.prepare(`
    UPDATE rooms
    SET status = 'closed', closed_at = COALESCE(closed_at, ?1), version = version + 1
    WHERE status = 'active' AND expires_at <= ?1
  `).bind(nowIso).run();

  const countRow = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM rooms
    WHERE status = 'active' AND expires_at > ?1
  `).bind(nowIso).first();

  if (Number(countRow?.count || 0) >= MAX_ACTIVE_ROOMS) {
    throw new HttpError(409, "room-limit", "Ya tienes dos salas activas. Cierra una para crear otra.");
  }

  let code = "";
  let codeHash = "";

  for (let attempt = 0; attempt < 8; attempt += 1) {
    code = generateRoomCode();
    codeHash = await hashRoomCode(code, env.SESSION_SECRET);
    const exists = await env.DB.prepare(`SELECT id FROM rooms WHERE code_hash = ?1 LIMIT 1`).bind(codeHash).first();

    if (!exists) {
      break;
    }

    code = "";
  }

  if (!code) {
    throw new HttpError(503, "room-code-unavailable", "No fue posible generar un código de sala. Intenta de nuevo.");
  }

  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
  const creatorHash = await clientHash(client);

  const inserted = await env.DB.prepare(`
    INSERT INTO rooms (
      id, code_hash, status, version, created_at, expires_at,
      max_bytes, max_file_bytes, max_items, created_client_hash
    )
    SELECT ?1, ?2, 'active', 1, ?3, ?4, ?5, ?6, ?7, ?8
    WHERE (
      SELECT COUNT(*)
      FROM rooms
      WHERE status = 'active' AND expires_at > ?3
    ) < ?9
  `).bind(
    id,
    codeHash,
    nowIso,
    expiresAt,
    DEFAULT_ROOM_MAX_BYTES,
    DEFAULT_ROOM_MAX_FILE_BYTES,
    DEFAULT_ROOM_MAX_ITEMS,
    creatorHash,
    MAX_ACTIVE_ROOMS
  ).run();

  if (Number(inserted.meta?.changes || 0) !== 1) {
    throw new HttpError(409, "room-limit", "Ya tienes dos salas activas. Cierra una para crear otra.");
  }

  await incrementUsage(env.DB, { rooms_created: 1 });
  const room = await getRoomById(env.DB, id);
  const token = await createRoomSessionToken(env.SESSION_SECRET, room);

  return {
    room,
    code,
    token,
    expiresIn: Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
  };
}

export async function joinRoom(env, code) {
  const normalized = normalizeRoomCode(code);
  const codeHash = await hashRoomCode(normalized, env.SESSION_SECRET);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`
    SELECT *
    FROM rooms
    WHERE code_hash = ?1 AND status = 'active' AND expires_at > ?2
    LIMIT 1
  `).bind(codeHash, now).first();

  if (!row) {
    throw new HttpError(404, "room-not-available", "La sala no está disponible o el código no es válido.");
  }

  const room = mapRoom(row);
  const token = await createRoomSessionToken(env.SESSION_SECRET, room);

  return {
    room,
    token,
    expiresIn: Math.max(1, Math.floor((Date.parse(room.expiresAt) - Date.now()) / 1000))
  };
}

export async function requireRoomRequest(request, env) {
  const session = await verifyRoomSessionToken(bearerToken(request), env.SESSION_SECRET);

  if (!session) {
    throw new HttpError(401, "invalid-room-session", "La sesión de sala venció o ya no es válida.");
  }

  const room = await getRoomById(env.DB, session.rid);

  if (
    !room
    || room.status !== "active"
    || room.version !== session.ver
    || Date.parse(room.expiresAt) <= Date.now()
  ) {
    throw new HttpError(401, "invalid-room-session", "La sala cerró o la sesión ya no es válida.");
  }

  return {
    session,
    room,
    context: {
      spaceType: "room",
      roomId: room.id,
      roomExpiresAt: room.expiresAt,
      maxFileBytes: room.maxFileBytes,
      maxBytes: room.maxBytes,
      maxItems: room.maxItems,
      ttlOptions: ROOM_TTL_OPTIONS
    }
  };
}

export async function closeRoom(env, roomId) {
  const room = await getRoomById(env.DB, roomId);

  if (!room || room.status !== "active") {
    return { closed: false, deleted: 0, failed: 0 };
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE rooms
    SET status = 'closed', closed_at = ?2, version = version + 1
    WHERE id = ?1 AND status = 'active'
  `).bind(room.id, now).run();

  await env.DB.prepare(`
    UPDATE drop_items
    SET expires_at = ?2, updated_at = ?2
    WHERE room_id = ?1 AND space_type = 'room' AND expires_at > ?2
  `).bind(room.id, now).run();

  const cleanup = await deleteItemsForRoom(env, room.id);

  if (cleanup.failed > 0) {
    await recordCleanupFailure(env.DB, cleanup.failed);
  }

  return { closed: true, ...cleanup };
}

export async function cleanupExpiredRooms(env) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    SELECT id
    FROM rooms
    WHERE status = 'active' AND expires_at <= ?1
    ORDER BY expires_at ASC
    LIMIT ?2
  `).bind(now, MAX_ACTIVE_ROOMS).all();
  let closed = 0;
  let deleted = 0;
  let failed = 0;

  for (const row of result.results || []) {
    const cleanup = await closeRoom(env, row.id);
    closed += cleanup.closed ? 1 : 0;
    deleted += Number(cleanup.deleted || 0);
    failed += Number(cleanup.failed || 0);
  }

  return { scanned: (result.results || []).length, closed, deleted, failed };
}
