import { hopperApi } from "./api.js";
import { appConfig } from "./config.js";
import { formatBytes } from "./transfer-controller.js";

const SHARE_DB = "hopper-share-target-v1";
const elements = {
  summary: document.querySelector("#share-summary"),
  destination: document.querySelector("#share-destination"),
  ttl: document.querySelector("#share-ttl"),
  ttlField: document.querySelector("#share-ttl-field"),
  send: document.querySelector("#share-send"),
  discard: document.querySelector("#share-discard"),
  message: document.querySelector("#share-message"),
  progress: document.querySelector("#share-progress")
};

let payload = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("payloads")) {
        request.result.createObjectStore("payloads");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readPayload() {
  const db = await openDb();
  const value = await new Promise((resolve, reject) => {
    const transaction = db.transaction("payloads", "readonly");
    const request = transaction.objectStore("payloads").get("pending");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

async function clearPayload() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("payloads", "readwrite");
    transaction.objectStore("payloads").delete("pending");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function setMessage(message, type = "") {
  elements.message.textContent = message;
  elements.message.className = `form-message ${type ? `is-${type}` : ""}`.trim();
}

function roomLabel() {
  const session = hopperApi.getRoomSession();

  if (!session?.roomId) {
    return "Sala activa";
  }

  return hopperApi.getRememberedRoomCodes()?.[session.roomId]?.code || "Sala activa";
}


function configureTtlOptions() {
  const current = Number(elements.ttl.value) || appConfig.defaultTtlMinutes;
  const roomDestination = elements.destination.value === "room";
  const values = roomDestination ? [5] : [5, 15, 30, 60, 360];
  elements.ttlField.hidden = roomDestination;
  const labels = new Map([
    [5, "5 min"],
    [15, "15 min"],
    [30, "30 min"],
    [60, "1 hora"],
    [360, "6 horas"]
  ]);

  elements.ttl.replaceChildren();

  for (const value of values) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = labels.get(value);
    elements.ttl.append(option);
  }

  elements.ttl.value = String(values.includes(current) ? current : 5);
}

function configureDestinations() {
  elements.destination.replaceChildren();

  if (hopperApi.hasSession()) {
    const option = document.createElement("option");
    option.value = "personal";
    option.textContent = "Mi espacio";
    elements.destination.append(option);
  }

  if (hopperApi.hasRoomSession()) {
    const option = document.createElement("option");
    option.value = "room";
    option.textContent = roomLabel();
    elements.destination.append(option);
  }

  if (elements.destination.options.length === 0) {
    elements.send.disabled = true;
    setMessage("Abre Hopper e inicia sesión en Mi espacio o en una sala antes de volver a compartir.", "error");
    return;
  }

  configureTtlOptions();
}

function renderSummary() {
  elements.summary.replaceChildren();
  const text = [payload?.title, payload?.text, payload?.url].filter(Boolean).join("\n").trim();
  const files = Array.from(payload?.files || []);

  if (text) {
    const row = document.createElement("div");
    row.className = "share-item";
    row.textContent = `Texto · ${text.length.toLocaleString("es-CO")} caracteres`;
    elements.summary.append(row);
  }

  for (const file of files) {
    const row = document.createElement("div");
    row.className = "share-item";
    row.textContent = `${file.name || "Archivo compartido"} · ${formatBytes(file.size)}`;
    elements.summary.append(row);
  }

  if (!text && files.length === 0) {
    setMessage("No hay contenido compartido pendiente.", "error");
    elements.send.disabled = true;
  }
}

function selectedApi() {
  if (elements.destination.value === "room") {
    return {
      createText: (content, ttl) => hopperApi.roomCreateText(content, ttl),
      initializeUpload: (file, ttl) => hopperApi.roomInitializeUpload(file, ttl),
      completeUpload: (id) => hopperApi.roomCompleteUpload(id),
      cancelUpload: (id) => hopperApi.roomCancelUpload(id),
      maxFileBytes: appConfig.roomMaxFileBytes,
      target: "room.html"
    };
  }

  return {
    createText: (content, ttl) => hopperApi.createText(content, ttl),
    initializeUpload: (file, ttl) => hopperApi.initializeUpload(file, ttl),
    completeUpload: (id) => hopperApi.completeUpload(id),
    cancelUpload: (id) => hopperApi.cancelUpload(id),
    maxFileBytes: appConfig.maxFileBytes,
    target: "./"
  };
}

async function confirmWithRetry(api, id) {
  let lastError = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await api.completeUpload(id);
    } catch (error) {
      lastError = error;

      if (!["upload-not-found", "storage-error", "network-error"].includes(error?.code) || attempt === 3) {
        throw error;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function putSharedFileWithRetry(file, uploadUrl, onProgress, mimeType) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await hopperApi.uploadToSignedUrl(file, uploadUrl, onProgress, mimeType);
      return;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;

      if (!retryable || attempt === 1) {
        throw error;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 900));
    }
  }

  throw lastError;
}

async function uploadFile(api, file, ttl, index, total) {
  if (file.size > api.maxFileBytes) {
    throw new Error(`${file.name || "El archivo"} supera el límite de ${formatBytes(api.maxFileBytes)}.`);
  }

  let uploadId = "";

  try {
    elements.progress.textContent = `${index + 1}/${total} · Preparando ${file.name || "archivo"}`;
    const initialized = await api.initializeUpload(file, ttl);
    uploadId = initialized?.upload?.id || "";
    const uploadUrl = initialized?.upload?.uploadUrl || "";

    if (!uploadId || !uploadUrl) {
      throw new Error("Hopper no devolvió una URL de subida válida.");
    }

    await putSharedFileWithRetry(
      file,
      uploadUrl,
      (progress) => {
        elements.progress.textContent = `${index + 1}/${total} · ${progress}% · ${file.name || "archivo"}`;
      },
      initialized?.upload?.mimeType || file.type || "application/octet-stream"
    );
    elements.progress.textContent = `${index + 1}/${total} · 100% · Confirmando`;
    await confirmWithRetry(api, uploadId);
  } catch (error) {
    if (uploadId) {
      api.cancelUpload(uploadId).catch(() => {});
    }

    throw error;
  }
}

async function runWithConcurrency(values, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) {
      const currentIndex = index;
      index += 1;
      await worker(values[currentIndex], currentIndex);
    }
  });
  await Promise.all(runners);
}

async function sendPayload() {
  if (!payload || elements.send.disabled) {
    return;
  }

  const api = selectedApi();
  const ttl = Number(elements.ttl.value) || 5;
  const text = [payload.title, payload.text, payload.url].filter(Boolean).join("\n").trim();
  const files = Array.from(payload.files || []);
  elements.send.disabled = true;
  elements.discard.disabled = true;
  setMessage("Enviando…");

  try {
    if (text) {
      await api.createText(text, ttl);
    }

    await runWithConcurrency(files, appConfig.uploadConcurrency, (file, index) => uploadFile(api, file, ttl, index, files.length));
    await clearPayload();
    setMessage("Contenido enviado.", "success");
    window.setTimeout(() => window.location.replace(api.target), 350);
  } catch (error) {
    setMessage(error.message || "No fue posible enviar el contenido compartido.", "error");
    elements.send.disabled = false;
    elements.discard.disabled = false;
  }
}

async function discardPayload() {
  elements.discard.disabled = true;
  await clearPayload().catch(() => {});
  window.location.replace("./");
}

async function initialize() {
  configureDestinations();
  payload = await readPayload().catch(() => null);

  if (payload?.createdAt && payload.createdAt < Date.now() - 10 * 60 * 1000) {
    await clearPayload().catch(() => {});
    payload = null;
  }

  renderSummary();
  elements.destination.addEventListener("change", configureTtlOptions);
  elements.send.addEventListener("click", sendPayload);
  elements.discard.addEventListener("click", discardPayload);
}

initialize();
