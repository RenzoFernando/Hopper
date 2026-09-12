import type { Env } from "../types/env.ts";
import {
  DEFAULT_MAX_FILE_BYTES,
  DOWNLOAD_URL_TTL_SECONDS,
  MAX_CLEANUP_ITEMS,
  MAX_LIST_ITEMS,
  MAX_TEXT_CHARACTERS,
  PENDING_UPLOAD_TTL_SECONDS,
  STORAGE_INTERNAL_LIMIT_BYTES,
  STORAGE_WARNING_BYTES,
  TTL_OPTIONS,
  UPLOAD_URL_TTL_SECONDS
} from "../lib/constants.ts";
import { HttpError, normalizeText } from "../lib/http.ts";
import {
  createSignedB2Url,
  deleteB2Object,
  getB2ObjectMetadata
} from "./b2.ts";
import {
  recordCleanupFailure,
  recordDeletion,
  recordTransfer,
  recordUploadFailure
} from "./usage.ts";

export interface ItemContext {
  spaceType: "personal" | "room";
  roomId: string | null;
  roomExpiresAt: string | null;
  maxFileBytes: number | null;
  maxBytes: number | null;
  maxItems: number | null;
  ttlOptions: readonly number[];
}

interface DropItem {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  ttlMinutes: number;
  spaceType?: string;
  roomId?: string | null;
  etag?: string | null;
  content?: string;
  name?: string;
  size?: number;
  mimeType?: string;
  storageKey?: string;
  previewable?: boolean;
  audio?: boolean;
}

function personalContext(): ItemContext {
  return {
    spaceType: "personal",
    roomId: null,
    roomExpiresAt: null,
    maxFileBytes: null,
    maxBytes: null,
    maxItems: null,
    ttlOptions: TTL_OPTIONS
  };
}

function normalizeContext(context: Partial<ItemContext> | null | undefined): ItemContext {
  if (context?.spaceType === "room" && /^[0-9a-f-]{36}$/i.test(String(context.roomId || ""))) {
    return {
      spaceType: "room",
      roomId: String(context.roomId),
      roomExpiresAt: context.roomExpiresAt || null,
      maxFileBytes: Number(context.maxFileBytes) || null,
      maxBytes: Number(context.maxBytes) || null,
      maxItems: Number(context.maxItems) || null,
      ttlOptions: Array.isArray(context.ttlOptions) ? context.ttlOptions : TTL_OPTIONS
    };
  }

  return personalContext();
}

export function normalizeTtlMinutes(value: unknown, options: readonly unknown[] = TTL_OPTIONS): number {
  const minutes = Number(value);
  const allowed = Array.isArray(options) ? options.map(Number) : TTL_OPTIONS;

  if (!allowed.includes(minutes)) {
    throw new HttpError(400, "invalid-ttl", "El tiempo de expiración seleccionado no es válido.");
  }

  return minutes;
}

export function sanitizeFilename(value: unknown): string {
  const source = normalizeText(value).normalize("NFKC");
  const withoutPaths = source.replace(/[\\/]+/g, "-");
  const cleaned = withoutPaths
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 180);

  return cleaned || "archivo";
}

function normalizeMimeType(value: unknown): string {
  const mimeType = normalizeText(value).toLowerCase().slice(0, 160);
  return mimeType || "application/octet-stream";
}

function personalMaxFileBytes(env: Env) {
  const configured = Number(env.MAX_FILE_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(Math.floor(configured), DEFAULT_MAX_FILE_BYTES)
    : DEFAULT_MAX_FILE_BYTES;
}

function maxFileBytes(env: Env, context: Partial<ItemContext> | null | undefined): number {
  const scope = normalizeContext(context);
  return scope.spaceType === "room" && scope.maxFileBytes
    ? scope.maxFileBytes
    : personalMaxFileBytes(env);
}

function validateFileMetadata(env: Env, payload: { name?: unknown; size?: unknown; mimeType?: unknown; ttlMinutes?: unknown }, context: Partial<ItemContext> | null | undefined) {
  const scope = normalizeContext(context);
  const name = sanitizeFilename(payload?.name);
  const size = Number(payload?.size);
  const mimeType = normalizeMimeType(payload?.mimeType);
  const ttlMinutes = normalizeTtlMinutes(payload?.ttlMinutes, scope.ttlOptions);

  if (!Number.isInteger(size) || size < 0) {
    throw new HttpError(400, "invalid-file-size", "El tamaño del archivo no es válido.");
  }

  if (size > maxFileBytes(env, scope)) {
    throw new HttpError(413, "file-too-large", "El archivo supera el tamaño máximo configurado en Hopper.");
  }

  return { name, size, mimeType, ttlMinutes };
}

function validateItemId(value: unknown): string {
  const id = normalizeText(value);

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new HttpError(400, "invalid-item-id", "El identificador del elemento no es válido.");
  }

  return id;
}

function rowToDropItem(row: Record<string, unknown> | null | undefined): DropItem | null {
  if (!row) {
    return null;
  }

  const item: DropItem = {
    id: String(row.id || ""),
    type: String(row.type || ""),
    status: String(row.status || ""),
    createdAt: String(row.created_at || ""),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
    ttlMinutes: Number(row.ttl_minutes || 0),
    spaceType: String(row.space_type || "personal"),
    roomId: row.room_id ? String(row.room_id) : null,
    etag: row.etag ? String(row.etag) : null
  };

  if (item.type === "text") {
    item.content = String(row.content ?? "");
  }

  if (item.type === "file") {
    item.name = String(row.name || "archivo");
    item.size = Number(row.size || 0);
    item.mimeType = String(row.mime_type || "application/octet-stream");
    item.storageKey = String(row.storage_key || "");
  }

  return item;
}

function publicItem(item: DropItem | null): DropItem | null {
  if (!item) {
    return item;
  }

  const visible = { ...item };
  delete visible.storageKey;
  delete visible.etag;
  delete visible.spaceType;
  delete visible.roomId;

  if (item.type === "file") {
    visible.previewable = isPreviewableImage(item);
    visible.audio = isAudio(item);
  }

  return visible;
}

function storageKeyFor(item: DropItem): string {
  const storageKey = String(item.storageKey || "");

  if (item.type !== "file" || !storageKey) {
    throw new HttpError(500, "invalid-storage-state", "El archivo temporal no tiene una referencia de almacenamiento válida.");
  }

  return storageKey;
}

function assertScope(item: DropItem, context: Partial<ItemContext> | null | undefined): void {
  const scope = normalizeContext(context);
  const matches = scope.spaceType === "room"
    ? item?.spaceType === "room" && item?.roomId === scope.roomId
    : item?.spaceType !== "room";

  if (!matches) {
    throw new HttpError(404, "item-not-found", "El elemento temporal no existe.");
  }
}

async function deleteDropItemRow(env: Env, id: unknown): Promise<void> {
  await env.DB.prepare(`DELETE FROM drop_items WHERE id = ?1`)
    .bind(validateItemId(id))
    .run();
}

export async function getDropItem(env: Env, id: unknown): Promise<DropItem | null> {
  const row = await env.DB.prepare(`
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
      space_type,
      room_id,
      etag
    FROM drop_items
    WHERE id = ?1
    LIMIT 1
  `).bind(validateItemId(id)).first();

  return rowToDropItem(row);
}

export function isExpired(item: Pick<DropItem, "expiresAt" | "ttlMinutes"> | null | undefined, now: number = Date.now()): boolean {
  if (item?.expiresAt === null && Number(item?.ttlMinutes) === 0) {
    return false;
  }

  const expiresAt = Date.parse(item?.expiresAt || "");
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function isPreviewableImage(item: DropItem | null | undefined): boolean {
  return item?.type === "file" && [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif"
  ].includes(String(item?.mimeType || "").toLowerCase());
}

export function isAudio(item: DropItem | null | undefined): boolean {
  return item?.type === "file" && String(item?.mimeType || "").toLowerCase().startsWith("audio/");
}

function scopeFilter(context: Partial<ItemContext> | null | undefined, alias: string = ""): { sql: string; values: Array<string | null> } {
  const scope = normalizeContext(context);
  const prefix = alias ? `${alias}.` : "";

  if (scope.spaceType === "room") {
    return {
      sql: `${prefix}space_type = 'room' AND ${prefix}room_id = ?`,
      values: [scope.roomId]
    };
  }

  return {
    sql: `${prefix}space_type = 'personal' AND ${prefix}room_id IS NULL`,
    values: []
  };
}

export async function listActiveItems(env: Env, context: ItemContext = personalContext()) {
  const now = new Date().toISOString();
  const filter = scopeFilter(context);
  const result = await env.DB.prepare(`
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
      space_type,
      room_id,
      etag
    FROM drop_items
    WHERE status = 'ready' AND (expires_at IS NULL OR expires_at > ?1) AND ${filter.sql}
    ORDER BY created_at DESC
    LIMIT ?${filter.values.length + 2}
  `).bind(now, ...filter.values, MAX_LIST_ITEMS).all();

  return (result.results || []).map(rowToDropItem).filter((item): item is DropItem => item !== null).map(publicItem);
}

function effectiveExpiry(ttlMinutes: number, context: Partial<ItemContext> | null | undefined, base: number = Date.now()): Date | null {
  const scope = normalizeContext(context);

  if (scope.spaceType === "personal" && ttlMinutes === 0) {
    return null;
  }

  const requested = base + ttlMinutes * 60_000;
  const roomExpiry = Date.parse(scope.roomExpiresAt || "");

  return new Date(
    scope.spaceType === "room" && Number.isFinite(roomExpiry)
      ? Math.min(requested, roomExpiry)
      : requested
  );
}

async function enforceRoomItemLimit(env: Env, context: Partial<ItemContext> | null | undefined): Promise<void> {
  const scope = normalizeContext(context);

  if (scope.spaceType !== "room" || !scope.maxItems) {
    return;
  }

  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM drop_items
    WHERE room_id = ?1 AND space_type = 'room' AND status IN ('pending', 'ready')
  `).bind(scope.roomId).first();

  if (Number(row?.count || 0) >= scope.maxItems) {
    throw new HttpError(409, "room-item-limit", "La sala alcanzó el máximo de elementos permitidos.");
  }
}

export async function getEstimatedStorageUsage(env: Env) {
  const row = await env.DB.prepare(`
    SELECT COALESCE(SUM(size), 0) AS bytes
    FROM drop_items
    WHERE type = 'file' AND status IN ('pending', 'ready')
  `).first();
  const maintenance = await env.DB.prepare(`
    SELECT orphan_bytes AS orphanBytes
    FROM maintenance_state
    WHERE id = 1
  `).first();
  const activeBytes = Number(row?.bytes || 0);
  const orphanBytes = Number(maintenance?.orphanBytes || 0);

  return {
    activeBytes,
    orphanBytes,
    estimatedBytes: Math.max(0, activeBytes + orphanBytes),
    warning: activeBytes + orphanBytes >= STORAGE_WARNING_BYTES,
    blocked: activeBytes + orphanBytes >= STORAGE_INTERNAL_LIMIT_BYTES
  };
}

async function enforceStorageGuardrail(env: Env, additionalBytes: number, context: Partial<ItemContext> | null | undefined): Promise<void> {
  const scope = normalizeContext(context);
  const globalUsage = await getEstimatedStorageUsage(env);

  if (globalUsage.estimatedBytes + additionalBytes > STORAGE_INTERNAL_LIMIT_BYTES) {
    throw new HttpError(
      507,
      "storage-limit",
      "Hopper ha alcanzado su límite interno de almacenamiento. Espera a que el contenido temporal expire o elimina elementos."
    );
  }

  if (scope.spaceType === "room" && scope.maxBytes) {
    const row = await env.DB.prepare(`
      SELECT COALESCE(SUM(size), 0) AS bytes
      FROM drop_items
      WHERE room_id = ?1 AND space_type = 'room' AND status IN ('pending', 'ready')
    `).bind(scope.roomId).first();

    if (Number(row?.bytes || 0) + additionalBytes > scope.maxBytes) {
      throw new HttpError(507, "room-storage-limit", "La sala alcanzó su límite temporal de almacenamiento.");
    }
  }
}

export async function createTextItem(env: Env, payload: { content?: unknown; ttlMinutes?: unknown }, context: ItemContext = personalContext()) {
  const scope = normalizeContext(context);
  const content = String(payload?.content ?? "");
  const ttlMinutes = normalizeTtlMinutes(payload?.ttlMinutes, scope.ttlOptions);

  if (!content.trim()) {
    throw new HttpError(400, "empty-text", "Escribe o pega contenido antes de enviarlo.");
  }

  if (content.length > MAX_TEXT_CHARACTERS) {
    throw new HttpError(413, "text-too-large", "El texto supera el tamaño máximo permitido.");
  }

  const id = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = effectiveExpiry(ttlMinutes, scope, createdAt.getTime());
  const now = createdAt.toISOString();
  const inserted = await env.DB.prepare(`
    INSERT INTO drop_items (
      id,
      type,
      status,
      content,
      size,
      created_at,
      expires_at,
      ttl_minutes,
      updated_at,
      space_type,
      room_id
    )
    SELECT ?1, 'text', 'ready', ?2, 0, ?3, ?4, ?5, ?3, ?6, ?7
    WHERE
      ?6 <> 'room'
      OR (
        SELECT COUNT(*)
        FROM drop_items
        WHERE room_id = ?7 AND space_type = 'room' AND status IN ('pending', 'ready')
      ) < ?8
  `).bind(
    id,
    content,
    now,
    expiresAt?.toISOString() ?? null,
    ttlMinutes,
    scope.spaceType,
    scope.roomId,
    scope.maxItems || 2147483647
  ).run();

  if (Number(inserted.meta?.changes || 0) !== 1) {
    await enforceRoomItemLimit(env, scope);
    throw new HttpError(409, "room-item-limit", "La sala alcanzó el máximo de elementos permitidos.");
  }

  await recordTransfer(env.DB, { type: "text", bytes: 0, spaceType: scope.spaceType });
  return publicItem(await getDropItem(env, id));
}

export async function initializeFileUpload(env: Env, payload: { name?: unknown; size?: unknown; mimeType?: unknown; ttlMinutes?: unknown }, context: ItemContext = personalContext()) {
  const scope = normalizeContext(context);
  const file = validateFileMetadata(env, payload, scope);
  const id = crypto.randomUUID();
  const createdAt = new Date();
  const pendingExpiresAt = new Date(createdAt.getTime() + PENDING_UPLOAD_TTL_SECONDS * 1000);
  const storageKey = scope.spaceType === "room"
    ? `drop/rooms/${scope.roomId}/${id}/${file.name}`
    : file.ttlMinutes === 0
      ? `drop/personal/persistent/${id}/${file.name}`
      : `drop/personal/temporary/${id}/${file.name}`;
  const now = createdAt.toISOString();
  const inserted = await env.DB.prepare(`
    INSERT INTO drop_items (
      id,
      type,
      status,
      name,
      size,
      mime_type,
      storage_key,
      created_at,
      expires_at,
      ttl_minutes,
      updated_at,
      space_type,
      room_id
    )
    SELECT ?1, 'file', 'pending', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?6, ?9, ?10
    WHERE
      (
        SELECT COALESCE(SUM(size), 0)
        FROM drop_items
        WHERE type = 'file' AND status IN ('pending', 'ready')
      ) + COALESCE((
        SELECT orphan_bytes
        FROM maintenance_state
        WHERE id = 1
      ), 0) + ?3 <= ?11
      AND (
        ?9 <> 'room'
        OR (
          (
            SELECT COUNT(*)
            FROM drop_items
            WHERE room_id = ?10 AND space_type = 'room' AND status IN ('pending', 'ready')
          ) < ?12
          AND (
            SELECT COALESCE(SUM(size), 0)
            FROM drop_items
            WHERE room_id = ?10 AND space_type = 'room' AND status IN ('pending', 'ready')
          ) + ?3 <= ?13
        )
      )
  `).bind(
    id,
    file.name,
    file.size,
    file.mimeType,
    storageKey,
    now,
    pendingExpiresAt.toISOString(),
    file.ttlMinutes,
    scope.spaceType,
    scope.roomId,
    STORAGE_INTERNAL_LIMIT_BYTES,
    scope.maxItems || 2147483647,
    scope.maxBytes || STORAGE_INTERNAL_LIMIT_BYTES
  ).run();

  if (Number(inserted.meta?.changes || 0) !== 1) {
    await enforceRoomItemLimit(env, scope);
    await enforceStorageGuardrail(env, file.size, scope);
    throw new HttpError(409, "upload-limit-conflict", "No fue posible reservar espacio para la subida. Intenta de nuevo.");
  }

  try {
    const uploadUrl = await createSignedB2Url(env, {
      method: "PUT",
      objectName: storageKey,
      expiresSeconds: UPLOAD_URL_TTL_SECONDS,
      contentType: file.mimeType
    });

    return {
      id,
      uploadUrl,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType
    };
  } catch (error) {
    await deleteDropItemRow(env, id).catch(() => {});
    await recordUploadFailure(env.DB).catch(() => {});
    throw error;
  }
}

export async function completeFileUpload(env: Env, id: unknown, context: ItemContext = personalContext()) {
  const scope = normalizeContext(context);
  const item = await getDropItem(env, validateItemId(id));

  if (!item || item.type !== "file") {
    throw new HttpError(404, "item-not-found", "El archivo temporal no existe.");
  }

  assertScope(item, scope);

  if (item.status === "ready" && !isExpired(item)) {
    return publicItem(item);
  }

  if (item.status !== "pending" || isExpired(item)) {
    throw new HttpError(410, "upload-expired", "La ventana de subida de este archivo ya venció.");
  }

  const metadata = await getB2ObjectMetadata(env, storageKeyFor(item));

  if (!metadata) {
    throw new HttpError(409, "upload-not-found", "Backblaze B2 todavía no confirma la subida del archivo.");
  }

  const actualSize = Number(metadata.size || 0);

  if (actualSize !== item.size) {
    await deleteB2Object(env, storageKeyFor(item)).catch(() => {});
    await deleteDropItemRow(env, item.id).catch(() => {});
    await recordUploadFailure(env.DB).catch(() => {});
    throw new HttpError(409, "upload-size-mismatch", "La subida quedó incompleta y fue descartada.");
  }

  const createdAt = new Date();
  const expiresAt = effectiveExpiry(item.ttlMinutes, scope, createdAt.getTime());
  const mimeType = normalizeMimeType(metadata.contentType || item.mimeType);
  const now = createdAt.toISOString();

  await env.DB.prepare(`
    UPDATE drop_items
    SET
      status = 'ready',
      size = ?2,
      mime_type = ?3,
      created_at = ?4,
      expires_at = ?5,
      updated_at = ?4,
      etag = ?6
    WHERE id = ?1 AND status = 'pending'
  `).bind(
    item.id,
    actualSize,
    mimeType,
    now,
    expiresAt?.toISOString() ?? null,
    metadata.etag || metadata.versionId || null
  ).run();

  const readyItem = await getDropItem(env, item.id);

  if (!readyItem || readyItem.status !== "ready") {
    throw new HttpError(409, "upload-state-conflict", "No fue posible confirmar el archivo temporal.");
  }

  await recordTransfer(env.DB, { type: "file", bytes: actualSize, spaceType: scope.spaceType });
  return publicItem(readyItem);
}

export async function cancelFileUpload(
  env: Env,
  id: unknown,
  context: ItemContext = personalContext(),
  { recordFailure = false }: { recordFailure?: boolean } = {}
): Promise<void> {
  const item = await getDropItem(env, validateItemId(id));

  if (!item) {
    return;
  }

  assertScope(item, context);

  if (recordFailure && item.status === "pending") {
    await recordUploadFailure(env.DB).catch(() => {});
  }

  if (item.type === "file" && item.storageKey) {
    await deleteB2Object(env, storageKeyFor(item));
  }

  await deleteDropItemRow(env, item.id);
}

export async function createItemDownloadUrl(env: Env, id: unknown, mode: string = "download", context: ItemContext = personalContext()) {
  const item = await getDropItem(env, validateItemId(id));

  if (!item || item.type !== "file" || item.status !== "ready") {
    throw new HttpError(404, "item-not-found", "El archivo temporal no existe.");
  }

  assertScope(item, context);

  if (isExpired(item)) {
    throw new HttpError(410, "item-expired", "El archivo ya expiró.");
  }

  if (mode === "preview" && !isPreviewableImage(item)) {
    throw new HttpError(400, "preview-not-supported", "Este tipo de archivo no tiene vista previa.");
  }

  if (mode === "stream" && !isAudio(item)) {
    throw new HttpError(400, "stream-not-supported", "Este tipo de archivo no admite reproducción de audio.");
  }

  const remainingSeconds = item.expiresAt === null
    ? DOWNLOAD_URL_TTL_SECONDS
    : Math.max(1, Math.floor((Date.parse(item.expiresAt) - Date.now()) / 1000));
  const signedTtlSeconds = Math.min(DOWNLOAD_URL_TTL_SECONDS, remainingSeconds);
  const url = await createSignedB2Url(env, {
    method: "GET",
    objectName: storageKeyFor(item),
    expiresSeconds: signedTtlSeconds,
    queryParameters: mode === "download"
      ? { "response-content-type": "application/octet-stream" }
      : {}
  });

  return {
    url,
    name: item.name,
    mimeType: item.mimeType,
    expiresIn: signedTtlSeconds
  };
}

export async function resetItemTtl(env: Env, id: unknown, ttlValue: unknown, context: ItemContext = personalContext()) {
  const scope = normalizeContext(context);
  const item = await getDropItem(env, validateItemId(id));

  if (!item || item.status !== "ready" || isExpired(item)) {
    throw new HttpError(404, "item-not-found", "El elemento temporal ya no está disponible.");
  }

  assertScope(item, scope);
  const ttlMinutes = normalizeTtlMinutes(ttlValue, scope.ttlOptions);
  const expiresAt = effectiveExpiry(ttlMinutes, scope);
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE drop_items
    SET expires_at = ?2, ttl_minutes = ?3, updated_at = ?4
    WHERE id = ?1 AND status = 'ready'
  `).bind(item.id, expiresAt?.toISOString() ?? null, ttlMinutes, updatedAt).run();

  return publicItem(await getDropItem(env, item.id));
}

async function deleteItemRecord(env: Env, item: DropItem, { countDeletion = true }: { countDeletion?: boolean } = {}): Promise<void> {
  if (item.type === "file" && item.storageKey) {
    await deleteB2Object(env, storageKeyFor(item));
  }

  await deleteDropItemRow(env, item.id);

  if (countDeletion && item.status === "ready") {
    await recordDeletion(env.DB, item.type === "file" ? item.size : 0);
  }
}

export async function deleteItem(env: Env, id: unknown, context: ItemContext = personalContext()): Promise<void> {
  const item = await getDropItem(env, validateItemId(id));

  if (!item) {
    return;
  }

  assertScope(item, context);
  await deleteItemRecord(env, item);
}

async function runWithConcurrency<T>(values: readonly T[], limit: number, worker: (value: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) {
      const current = values[index];
      index += 1;
      await worker(current);
    }
  });

  await Promise.all(runners);
}

export async function deleteAllItems(env: Env) {
  let cursorCreatedAt = "";
  let cursorId = "";
  let scanned = 0;
  let deleted = 0;
  let failed = 0;

  while (true) {
    const result = await env.DB.prepare(`
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
        space_type,
        room_id,
        etag
      FROM drop_items
      WHERE ?1 = '' OR created_at > ?1 OR (created_at = ?1 AND id > ?2)
      ORDER BY created_at ASC, id ASC
      LIMIT 100
    `).bind(cursorCreatedAt, cursorId).all();
    const items = (result.results || []).map(rowToDropItem).filter((item): item is DropItem => item !== null);

    if (items.length === 0) {
      break;
    }

    const last = items[items.length - 1];
    cursorCreatedAt = last.createdAt;
    cursorId = last.id;
    scanned += items.length;

    await runWithConcurrency(items, 5, async (item) => {
      try {
        await deleteItemRecord(env, item);
        deleted += 1;
      } catch (error) {
        failed += 1;
        console.error("No fue posible eliminar un elemento durante el reinicio.", item.id, error);
      }
    });

    if (items.length < 100) {
      break;
    }
  }

  const remaining = await env.DB.prepare(`SELECT COUNT(*) AS count FROM drop_items`).first();
  const remainingCount = Number(remaining?.count || 0);

  if (failed > 0 || remainingCount > 0) {
    await recordCleanupFailure(env.DB, Math.max(failed, remainingCount)).catch(() => {});
  }

  return { scanned, deleted, failed: Math.max(failed, remainingCount), remaining: remainingCount };
}

export async function cleanupExpiredItems(env: Env) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
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
      space_type,
      room_id,
      etag
    FROM drop_items
    WHERE expires_at IS NOT NULL AND expires_at <= ?1
    ORDER BY expires_at ASC
    LIMIT ?2
  `).bind(now, MAX_CLEANUP_ITEMS).all();
  const expired = (result.results || []).map(rowToDropItem).filter((item): item is DropItem => item !== null);
  let deleted = 0;
  let failed = 0;

  await runWithConcurrency(expired, 5, async (item) => {
    try {
      await deleteItemRecord(env, item);
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error("No fue posible limpiar un elemento expirado.", item.id, error);
    }
  });

  if (failed > 0) {
    await recordCleanupFailure(env.DB, failed).catch(() => {});
  }

  return { scanned: expired.length, expired: expired.length, deleted, failed };
}

export async function deleteItemsForRoom(env: Env, roomId: string) {
  const result = await env.DB.prepare(`
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
      space_type,
      room_id,
      etag
    FROM drop_items
    WHERE space_type = 'room' AND room_id = ?1
    ORDER BY created_at ASC
  `).bind(String(roomId || "")).all();
  const items = (result.results || []).map(rowToDropItem).filter((item): item is DropItem => item !== null);
  let deleted = 0;
  let failed = 0;

  await runWithConcurrency(items, 4, async (item) => {
    try {
      await deleteItemRecord(env, item);
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error("No fue posible limpiar un elemento de sala.", item.id, error);
    }
  });

  return { scanned: items.length, deleted, failed };
}
