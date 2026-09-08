import {
  DEFAULT_MAX_FILE_BYTES,
  MAX_FIRESTORE_SCAN,
  MAX_LIST_ITEMS,
  MAX_TEXT_CHARACTERS,
  PENDING_UPLOAD_TTL_SECONDS,
  TTL_OPTIONS,
  UPLOAD_URL_TTL_SECONDS,
  DOWNLOAD_URL_TTL_SECONDS
} from "./constants.js";
import { rfc3986Encode } from "./crypto.js";
import {
  createSignedStorageUrl,
  deleteStorageObject,
  firestoreRequest,
  getStorageObjectMetadata,
  requireGoogleOk
} from "./google.js";
import { HttpError, normalizeText } from "./http.js";

function firestoreString(value) {
  return { stringValue: String(value) };
}

function firestoreInteger(value) {
  return { integerValue: String(Math.trunc(Number(value))) };
}

function firestoreTimestamp(value) {
  return { timestampValue: new Date(value).toISOString() };
}

function documentId(document) {
  const name = String(document?.name || "");
  return name.split("/").pop() || "";
}

function fieldString(fields, name) {
  return String(fields?.[name]?.stringValue || "");
}

function fieldInteger(fields, name) {
  return Number(fields?.[name]?.integerValue || 0);
}

function fieldTimestamp(fields, name) {
  return String(fields?.[name]?.timestampValue || "");
}

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

function dropItemPath(id) {
  return `/dropItems/${encodeURIComponent(validateItemId(id))}`;
}

async function createDropItem(env, id, fields) {
  const query = new URLSearchParams({ documentId: id });
  const response = await firestoreRequest(env, `/dropItems?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });

  return requireGoogleOk(response, "Firestore no pudo crear el elemento temporal.");
}

async function updateDropItem(env, id, fields) {
  const query = new URLSearchParams();

  for (const field of Object.keys(fields)) {
    query.append("updateMask.fieldPaths", field);
  }

  query.set("currentDocument.exists", "true");
  const response = await firestoreRequest(env, `${dropItemPath(id)}?${query.toString()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });

  return requireGoogleOk(response, "Firestore no pudo actualizar el elemento temporal.");
}

async function deleteDropItemDocument(env, id) {
  const response = await firestoreRequest(
    env,
    `${dropItemPath(id)}?currentDocument.exists=true`,
    { method: "DELETE" }
  );

  if (response.status === 404) {
    return;
  }

  await requireGoogleOk(response, "Firestore no pudo eliminar el elemento temporal.");
}

export async function getDropItem(env, id) {
  const response = await firestoreRequest(env, dropItemPath(id), { method: "GET" });

  if (response.status === 404) {
    return null;
  }

  const document = await requireGoogleOk(response, "Firestore no pudo leer el elemento temporal.");
  return parseDropItem(document);
}

export function parseDropItem(document) {
  const fields = document?.fields || {};
  const type = fieldString(fields, "type");
  const item = {
    id: documentId(document),
    type,
    status: fieldString(fields, "status"),
    createdAt: fieldTimestamp(fields, "createdAt"),
    expiresAt: fieldTimestamp(fields, "expiresAt"),
    ttlMinutes: fieldInteger(fields, "ttlMinutes")
  };

  if (type === "text") {
    item.content = fieldString(fields, "content");
  }

  if (type === "file") {
    item.name = fieldString(fields, "name");
    item.size = fieldInteger(fields, "size");
    item.mimeType = fieldString(fields, "mimeType") || "application/octet-stream";
    item.storagePath = fieldString(fields, "storagePath");
  }

  return item;
}

async function listDropDocuments(env, maxDocuments = MAX_FIRESTORE_SCAN) {
  const documents = [];
  let pageToken = "";

  while (documents.length < maxDocuments) {
    const query = new URLSearchParams({ pageSize: "100" });

    if (pageToken) {
      query.set("pageToken", pageToken);
    }

    const response = await firestoreRequest(env, `/dropItems?${query.toString()}`, { method: "GET" });
    const payload = await requireGoogleOk(response, "Firestore no pudo listar los elementos temporales.");
    const page = Array.isArray(payload?.documents) ? payload.documents : [];
    documents.push(...page);
    pageToken = String(payload?.nextPageToken || "");

    if (!pageToken || page.length === 0) {
      break;
    }
  }

  return documents.slice(0, maxDocuments);
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
  const now = Date.now();
  const documents = await listDropDocuments(env);

  return documents
    .map(parseDropItem)
    .filter((item) => item.status === "ready" && !isExpired(item, now))
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))
    .slice(0, MAX_LIST_ITEMS)
    .map((item) => ({
      ...item,
      previewable: isPreviewableImage(item),
      ...(item.type === "file" ? { storagePath: undefined } : {})
    }));
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
  const document = await createDropItem(env, id, {
    type: firestoreString("text"),
    status: firestoreString("ready"),
    content: firestoreString(content),
    createdAt: firestoreTimestamp(createdAt),
    expiresAt: firestoreTimestamp(expiresAt),
    ttlMinutes: firestoreInteger(ttlMinutes)
  });

  return parseDropItem(document);
}

export async function initializeFileUpload(env, payload) {
  const file = validateFileMetadata(env, payload);
  const id = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PENDING_UPLOAD_TTL_SECONDS * 1000);
  const storagePath = `drop/${id}/${file.name}`;

  await createDropItem(env, id, {
    type: firestoreString("file"),
    status: firestoreString("pending"),
    name: firestoreString(file.name),
    size: firestoreInteger(file.size),
    mimeType: firestoreString(file.mimeType),
    storagePath: firestoreString(storagePath),
    createdAt: firestoreTimestamp(createdAt),
    expiresAt: firestoreTimestamp(expiresAt),
    ttlMinutes: firestoreInteger(file.ttlMinutes)
  });

  try {
    const uploadUrl = await createSignedStorageUrl(env, {
      method: "PUT",
      objectName: storagePath,
      expiresSeconds: UPLOAD_URL_TTL_SECONDS
    });

    return {
      id,
      uploadUrl,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType
    };
  } catch (error) {
    await deleteDropItemDocument(env, id).catch(() => {});
    throw error;
  }
}

export async function completeFileUpload(env, id) {
  const item = await getDropItem(env, validateItemId(id));

  if (!item || item.type !== "file") {
    throw new HttpError(404, "item-not-found", "El archivo temporal no existe.");
  }

  if (item.status === "ready" && !isExpired(item)) {
    return { ...item, storagePath: undefined, previewable: isPreviewableImage(item) };
  }

  if (item.status !== "pending" || isExpired(item)) {
    throw new HttpError(410, "upload-expired", "La ventana de subida de este archivo ya venció.");
  }

  const metadata = await getStorageObjectMetadata(env, item.storagePath);

  if (!metadata) {
    throw new HttpError(409, "upload-not-found", "Storage todavía no confirma la subida del archivo.");
  }

  const actualSize = Number(metadata.size || 0);

  if (actualSize !== item.size) {
    await deleteStorageObject(env, item.storagePath).catch(() => {});
    await deleteDropItemDocument(env, item.id).catch(() => {});
    throw new HttpError(409, "upload-size-mismatch", "La subida quedó incompleta y fue descartada.");
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + item.ttlMinutes * 60_000);
  const mimeType = normalizeMimeType(metadata.contentType || item.mimeType);
  const document = await updateDropItem(env, item.id, {
    status: firestoreString("ready"),
    createdAt: firestoreTimestamp(createdAt),
    expiresAt: firestoreTimestamp(expiresAt),
    mimeType: firestoreString(mimeType),
    size: firestoreInteger(actualSize)
  });
  const readyItem = parseDropItem(document);

  return {
    ...readyItem,
    storagePath: undefined,
    previewable: isPreviewableImage(readyItem)
  };
}

export async function cancelFileUpload(env, id) {
  const item = await getDropItem(env, validateItemId(id));

  if (!item) {
    return;
  }

  if (item.type === "file" && item.storagePath) {
    await deleteStorageObject(env, item.storagePath);
  }

  await deleteDropItemDocument(env, item.id);
}

function downloadDisposition(name) {
  const fallback = String(name || "archivo")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 120);
  const encoded = rfc3986Encode(String(name || "archivo"));
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
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
  const url = await createSignedStorageUrl(env, {
    method: "GET",
    objectName: item.storagePath,
    expiresSeconds: Math.min(DOWNLOAD_URL_TTL_SECONDS, remainingSeconds),
    responseDisposition: mode === "download" ? downloadDisposition(item.name) : ""
  });

  return { url, name: item.name, mimeType: item.mimeType };
}

export async function resetItemTtl(env, id, ttlValue) {
  const item = await getDropItem(env, validateItemId(id));

  if (!item || item.status !== "ready" || isExpired(item)) {
    throw new HttpError(404, "item-not-found", "El elemento temporal ya no está disponible.");
  }

  const ttlMinutes = normalizeTtlMinutes(ttlValue);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
  const document = await updateDropItem(env, item.id, {
    expiresAt: firestoreTimestamp(expiresAt),
    ttlMinutes: firestoreInteger(ttlMinutes)
  });
  const updatedItem = parseDropItem(document);

  return {
    ...updatedItem,
    ...(updatedItem.type === "file" ? {
      storagePath: undefined,
      previewable: isPreviewableImage(updatedItem)
    } : {})
  };
}

export async function deleteItem(env, id) {
  const item = await getDropItem(env, validateItemId(id));

  if (!item) {
    return;
  }

  if (item.type === "file" && item.storagePath) {
    await deleteStorageObject(env, item.storagePath);
  }

  await deleteDropItemDocument(env, item.id);
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
  const now = Date.now();
  const documents = await listDropDocuments(env, MAX_FIRESTORE_SCAN);
  const expired = documents
    .map(parseDropItem)
    .filter((item) => isExpired(item, now));
  let deleted = 0;
  let failed = 0;

  await runWithConcurrency(expired, 5, async (item) => {
    try {
      if (item.type === "file" && item.storagePath) {
        await deleteStorageObject(env, item.storagePath);
      }

      await deleteDropItemDocument(env, item.id);
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error("No fue posible limpiar un elemento expirado.", item.id, error);
    }
  });

  return { scanned: documents.length, expired: expired.length, deleted, failed };
}
