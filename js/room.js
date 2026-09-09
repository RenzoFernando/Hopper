import { hopperApi } from "./api.js";
import { appConfig } from "./config.js";
import { bindRoomCodeInput, isCompleteRoomCode, normalizeRoomCode } from "./room-code.js";
import { createTransferController } from "./transfer-controller.js";

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
  roomTimer: null,
  lastActivitySentAt: 0,
  activityPromise: null
};

function showToast(message, type = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${type ? `is-${type}` : ""}`.trim();
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function setMessage(message, type = "") {
  elements.roomMessage.textContent = message;
  elements.roomMessage.className = `form-message ${type ? `is-${type}` : ""}`.trim();
  elements.roomMessage.hidden = !message;
}

function setJoining(joining) {
  state.joining = joining;
  elements.roomCodeInput.disabled = joining;
  elements.roomLoader.hidden = !joining;
  elements.roomForm.querySelector("button[type='submit']").disabled = joining;
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

function leaveToHome() {
  stopTransfer();
  hopperApi.clearRoomSession();
  window.location.replace("./");
}

async function markRoomActivity({ force = false } = {}) {
  if (!state.room || state.activityPromise) {
    return state.activityPromise;
  }

  const now = Date.now();

  if (!force && now - state.lastActivitySentAt < 30_000) {
    return null;
  }

  state.lastActivitySentAt = now;
  state.activityPromise = hopperApi.roomActivity()
    .then((result) => {
      if (result?.room) {
        state.room = result.room;
        updateRoomCountdown();
      }
      return result;
    })
    .catch((error) => {
      if (error?.status === 401 || error?.code === "invalid-room-session") {
        leaveToHome();
      }
      return null;
    })
    .finally(() => {
      state.activityPromise = null;
    });

  return state.activityPromise;
}

function createRoomTransfer(room) {
  return createTransferController({
    api: {
      listItems: () => hopperApi.roomListItems(),
      createText: (content) => hopperApi.roomCreateText(content),
      initializeUpload: (file) => hopperApi.roomInitializeUpload(file),
      uploadToSignedUrl: (...args) => hopperApi.uploadToSignedUrl(...args),
      completeUpload: (id) => hopperApi.roomCompleteUpload(id),
      cancelUpload: (id) => hopperApi.roomCancelUpload(id),
      getFileUrl: (id, mode) => hopperApi.roomGetFileUrl(id, mode),
      deleteItem: (id) => hopperApi.roomDeleteItem(id)
    },
    maxFileBytes: Number(room.maxFileBytes) || appConfig.roomMaxFileBytes,
    defaultTtlMinutes: 5,
    ttlOptions: [5],
    allowTtlReset: false,
    pollIntervalMs: appConfig.pollIntervalMs,
    uploadConcurrency: appConfig.uploadConcurrency,
    maxSelectedFiles: Math.min(20, Number(room.maxItems) || 20),
    onActivity: () => markRoomActivity(),
    onUnauthorized: leaveToHome
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
    leaveToHome();
  }
}

async function enterRoom(room, code = "") {
  stopTransfer();
  state.room = room;
  state.code = code || rememberedCode(room.id);
  state.lastActivitySentAt = Date.now();
  elements.roomName.textContent = state.code || "SALA";
  elements.shareButton.hidden = !state.code;
  setWorkspace(true);
  state.transfer = createRoomTransfer(room);
  state.roomTimer = window.setInterval(updateRoomCountdown, 1000);
  updateRoomCountdown();

  try {
    await state.transfer.start();
  } catch (error) {
    if (error?.status === 401 || error?.code === "invalid-room-session") {
      leaveToHome();
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

  const code = normalizeRoomCode(elements.roomCodeInput.value);
  elements.roomCodeInput.value = code;

  if (!isCompleteRoomCode(code)) {
    setMessage("Código no válido.", "error");
    return;
  }

  setJoining(true);
  setMessage("");

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
  const text = `Hopper\nSala: ${state.code}\n${url.toString()}`;

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
    showToast("Sala copiada.", "success");
  } catch {
    showToast("No fue posible compartir la sala.", "error");
  }
}

function bindEvents() {
  elements.roomForm.addEventListener("submit", joinRoom);
  bindRoomCodeInput(elements.roomCodeInput);
  elements.leaveButton.addEventListener("click", leaveToHome);
  elements.shareButton.addEventListener("click", shareRoom);
  window.addEventListener("hopper:room-session-expired", leaveToHome);

  for (const eventName of ["pointerdown", "keydown", "input", "touchstart"]) {
    document.addEventListener(eventName, () => {
      if (!elements.workspaceScreen.hidden) {
        markRoomActivity();
      }
    }, { passive: true, capture: true });
  }
}

async function registerPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js", { scope: "./", updateViaCache: "none" }).catch(() => {});
  }
}

async function initialize() {
  bindEvents();
  registerPwa();
  const normalizedHash = normalizeRoomCode(decodeURIComponent(window.location.hash.slice(1)));
  const hasInviteCode = isCompleteRoomCode(normalizedHash);

  if (hasInviteCode) {
    elements.roomCodeInput.value = normalizedHash;
    const storedRoomSession = hopperApi.getRoomSession();
    const storedRoomCode = storedRoomSession?.roomId ? rememberedCode(storedRoomSession.roomId) : "";

    if (storedRoomSession && storedRoomCode && storedRoomCode !== normalizedHash) {
      hopperApi.clearRoomSession();
    }
  }

  if (hopperApi.hasRoomSession()) {
    try {
      const result = await hopperApi.roomStatus();
      const code = rememberedCode(result.room.id);

      if (!hasInviteCode || !code || code === normalizedHash) {
        await enterRoom(result.room, code || normalizedHash);
        return;
      }

      hopperApi.clearRoomSession();
    } catch {
      hopperApi.clearRoomSession();
    }
  }

  if (hasInviteCode) {
    elements.roomCodeInput.value = normalizedHash;
    await joinRoom();
    return;
  }

  setWorkspace(false);
  setMessage("");
}

initialize();
