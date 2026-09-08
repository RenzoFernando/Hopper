import { hopperApi } from "./api.js?v=20260908-4";
import { appConfig } from "./config.js?v=20260908-4";
import { createTransferController } from "./transfer-controller.js?v=20260908-4";

const elements = {
  joinScreen: document.querySelector("#room-join-screen"),
  workspaceScreen: document.querySelector("#workspace-screen"),
  headerSession: document.querySelector("#header-session"),
  roomForm: document.querySelector("#room-form"),
  roomCodeInput: document.querySelector("#room-code-input"),
  roomMessage: document.querySelector("#room-message"),
  roomLoader: document.querySelector("#room-loader"),
  roomName: document.querySelector("#room-name"),
  roomExpiry: document.querySelector("#room-expiry"),
  leaveButton: document.querySelector("#leave-room-button"),
  shareButton: document.querySelector("#share-room-button"),
  toastRegion: document.querySelector("#toast-region")
};

const state = {
  joining: false,
  room: null,
  code: "",
  transfer: null,
  roomTimer: null
};

function showToast(message, type = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${type ? `is-${type}` : ""}`.trim();
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function normalizeCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

  if (compact.length <= 2) {
    return compact;
  }

  return `${compact.slice(0, 2)}-${compact.slice(2)}`;
}

function setMessage(message, type = "") {
  elements.roomMessage.textContent = message;
  elements.roomMessage.className = `form-message ${type ? `is-${type}` : ""}`.trim();
}

function setJoining(joining) {
  state.joining = joining;
  elements.roomCodeInput.disabled = joining;
  elements.roomLoader.hidden = !joining;
  const button = elements.roomForm.querySelector("button[type='submit']");
  button.disabled = joining;
}

function rememberedCode(roomId) {
  return hopperApi.getRememberedRoomCodes()?.[roomId]?.code || "";
}

function setWorkspace(active) {
  elements.joinScreen.hidden = active;
  elements.workspaceScreen.hidden = !active;
  elements.headerSession.hidden = !active;

  if (!active) {
    requestAnimationFrame(() => elements.roomCodeInput.focus());
  }
}

function stopTransfer() {
  state.transfer?.stop();
  state.transfer = null;
  clearInterval(state.roomTimer);
  state.roomTimer = null;
}

function returnToJoin(message = "Ingresa el código de la sala.", type = "") {
  stopTransfer();
  hopperApi.clearRoomSession();
  state.room = null;
  state.code = "";
  setWorkspace(false);
  setJoining(false);
  setMessage(message, type);
}

function createRoomTransfer(room) {
  return createTransferController({
    api: {
      listItems: () => hopperApi.roomListItems(),
      createText: (content, ttl) => hopperApi.roomCreateText(content, ttl),
      initializeUpload: (file, ttl) => hopperApi.roomInitializeUpload(file, ttl),
      uploadToSignedUrl: (...args) => hopperApi.uploadToSignedUrl(...args),
      completeUpload: (id) => hopperApi.roomCompleteUpload(id),
      cancelUpload: (id) => hopperApi.roomCancelUpload(id),
      getFileUrl: (id, mode) => hopperApi.roomGetFileUrl(id, mode),
      resetTtl: (id, ttl) => hopperApi.roomResetTtl(id, ttl),
      deleteItem: (id) => hopperApi.roomDeleteItem(id)
    },
    maxFileBytes: Number(room.maxFileBytes) || appConfig.roomMaxFileBytes,
    defaultTtlMinutes: appConfig.roomDefaultTtlMinutes,
    ttlOptions: [5, 15, 30, 60],
    pollIntervalMs: appConfig.pollIntervalMs,
    uploadConcurrency: appConfig.uploadConcurrency,
    maxSelectedFiles: Math.min(20, Number(room.maxItems) || 20),
    onUnauthorized: () => returnToJoin("La sala cerró o la sesión venció.", "error")
  });
}

function updateRoomCountdown() {
  if (!state.room) {
    return;
  }

  const remaining = Math.max(0, Date.parse(state.room.expiresAt) - Date.now());
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  elements.roomExpiry.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;

  if (remaining <= 0) {
    returnToJoin("La sala expiró.", "error");
  }
}

async function enterRoom(room, code = "") {
  state.room = room;
  state.code = code || rememberedCode(room.id);
  elements.roomName.textContent = state.code || "SALA";
  elements.shareButton.hidden = !state.code;
  setWorkspace(true);
  stopTransfer();
  state.room = room;
  state.code = code || rememberedCode(room.id);
  state.transfer = createRoomTransfer(room);
  state.roomTimer = window.setInterval(updateRoomCountdown, 1000);
  updateRoomCountdown();

  try {
    await state.transfer.start();
  } catch (error) {
    if (error?.status === 401) {
      returnToJoin("La sala cerró o la sesión venció.", "error");
      return;
    }

    state.transfer.showToast(error.message || "No fue posible cargar la sala.", "error");
  }
}

async function joinRoom(event) {
  event?.preventDefault();

  if (state.joining) {
    return;
  }

  const code = normalizeCode(elements.roomCodeInput.value);
  elements.roomCodeInput.value = code;

  if (!/^[A-Z]{2}-\d{4}$/.test(code)) {
    setMessage("El código debe tener el formato RX-4821.", "error");
    return;
  }

  setJoining(true);
  setMessage("Verificando sala…");

  try {
    const result = await hopperApi.joinRoom(code);
    await enterRoom(result.room, code);
  } catch (error) {
    setMessage(error.message || "No fue posible entrar a la sala.", "error");
  } finally {
    setJoining(false);
  }
}

async function shareRoom() {
  if (!state.code || !state.room) {
    return;
  }

  const url = new URL(window.location.href);
  url.hash = state.code;
  const minutes = Math.max(1, Math.ceil((Date.parse(state.room.expiresAt) - Date.now()) / 60000));
  const text = `Hopper\nSala: ${state.code}\nEnlace: ${url.toString()}\nExpira en: ${minutes} min`;

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Hopper", text, url: url.toString() });
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("Invitación copiada.", "success");
  } catch {
    showToast("No fue posible compartir la invitación.", "error");
  }
}

function bindEvents() {
  elements.roomForm.addEventListener("submit", joinRoom);
  elements.roomCodeInput.addEventListener("input", () => {
    const cursor = elements.roomCodeInput.selectionStart;
    const normalized = normalizeCode(elements.roomCodeInput.value);
    elements.roomCodeInput.value = normalized;
    elements.roomCodeInput.setSelectionRange(Math.min(cursor + (normalized.length === 3 ? 1 : 0), normalized.length), Math.min(cursor + (normalized.length === 3 ? 1 : 0), normalized.length));
  });
  elements.leaveButton.addEventListener("click", () => returnToJoin("Saliste de la sala."));
  elements.shareButton.addEventListener("click", shareRoom);
  window.addEventListener("hopper:room-session-expired", () => returnToJoin("La sala cerró o la sesión venció.", "error"));
}

async function registerPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js", { scope: "./", updateViaCache: "none" }).catch(() => {});
  }
}

async function initialize() {
  bindEvents();
  registerPwa();
  const hashCode = decodeURIComponent(window.location.hash.slice(1));
  const normalizedHash = normalizeCode(hashCode);

  if (/^[A-Z]{2}-\d{4}$/.test(normalizedHash)) {
    elements.roomCodeInput.value = normalizedHash;
    setMessage(`Sala ${normalizedHash}. Confirma para entrar.`);
  }

  if (hopperApi.hasRoomSession()) {
    try {
      const result = await hopperApi.roomStatus();
      await enterRoom(result.room, rememberedCode(result.room.id) || normalizedHash);
      return;
    } catch {
      hopperApi.clearRoomSession();
    }
  }

  setWorkspace(false);
}

initialize();
