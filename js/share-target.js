import { hopperApi } from "./api.js";
import { appConfig } from "./config.js";
import { bindRoomCodeInput, isCompleteRoomCode, normalizeRoomCode } from "./room-code.js";
import { formatBytes } from "./transfer-controller.js";

const SHARE_DB = "hopper-share-target-v1";
const elements = {
  summary: document.querySelector("#share-summary"),
  auth: document.querySelector("#share-auth"),
  authCopy: document.querySelector("#share-auth-copy"),
  authDivider: document.querySelector("#share-auth-divider"),
  pinForm: document.querySelector("#share-pin-form"),
  pinInput: document.querySelector("#share-pin"),
  pinSubmit: document.querySelector("#share-pin-submit"),
  pinMessage: document.querySelector("#share-pin-message"),
  roomForm: document.querySelector("#share-room-form"),
  roomCodeInput: document.querySelector("#share-room-code"),
  roomSubmit: document.querySelector("#share-room-submit"),
  roomMessage: document.querySelector("#share-room-message"),
  destinationField: document.querySelector("#share-destination-field"),
  destination: document.querySelector("#share-destination"),
  ttl: document.querySelector("#share-ttl"),
  ttlField: document.querySelector("#share-ttl-field"),
  send: document.querySelector("#share-send"),
  discard: document.querySelector("#share-discard"),
  message: document.querySelector("#share-message"),
  progress: document.querySelector("#share-progress")
};

let payload = null;
let authBusy = false;
let sendBusy = false;
let pendingDelivery = null;

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

async function writePayload(value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("payloads", "readwrite");
    transaction.objectStore("payloads").put(value, "pending");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
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

function setAuthMessage(element, message, type = "") {
  element.textContent = message;
  element.className = `share-auth-message ${type ? `is-${type}` : ""}`.trim();
  element.hidden = !message;
}

function normalizePinInput() {
  const normalized = String(elements.pinInput.value || "").replace(/\D/g, "").slice(0, 4);

  if (elements.pinInput.value !== normalized) {
    elements.pinInput.value = normalized;
  }

  return normalized;
}

function payloadHasContent() {
  const text = [payload?.title, payload?.text, payload?.url].filter(Boolean).join("\n").trim();
  const files = Array.from(payload?.files || []);
  return Boolean(text || files.length > 0);
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
  elements.ttlField.hidden = elements.destination.options.length === 0 || roomDestination;
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

function configureDestinations(preferred = "") {
  const current = preferred || elements.destination.value;
  const hasPersonalSession = hopperApi.hasSession();
  const hasRoomSession = hopperApi.hasRoomSession();
  elements.destination.replaceChildren();

  if (hasPersonalSession) {
    const option = document.createElement("option");
    option.value = "personal";
    option.textContent = "Mi espacio";
    elements.destination.append(option);
  }

  if (hasRoomSession) {
    const option = document.createElement("option");
    option.value = "room";
    option.textContent = roomLabel();
    elements.destination.append(option);
  }

  if ([...elements.destination.options].some((option) => option.value === current)) {
    elements.destination.value = current;
  }

  const hasDestination = elements.destination.options.length > 0;
  elements.destinationField.hidden = !hasDestination;
  elements.pinForm.hidden = hasPersonalSession;
  elements.roomForm.hidden = hasRoomSession;
  elements.authDivider.hidden = hasPersonalSession || hasRoomSession;
  elements.auth.hidden = hasPersonalSession && hasRoomSession;
  elements.authCopy.textContent = hasDestination
    ? "Puedes añadir otro destino antes de enviar."
    : "Accede a Mi espacio o entra a una sala para elegir el destino.";
  elements.send.disabled = sendBusy || !hasDestination || !payloadHasContent();

  if (hasDestination) {
    configureTtlOptions();
  } else {
    elements.ttlField.hidden = true;
  }
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

async function handlePinSubmit(event) {
  event.preventDefault();

  if (authBusy) {
    return;
  }

  const pin = normalizePinInput();

  if (pin.length !== 4) {
    setAuthMessage(elements.pinMessage, "Escribe los cuatro dígitos del PIN.", "error");
    return;
  }

  authBusy = true;
  elements.pinInput.disabled = true;
  elements.pinSubmit.disabled = true;
  setAuthMessage(elements.pinMessage, "");

  try {
    const result = await hopperApi.login(pin);

    if (result?.status === "authorized") {
      elements.pinInput.value = "";
      configureDestinations("personal");
      elements.auth.hidden = true;
      elements.destinationField.hidden = true;
      elements.ttlField.hidden = true;
      await sendPayload("personal");
      return;
    }

    if (result?.status === "locked") {
      setAuthMessage(elements.pinMessage, "Hopper está bloqueado. Usa Recuperar acceso desde la página principal.", "error");
      return;
    }

    const attempts = Number(result?.remainingAttempts);
    setAuthMessage(
      elements.pinMessage,
      Number.isFinite(attempts)
        ? `PIN incorrecto. Quedan ${attempts} intento${attempts === 1 ? "" : "s"}.`
        : "PIN incorrecto.",
      "error"
    );
    elements.pinInput.value = "";
  } catch (error) {
    setAuthMessage(elements.pinMessage, error.message || "No fue posible validar el PIN.", "error");
  } finally {
    authBusy = false;
    elements.pinInput.disabled = false;
    elements.pinSubmit.disabled = false;
  }
}

async function handleRoomSubmit(event) {
  event.preventDefault();

  if (authBusy) {
    return;
  }

  const code = normalizeRoomCode(elements.roomCodeInput.value);
  elements.roomCodeInput.value = code;

  if (!isCompleteRoomCode(code)) {
    setAuthMessage(elements.roomMessage, "Código no válido.", "error");
    return;
  }

  authBusy = true;
  elements.roomCodeInput.disabled = true;
  elements.roomSubmit.disabled = true;
  setAuthMessage(elements.roomMessage, "");

  try {
    await hopperApi.joinRoom(code);
    configureDestinations("room");
    elements.auth.hidden = true;
    elements.destinationField.hidden = true;
    elements.ttlField.hidden = true;
    await sendPayload("room");
  } catch (error) {
    setAuthMessage(elements.roomMessage, error.message || "No fue posible entrar a la sala.", "error");
  } finally {
    authBusy = false;
    elements.roomCodeInput.disabled = false;
    elements.roomSubmit.disabled = false;
  }
}

function restorePendingDelivery() {
  const saved = payload?.delivery;

  if (!saved || !["personal", "room"].includes(saved.destination)) {
    pendingDelivery = null;
    return;
  }

  const fileIds = new Map();

  for (const [index, id] of Object.entries(saved.fileIds || {})) {
    const numericIndex = Number(index);
    const itemId = String(id || "");

    if (Number.isInteger(numericIndex) && numericIndex >= 0 && itemId) {
      fileIds.set(numericIndex, itemId);
    }
  }

  pendingDelivery = {
    destination: saved.destination,
    textId: String(saved.textId || ""),
    fileIds
  };
}

async function persistPendingDelivery() {
  if (!payload || !pendingDelivery) {
    return;
  }

  payload.delivery = {
    destination: pendingDelivery.destination,
    textId: pendingDelivery.textId,
    fileIds: Object.fromEntries(
      [...pendingDelivery.fileIds.entries()].map(([index, id]) => [String(index), id])
    )
  };
  await writePayload(payload);
}

function selectedApi(destination = elements.destination.value) {
  if (destination === "room") {
    return {
      destination: "room",
      createText: (content, ttl) => hopperApi.roomCreateText(content, ttl),
      initializeUpload: (file, ttl) => hopperApi.roomInitializeUpload(file, ttl),
      completeUpload: (id) => hopperApi.roomCompleteUpload(id),
      cancelUpload: (id) => hopperApi.roomCancelUpload(id),
      listItems: () => hopperApi.roomListItems(),
      maxFileBytes: appConfig.roomMaxFileBytes,
      target: "room.html"
    };
  }

  return {
    destination: "personal",
    createText: (content, ttl) => hopperApi.createText(content, ttl),
    initializeUpload: (file, ttl) => hopperApi.initializeUpload(file, ttl),
    completeUpload: (id) => hopperApi.completeUpload(id),
    cancelUpload: (id) => hopperApi.cancelUpload(id),
    listItems: () => hopperApi.listItems(),
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
    const confirmed = await confirmWithRetry(api, uploadId);
    const confirmedId = String(confirmed?.item?.id || "");

    if (!confirmedId || confirmedId !== uploadId) {
      throw new Error("Hopper no confirmó correctamente el archivo compartido.");
    }

    return confirmedId;
  } catch (error) {
    if (uploadId) {
      api.cancelUpload(uploadId).catch(() => {});
    }

    throw error;
  }
}

async function runWithConcurrency(values, limit, worker) {
  const results = new Array(values.length);
  const errors = new Array(values.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, Number(limit) || 1), values.length) }, async () => {
    while (index < values.length) {
      const currentIndex = index;
      index += 1;

      try {
        results[currentIndex] = await worker(values[currentIndex], currentIndex);
      } catch (error) {
        errors[currentIndex] = error;
      }
    }
  });
  await Promise.all(runners);
  const failure = errors.find(Boolean);

  if (failure) {
    throw failure;
  }

  return results;
}

async function verifyDelivered(api, itemIds) {
  const expected = new Set(itemIds.filter(Boolean));

  if (expected.size === 0) {
    throw new Error("Hopper no devolvió elementos para verificar.");
  }

  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await api.listItems();
      const visible = new Set(Array.from(result?.items || []).map((item) => String(item?.id || "")));

      if ([...expected].every((id) => visible.has(id))) {
        return;
      }

      lastError = new Error("El contenido todavía no aparece en el destino.");
    } catch (error) {
      lastError = error;
    }

    if (attempt < 4) {
      await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
    }
  }

  throw lastError || new Error("No fue posible comprobar el contenido enviado.");
}

function canUseDestination(destination) {
  if (destination === "room") {
    return hopperApi.hasRoomSession();
  }

  return destination === "personal" && hopperApi.hasSession();
}

async function sendPayload(destinationOverride = "") {
  if (!payload || sendBusy || !payloadHasContent()) {
    return false;
  }

  const destination = typeof destinationOverride === "string" && destinationOverride
    ? destinationOverride
    : elements.destination.value;

  if (!canUseDestination(destination)) {
    configureDestinations();
    setMessage("Primero inicia sesión en el destino.", "error");
    return false;
  }

  if (pendingDelivery && pendingDelivery.destination !== destination) {
    setMessage(
      pendingDelivery.destination === "room"
        ? "Este contenido ya comenzó a enviarse a la sala. Termina ese envío antes de cambiar de destino."
        : "Este contenido ya comenzó a enviarse a Mi espacio. Termina ese envío antes de cambiar de destino.",
      "error"
    );
    configureDestinations(pendingDelivery.destination);
    return false;
  }

  const api = selectedApi(destination);
  const ttl = destination === "room" ? 5 : Number(elements.ttl.value) || 5;
  const text = [payload.title, payload.text, payload.url].filter(Boolean).join("\n").trim();
  const files = Array.from(payload.files || []);
  const previousSendText = elements.send.textContent;
  sendBusy = true;
  elements.send.disabled = true;
  elements.send.textContent = "Enviando…";
  elements.discard.disabled = true;
  elements.pinInput.disabled = true;
  elements.pinSubmit.disabled = true;
  elements.roomCodeInput.disabled = true;
  elements.roomSubmit.disabled = true;
  setMessage("Enviando…");
  let transferCompleted = false;

  try {
    if (!pendingDelivery) {
      pendingDelivery = {
        destination,
        textId: "",
        fileIds: new Map()
      };
    }

    if (text && !pendingDelivery.textId) {
      const created = await api.createText(text, ttl);
      const textId = String(created?.item?.id || "");

      if (!textId) {
        throw new Error("Hopper no confirmó correctamente el texto compartido.");
      }

      pendingDelivery.textId = textId;
      await persistPendingDelivery();
    }

    const pendingFiles = files
      .map((file, index) => ({ file, index }))
      .filter(({ index }) => !pendingDelivery.fileIds.has(index));

    try {
      await runWithConcurrency(
        pendingFiles,
        appConfig.uploadConcurrency,
        async ({ file, index }) => {
          const id = await uploadFile(api, file, ttl, index, files.length);
          pendingDelivery.fileIds.set(index, id);
          return id;
        }
      );
    } finally {
      await persistPendingDelivery();
    }

    if (pendingDelivery.fileIds.size !== files.length) {
      throw new Error("No todos los archivos compartidos quedaron confirmados.");
    }

    const itemIds = [
      ...(pendingDelivery.textId ? [pendingDelivery.textId] : []),
      ...[...pendingDelivery.fileIds.values()]
    ];

    elements.progress.textContent = "Comprobando el destino…";
    await verifyDelivered(api, itemIds);
    await clearPayload();
    transferCompleted = true;
    payload = null;
    pendingDelivery = null;
    elements.progress.textContent = "";
    elements.send.textContent = "Enviado";
    setMessage("Contenido enviado y confirmado.", "success");
    window.setTimeout(() => window.location.replace(api.target), 350);
    return true;
  } catch (error) {
    setMessage(error.message || "No fue posible enviar el contenido compartido.", "error");
    return false;
  } finally {
    if (!transferCompleted) {
      sendBusy = false;
      elements.send.textContent = previousSendText;
      elements.discard.disabled = false;
      elements.pinInput.disabled = authBusy;
      elements.pinSubmit.disabled = authBusy;
      elements.roomCodeInput.disabled = authBusy;
      elements.roomSubmit.disabled = authBusy;
      configureDestinations(pendingDelivery?.destination || destination);
    }
  }
}

async function discardPayload() {
  elements.discard.disabled = true;
  await clearPayload().catch(() => {});
  window.location.replace("./");
}

async function initialize() {
  payload = await readPayload().catch(() => null);

  if (payload?.createdAt && payload.createdAt < Date.now() - 10 * 60 * 1000) {
    await clearPayload().catch(() => {});
    payload = null;
  }

  restorePendingDelivery();
  renderSummary();
  configureDestinations();
  elements.pinInput.addEventListener("input", () => {
    normalizePinInput();
    setAuthMessage(elements.pinMessage, "");
  });
  elements.pinForm.addEventListener("submit", handlePinSubmit);
  elements.roomForm.addEventListener("submit", handleRoomSubmit);
  bindRoomCodeInput(elements.roomCodeInput, () => setAuthMessage(elements.roomMessage, ""));
  elements.destination.addEventListener("change", configureTtlOptions);
  elements.send.addEventListener("click", () => sendPayload());
  elements.discard.addEventListener("click", discardPayload);
  window.addEventListener("hopper:session-expired", () => configureDestinations());
  window.addEventListener("hopper:room-session-expired", () => configureDestinations());
}

initialize();