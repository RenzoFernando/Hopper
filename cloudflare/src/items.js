import {
  DEFAULT_MAX_FILE_BYTES,
  DOWNLOAD_URL_TTL_SECONDS,
  MAX_CLEANUP_ITEMS,
  MAX_LIST_ITEMS,
  MAX_TEXT_CHARACTERS,
  PENDING_UPLOAD_TTL_SECONDS,
  TTL_OPTIONS,
  UPLOAD_URL_TTL_SECONDS
} from "./constants.js";
import { HttpError, normalizeText } from "./http.js";
import {
  createSignedB2Url,
  deleteB2Object,
  getB2ObjectMetadata
} from "./b2.js";

export function normalizeTtlMinutes(value) {
  const minutes = Number(value);

  if (!TTL_OPTIONS.includes(minutes)) {
    throw new HttpError(400, "invalid-ttl", "El tiempo de expiración seleccionado no es válido.");
  }

  return minutes;
}

export function sanitizeFilename(value) {
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

function normalizeMimeType(value) {
  const mimeType = normalizeText(value).toLowerCase().slice(0, 160);
  return mimeType || "application/octet-stream";
}

function maxFileBytes(env) {
  const configured = Number(env.MAX_FILE_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MAX_FILE_BYTES;
}

function validateFileMetadata(env, payload) {
  const name = sanitizeFilename(payload?.name);
  const size = Number(payload?.size);
  const mimeType = normalizeMimeType(payload?.mimeType);
  const ttlMinutes = normalizeTtlMinutes(payload?.ttlMinutes);

  if (!Number.isInteger(size) || size < 0) {
    throw new HttpError(400, "invalid-file-size", "El tamaño del archivo no es válido.");
  }

  if (size > maxFileBytes(env)) {
    throw new HttpError(413, "file-too-large", "El archivo supera el tamaño máximo configurado en Hopper.");
  }

  return { name, size, mimeType, ttlMinutes };
}

function validateItemId(value) {
  const id = normalizeText(value);

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new HttpError(400, "invalid-item-id", "El identificador del elemento no es válido.");
  }

  return id;
}

function rowToDropItem(row) {
  if (!row) {
    return null;
  }

  const item = {
    id: String(row.id || ""),
    type: String(row.type || ""),
    status: String(row.status || ""),
    createdAt: String(row.created_at || ""),
    expiresAt: String(row.expires_at || ""),
    ttlMinutes: Number(row.ttl_minutes || 0)
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

function publicItem(item) {
  if (!item || item.type !== "file") {
    return item;
  }

  const { storageKey: _storageKey, ...visible } = item;
  return { ...visible, previewable: isPreviewableImage(item) };
}

async function deleteDropItemRow(env, id) {
  await env.DB.prepare(`DELETE FROM drop_items WHERE id = ?1`)
    .bind(validateItemId(id))
    .run();
}

export async function getDropItem(env, id) {
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
      ttl_minutes
    FROM drop_items
    WHERE id = ?1
    LIMIT 1
  `).bind(validateItemId(id)).first();

  return rowToDropItem(row);
}

export function isExpired(item, now = Date.now()) {
  const expiresAt = Date.parse(item?.expiresAt || "");
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function isPreviewableImage(item) {
  return item?.type === "file" && [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif"
  ].includes(String(item?.mimeType || "").toLowerCase());
}

export async function listActiveItems(env) {
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
      ttl_minutes
    FROM drop_items
    WHERE status = 'ready' AND expires_at > ?1
    ORDER BY created_at DESC
    LIMIT ?2
  `).bind(now, MAX_LIST_ITEMS).all();

  return (result.results || []).map(rowToDropItem).map(publicItem);
}

export async function createTextItem(env, payload) {
  const content = String(payload?.content ?? "");
  const ttlMinutes = normalizeTtlMinutes(payload?.ttlMinutes);

  if (!content.trim()) {
    throw new HttpError(400, "empty-text", "Escribe o pega contenido antes de enviarlo.");
  }

  if (content.length > MAX_TEXT_CHARACTERS) {
    throw new HttpError(413, "text-too-large", "El texto supera el tamaño máximo permitido.");
  }

  const id = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlMinutes * 60_000);
  const now = createdAt.toISOString();

  await env.DB.prepare(`
    INSERT INTO drop_items (
      id,
      type,
      status,
      content,
      size,
      created_at,
      expires_at,
      ttl_minutes,
      updated_at
    ) VALUES (?1, 'text', 'ready', ?2, 0, ?3, ?4, ?5, ?3)
  `).bind(id, content, now, expiresAt.toISOString(), ttlMinutes).run();

  return getDropItem(env, id);
}

export async function initializeFileUpload(env, payload) {
  const file = validateFileMetadata(env, payload);
  const id = crypto.randomUUID();
  const createdAt = new Date();
  const pendingExpiresAt = new Date(createdAt.getTime() + PENDING_UPLOAD_TTL_SECONDS * 1000);
  const storageKey = `drop/${id}/${file.name}`;
  const now = createdAt.toISOString();

  await env.DB.prepare(`
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
      updated_at
    ) VALUES (?1, 'file', 'pending', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?6)
  `).bind(
    id,
    file.name,
    file.size,
    file.mimeType,
    storageKey,
    now,
    pendingExpiresAt.toISOString(),
    file.ttlMinutes
  ).run();

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
    throw error;
  }
}

export async function completeFileUpload(env, id) {
  const item = await getDropItem(env, validateItemId(id));

  if (!item || item.type !== "file") {
    throw new HttpError(404, "item-not-found", "El archivo temporal no existe.");
  }

  if (item.status === "ready" && !isExpired(item)) {
    return publicItem(item);
  }

  if (item.status !== "pending" || isExpired(item)) {
    throw new HttpError(410, "upload-expired", "La ventana de subida de este archivo ya venció.");
  }

  const metadata = await getB2ObjectMetadata(env, item.storageKey);

  if (!metadata) {
    throw new HttpError(409, "upload-not-found", "Backblaze B2 todavía no confirma la subida del archivo.");
  }

  const actualSize = Number(metadata.size || 0);

  if (actualSize !== item.size) {
    await deleteB2Object(env, item.storageKey).catch(() => {});
    await deleteDropItemRow(env, item.id).catch(() => {});
    throw new HttpError(409, "upload-size-mismatch", "La subida quedó incompleta y fue descartada.");
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + item.ttlMinutes * 60_000);
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
      updated_at = ?4
    WHERE id = ?1 AND status = 'pending'
  `).bind(item.id, actualSize, mimeType, now, expiresAt.toISOString()).run();

  const readyItem = await getDropItem(env, item.id);

  if (!readyItem || readyItem.status !== "ready") {
    throw new HttpError(409, "upload-state-conflict", "No fue posible confirmar el archivo temporal.");
  }

  return publicItem(readyItem);
}

export async function cancelFileUpload(env, id) {
  const item = await getDropItem(env, validateItemId(id));

  if (!item) {
    return;
  }

  if (item.type === "file" && item.storageKey) {
    await deleteB2Object(env, item.storageKey);
  }

  await deleteDropItemRow(env, item.id);
}

export async function createItemDownloadUrl(env, id, mode = "download") {
  const item = await getDropItem(env, validateItemId(id));

  if (!item || item.type !== "file" || item.status !== "ready") {
    throw new HttpError(404, "item-not-found", "El archivo temporal no existe.");
  }

  if (isExpired(item)) {
    throw new HttpError(410, "item-expired", "El archivo ya expiró.");
  }

  if (mode === "preview" && !isPreviewableImage(item)) {
    throw new HttpError(400, "preview-not-supported", "Este tipo de archivo no tiene vista previa.");
  }

  const remainingSeconds = Math.max(
    1,
    Math.floor((Date.parse(item.expiresAt) - Date.now()) / 1000)
  );
  const url = await createSignedB2Url(env, {
    method: "GET",
    objectName: item.storageKey,
    expiresSeconds: Math.min(DOWNLOAD_URL_TTL_SECONDS, remainingSeconds),
    queryParameters: mode === "download"
      ? { "response-content-type": "application/octet-stream" }
      : {}
  });

  return { url, name: item.name, mimeType: item.mimeType };
}

export async function resetItemTtl(env, id, ttlValue) {
  const item = await getDropItem(env, validateItemId(id));

  if (!item || item.status !== "ready" || isExpired(item)) {
    throw new HttpError(404, "item-not-found", "El elemento temporal ya no está disponible.");
  }

  const ttlMinutes = normalizeTtlMinutes(ttlValue);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE drop_items
    SET expires_at = ?2, ttl_minutes = ?3, updated_at = ?4
    WHERE id = ?1 AND status = 'ready'
  `).bind(item.id, expiresAt, ttlMinutes, updatedAt).run();

  return publicItem(await getDropItem(env, item.id));
}

export async function deleteItem(env, id) {
  const item = await getDropItem(env, validateItemId(id));

  if (!item) {
    return;
  }

  if (item.type === "file" && item.storageKey) {
    await deleteB2Object(env, item.storageKey);
  }

  await deleteDropItemRow(env, item.id);
}

async function runWithConcurrency(values, limit, worker) {
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

export async function cleanupExpiredItems(env) {
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
      ttl_minutes
    FROM drop_items
    WHERE expires_at <= ?1
    ORDER BY expires_at ASC
    LIMIT ?2
  `).bind(now, MAX_CLEANUP_ITEMS).all();
  const expired = (result.results || []).map(rowToDropItem);
  let deleted = 0;
  let failed = 0;

  await runWithConcurrency(expired, 5, async (item) => {
    try {
      if (item.type === "file" && item.storageKey) {
        await deleteB2Object(env, item.storageKey);
      }

      await deleteDropItemRow(env, item.id);
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error("No fue posible limpiar un elemento expirado.", item.id, error);
    }
  });

  return { scanned: expired.length, expired: expired.length, deleted, failed };
}
