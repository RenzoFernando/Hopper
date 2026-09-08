import { hopperApi } from "./api.js?v=20260908-3";
import { appConfig } from "./config.js?v=20260908-3";
import { createTransferController } from "./transfer-controller.js?v=20260908-3";

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
  publicNav: document.querySelector("#public-nav")
};

const state = {
  pinSubmitting: false,
  transfer: null,
  installPrompt: null,
  registration: null
};

function normalizePinInput() {
  const normalized = String(elements.pinInput.value || "").replace(/\D/g, "").slice(0, 4);

  if (normalized !== elements.pinInput.value) {
    elements.pinInput.value = normalized;
  }

  return normalized;
}

function setPinMessage(message, type = "") {
  elements.pinMessage.textContent = message;
  elements.pinMessage.className = `form-message ${type ? `is-${type}` : ""}`.trim();
}

function setPinLoading(loading) {
  elements.pinInput.disabled = loading;
  elements.pinLoader.hidden = !loading;
}

function setLocked(locked) {
  elements.lockPanel.hidden = !locked;
  elements.pinForm.hidden = locked;

  if (locked) {
    setPinMessage("El acceso queda detenido hasta restablecer el PIN.", "error");
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

function returnToLogin(message = "Ingresa el PIN para continuar.", type = "") {
  stopTransfer();
  setAuthenticated(false);
  setLocked(false);
  setPinLoading(false);
  elements.pinInput.value = "";
  setPinMessage(message, type);
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
  setPinMessage("Verificando…");

  try {
    const result = await hopperApi.login(pin);

    if (result?.status === "authorized") {
      elements.pinInput.value = "";
      setPinMessage("Acceso concedido.", "success");
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

    if (!elements.pinForm.hidden && elements.authScreen.hidden === false) {
      elements.pinInput.focus();
    }
  }
}

async function requestRecovery() {
  elements.recoveryRequestButton.disabled = true;
  elements.recoveryRequestMessage.textContent = "Enviando…";
  elements.recoveryRequestMessage.className = "form-message";

  try {
    await hopperApi.requestRecovery();
    elements.recoveryRequestMessage.textContent = "Enlace enviado al correo de recuperación.";
    elements.recoveryRequestMessage.className = "form-message is-success";
  } catch (error) {
    elements.recoveryRequestMessage.textContent = error.message || "No fue posible enviar el enlace.";
    elements.recoveryRequestMessage.className = "form-message is-error";
  } finally {
    elements.recoveryRequestButton.disabled = false;
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

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
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
    returnToLogin("Sesión cerrada. Ingresa el PIN para volver a entrar.");
  });
  window.addEventListener("hopper:session-expired", () => {
    returnToLogin("La sesión venció. Ingresa el PIN de nuevo.", "error");
  });
  bindPwaEvents();
}

async function initialize() {
  bindEvents();
  registerPwa();

  if (!hopperApi.hasConfiguredWorker()) {
    setAuthenticated(false);
    elements.pinInput.disabled = true;
    setPinMessage(
      "Hopper está listo, pero falta enlazar el Worker. Ejecuta hopper-admin.ps1 para completar la configuración.",
      "error"
    );
    return;
  }

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
    setPinMessage("Todo desaparece automáticamente. 5 min por defecto.");
  } catch (error) {
    setAuthenticated(false);
    setPinMessage(error.message || "No fue posible conectar con Hopper.", "error");
  }
}

initialize();
