import { hopperApi } from "./api.js?v=20260908-5";
import { appConfig } from "./config.js?v=20260908-5";
import { renderQr } from "./qrcode.js?v=20260908-5";
import { createTransferController } from "./transfer-controller.js?v=20260908-5";

const elements = {
  authScreen: document.querySelector("#auth-screen"),
  workspaceScreen: document.querySelector("#workspace-screen"),
  headerSession: document.querySelector("#header-session"),
  pinForm: document.querySelector("#pin-form"),
  pinInput: document.querySelector("#pin-input"),
  pinLoader: document.querySelector("#pin-loader"),
  pinMessage: document.querySelector("#pin-message"),
  lockPanel: document.querySelector("#lock-panel"),
  recoveryRequestButton: document.querySelector("#recovery-request-button"),
  recoveryRequestMessage: document.querySelector("#recovery-request-message"),
  logoutButton: document.querySelector("#logout-button"),
  installButton: document.querySelector("#install-button"),
  installButtonSession: document.querySelector("#install-button-session"),
  updateButton: document.querySelector("#update-button"),
  updateButtonSession: document.querySelector("#update-button-session"),
  publicNav: document.querySelector("#public-nav"),
  roomCapacity: document.querySelector("#room-capacity"),
  createRoomButton: document.querySelector("#public-create-room"),
  roomForm: document.querySelector("#public-room-form"),
  roomCodeInput: document.querySelector("#public-room-code"),
  roomJoinButton: document.querySelector("#public-room-join"),
  roomMessage: document.querySelector("#public-room-message"),
  roomDialog: document.querySelector("#room-created-dialog"),
  roomDialogClose: document.querySelector("#room-created-close"),
  roomQr: document.querySelector("#room-created-qr"),
  roomCode: document.querySelector("#room-created-code"),
  roomCopy: document.querySelector("#room-created-copy"),
  roomEnter: document.querySelector("#room-created-enter")
};

const state = {
  pinSubmitting: false,
  roomSubmitting: false,
  createdRoomCode: "",
  transfer: null,
  installPrompt: null,
  registration: null,
  capacityTimer: null
};

function normalizePinInput() {
  const normalized = String(elements.pinInput.value || "").replace(/\D/g, "").slice(0, 4);

  if (normalized !== elements.pinInput.value) {
    elements.pinInput.value = normalized;
  }

  return normalized;
}

function normalizeRoomCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return compact.length <= 2 ? compact : `${compact.slice(0, 2)}-${compact.slice(2)}`;
}

function setPinMessage(message, type = "") {
  elements.pinMessage.textContent = message;
  elements.pinMessage.className = `form-message ${type ? `is-${type}` : ""}`.trim();
  elements.pinMessage.hidden = !message;
}

function setRoomMessage(message, type = "") {
  elements.roomMessage.textContent = message;
  elements.roomMessage.className = `room-access-message ${type ? `is-${type}` : ""}`.trim();
  elements.roomMessage.hidden = !message;
}

function setPinLoading(loading) {
  elements.pinInput.disabled = loading;
  elements.pinLoader.hidden = !loading;
}

function setLocked(locked) {
  elements.lockPanel.hidden = !locked;
  elements.pinForm.hidden = locked;

  if (locked) {
    setPinMessage("El acceso está bloqueado.", "error");
  }
}

function setAuthenticated(authenticated) {
  elements.authScreen.hidden = authenticated;
  elements.workspaceScreen.hidden = !authenticated;
  elements.headerSession.hidden = !authenticated;
  elements.publicNav.hidden = authenticated;

  if (!authenticated) {
    requestAnimationFrame(() => elements.pinInput?.focus());
  }
}

function stopTransfer() {
  state.transfer?.stop();
  state.transfer = null;
}

function returnToLogin(message = "", type = "") {
  stopTransfer();
  setAuthenticated(false);
  setLocked(false);
  setPinLoading(false);
  elements.pinInput.value = "";
  setPinMessage(message, type);
  refreshRoomCapacity().catch(() => {});
}

function createPersonalTransfer() {
  return createTransferController({
    api: {
      listItems: () => hopperApi.listItems(),
      createText: (content, ttl) => hopperApi.createText(content, ttl),
      initializeUpload: (file, ttl) => hopperApi.initializeUpload(file, ttl),
      uploadToSignedUrl: (...args) => hopperApi.uploadToSignedUrl(...args),
      completeUpload: (id) => hopperApi.completeUpload(id),
      cancelUpload: (id) => hopperApi.cancelUpload(id),
      getFileUrl: (id, mode) => hopperApi.getFileUrl(id, mode),
      resetTtl: (id, ttl) => hopperApi.resetTtl(id, ttl),
      deleteItem: (id) => hopperApi.deleteItem(id)
    },
    maxFileBytes: appConfig.maxFileBytes,
    defaultTtlMinutes: appConfig.defaultTtlMinutes,
    ttlOptions: [5, 15, 30, 60, 360],
    pollIntervalMs: appConfig.pollIntervalMs,
    uploadConcurrency: appConfig.uploadConcurrency,
    onUnauthorized: () => {
      hopperApi.clearSession();
      returnToLogin("La sesión venció. Ingresa el PIN de nuevo.", "error");
    }
  });
}

async function enterWorkspace() {
  setAuthenticated(true);
  stopTransfer();
  state.transfer = createPersonalTransfer();

  try {
    await state.transfer.start();
  } catch (error) {
    if (error?.status === 401 || error?.code === "invalid-session") {
      hopperApi.clearSession();
      returnToLogin("La sesión venció. Ingresa el PIN de nuevo.", "error");
      return;
    }

    state.transfer.showToast(error.message || "No fue posible cargar Hopper.", "error");
  }
}

async function handlePinSubmit(event) {
  event?.preventDefault();

  if (state.pinSubmitting) {
    return;
  }

  const pin = normalizePinInput();

  if (pin.length !== 4) {
    setPinMessage("Escribe los cuatro dígitos del PIN.", "error");
    return;
  }

  state.pinSubmitting = true;
  setPinLoading(true);
  setPinMessage("");

  try {
    const result = await hopperApi.login(pin);

    if (result?.status === "authorized") {
      elements.pinInput.value = "";
      await enterWorkspace();
      return;
    }

    if (result?.status === "locked") {
      setLocked(true);
      return;
    }

    const attempts = Number(result?.remainingAttempts);
    setPinMessage(
      Number.isFinite(attempts)
        ? `PIN incorrecto. Quedan ${attempts} intento${attempts === 1 ? "" : "s"}.`
        : "PIN incorrecto.",
      "error"
    );
    elements.pinInput.value = "";
  } catch (error) {
    setPinMessage(error.message || "No fue posible validar el PIN.", "error");
  } finally {
    state.pinSubmitting = false;
    setPinLoading(false);
  }
}

async function requestRecovery() {
  elements.recoveryRequestButton.disabled = true;
  elements.recoveryRequestMessage.textContent = "Enviando…";
  elements.recoveryRequestMessage.className = "form-message";

  try {
    await hopperApi.requestRecovery();
    elements.recoveryRequestMessage.textContent = "Enlace enviado.";
    elements.recoveryRequestMessage.className = "form-message is-success";
  } catch (error) {
    elements.recoveryRequestMessage.textContent = error.message || "No fue posible enviar el enlace.";
    elements.recoveryRequestMessage.className = "form-message is-error";
  } finally {
    elements.recoveryRequestButton.disabled = false;
  }
}

async function refreshRoomCapacity() {
  if (elements.authScreen.hidden) {
    return;
  }

  try {
    const capacity = await hopperApi.roomCapacity();
    const available = Math.max(0, Number(capacity?.available || 0));
    const maximum = Math.max(1, Number(capacity?.maximum || 2));
    elements.roomCapacity.textContent = `${available} / ${maximum}`;
    elements.createRoomButton.disabled = available <= 0 || state.roomSubmitting;
  } catch {
    elements.roomCapacity.textContent = "— / 2";
    elements.createRoomButton.disabled = true;
  }
}

function roomUrl(code) {
  const url = new URL("room.html", window.location.href);
  url.hash = code;
  return url.toString();
}

async function copyRoomCode() {
  const code = state.createdRoomCode;

  if (!code) {
    return;
  }

  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const input = document.createElement("textarea");
    input.value = code;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  elements.roomCopy.textContent = "Copiado";
  window.setTimeout(() => {
    elements.roomCopy.textContent = "Copiar código";
  }, 1200);
}

function showCreatedRoom(result) {
  state.createdRoomCode = result.code;
  elements.roomCode.textContent = result.code;
  renderQr(elements.roomQr, roomUrl(result.code), 260);
  elements.roomDialog.showModal();
}

async function createPublicRoom() {
  if (state.roomSubmitting || elements.createRoomButton.disabled) {
    return;
  }

  state.roomSubmitting = true;
  elements.createRoomButton.disabled = true;

  try {
    const result = await hopperApi.createRoom();
    showCreatedRoom(result);
    await refreshRoomCapacity();
  } catch (error) {
    setRoomMessage(error.message || "No fue posible crear la sala.", "error");
    await refreshRoomCapacity();
  } finally {
    state.roomSubmitting = false;
  }
}

async function joinPublicRoom(event) {
  event?.preventDefault();

  if (state.roomSubmitting) {
    return;
  }

  const code = normalizeRoomCode(elements.roomCodeInput.value);
  elements.roomCodeInput.value = code;

  if (!/^[A-Z]{2}-\d{4}$/.test(code)) {
    setRoomMessage("Código no válido.", "error");
    return;
  }

  state.roomSubmitting = true;
  elements.roomJoinButton.disabled = true;
  elements.roomCodeInput.disabled = true;
  setRoomMessage("");

  try {
    await hopperApi.joinRoom(code);
    window.location.assign(roomUrl(code));
  } catch (error) {
    setRoomMessage(error.message || "No fue posible entrar a la sala.", "error");
  } finally {
    state.roomSubmitting = false;
    elements.roomJoinButton.disabled = false;
    elements.roomCodeInput.disabled = false;
  }
}

function setInstallVisible(visible) {
  elements.installButton.hidden = !visible;
  elements.installButtonSession.hidden = !visible;
}

function setUpdateVisible(visible) {
  elements.updateButton.hidden = !visible;
  elements.updateButtonSession.hidden = !visible;
}

function showUpdateButton(registration) {
  state.registration = registration;
  setUpdateVisible(true);
}

async function registerPwa() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js", {
      scope: "./",
      updateViaCache: "none"
    });
    state.registration = registration;

    if (registration.waiting) {
      showUpdateButton(registration);
    }

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateButton(registration);
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
  } catch {
    setInstallVisible(false);
  }
}

function bindPwaEvents() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    setInstallVisible(true);
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    setInstallVisible(false);
  });

  const handleInstall = async (button) => {
    if (!state.installPrompt) {
      return;
    }

    button.disabled = true;
    await state.installPrompt.prompt();
    await state.installPrompt.userChoice.catch(() => null);
    state.installPrompt = null;
    setInstallVisible(false);
    button.disabled = false;
  };

  for (const button of [elements.installButton, elements.installButtonSession]) {
    button.addEventListener("click", () => handleInstall(button));
  }

  const handleUpdate = (button) => {
    const waiting = state.registration?.waiting;

    if (waiting) {
      button.disabled = true;
      waiting.postMessage({ type: "SKIP_WAITING" });
    }
  };

  for (const button of [elements.updateButton, elements.updateButtonSession]) {
    button.addEventListener("click", () => handleUpdate(button));
  }
}

function bindEvents() {
  elements.pinForm.addEventListener("submit", handlePinSubmit);
  elements.pinInput.addEventListener("input", () => {
    const pin = normalizePinInput();

    if (pin.length === 4 && !state.pinSubmitting) {
      elements.pinForm.requestSubmit();
    }
  });
  elements.recoveryRequestButton.addEventListener("click", requestRecovery);
  elements.logoutButton.addEventListener("click", () => {
    hopperApi.clearSession();
    returnToLogin();
  });
  elements.createRoomButton.addEventListener("click", createPublicRoom);
  elements.roomForm.addEventListener("submit", joinPublicRoom);
  elements.roomCodeInput.addEventListener("input", () => {
    elements.roomCodeInput.value = normalizeRoomCode(elements.roomCodeInput.value);
    setRoomMessage("");
  });
  elements.roomDialogClose.addEventListener("click", () => elements.roomDialog.close());
  elements.roomDialog.addEventListener("click", (event) => {
    if (event.target === elements.roomDialog) {
      elements.roomDialog.close();
    }
  });
  elements.roomCopy.addEventListener("click", copyRoomCode);
  elements.roomEnter.addEventListener("click", () => {
    if (state.createdRoomCode) {
      window.location.assign(roomUrl(state.createdRoomCode));
    }
  });
  window.addEventListener("hopper:session-expired", () => returnToLogin("La sesión venció. Ingresa el PIN de nuevo.", "error"));
  window.addEventListener("focus", () => refreshRoomCapacity().catch(() => {}));
  bindPwaEvents();
}

async function initialize() {
  bindEvents();
  registerPwa();

  if (!hopperApi.hasConfiguredWorker()) {
    setAuthenticated(false);
    elements.pinInput.disabled = true;
    elements.createRoomButton.disabled = true;
    setPinMessage("Hopper todavía no está conectado al Worker.", "error");
    return;
  }

  state.capacityTimer = window.setInterval(() => refreshRoomCapacity().catch(() => {}), 10_000);
  refreshRoomCapacity().catch(() => {});

  try {
    const status = await hopperApi.securityStatus();
    setLocked(Boolean(status?.locked));

    if (status?.locked) {
      return;
    }

    if (hopperApi.hasSession()) {
      await enterWorkspace();
      return;
    }

    setAuthenticated(false);
    setPinMessage("");
  } catch (error) {
    setAuthenticated(false);
    setPinMessage(error.message || "No fue posible conectar con Hopper.", "error");
  }
}

initialize();
