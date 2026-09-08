import { hopperApi, ApiError } from "./api.js?v=20260908-2";
import { appConfig } from "./config.js?v=20260908-2";
import {
  closePreview,
  elements,
  formatBytes,
  openDeleteDialog,
  openPreview,
  renderItems,
  renderSelectedFiles,
  setAuthenticated,
  setDropLimit,
  setItemsLoading,
  setLocked,
  setPinLoading,
  setPinMessage,
  setRecoveryRequestMessage,
  setSending,
  setSyncState,
  showToast,
  updateCountdowns
} from "./ui.js?v=20260908-2";

const state = {
  items: [],
  selectedFiles: [],
  sending: false,
  refreshing: false,
  pinSubmitting: false,
  pollTimer: 0,
  countdownTimer: 0
};

function itemSignature(items) {
  return items.map((item) => `${item.id}:${item.expiresAt}`).join("|");
}

function currentItem(id) {
  return state.items.find((item) => item.id === id) || null;
}

function normalizePinInput() {
  const normalized = elements.pinInput.value.replace(/\D/g, "").slice(0, 4);

  if (elements.pinInput.value !== normalized) {
    elements.pinInput.value = normalized;
  }

  return normalized;
}

function stopWorkspaceTimers() {
  window.clearInterval(state.pollTimer);
  window.clearInterval(state.countdownTimer);
  state.pollTimer = 0;
  state.countdownTimer = 0;
}

function startWorkspaceTimers() {
  stopWorkspaceTimers();
  state.countdownTimer = window.setInterval(() => {
    const now = Date.now();
    const activeItems = state.items.filter((item) => Date.parse(item.expiresAt || "") > now);

    if (activeItems.length !== state.items.length) {
      state.items = activeItems;
      renderItems(state.items);
      refreshItems({ quiet: true }).catch(() => {});
      return;
    }

    updateCountdowns(now);
  }, 1000);

  state.pollTimer = window.setInterval(() => {
    if (!document.hidden && !state.sending) {
      refreshItems({ quiet: true }).catch(() => {});
    }
  }, Math.max(2000, Number(appConfig.pollIntervalMs) || 3000));
}

function resetWorkspaceState() {
  state.items = [];
  state.selectedFiles = [];
  state.sending = false;
  elements.textInput.value = "";
  renderItems([]);
  renderSelectedFiles([]);
  setSending(false);
}

function returnToLogin(message = "Ingresa el PIN para continuar.", type = "") {
  stopWorkspaceTimers();
  resetWorkspaceState();
  setAuthenticated(false);
  setLocked(false);
  elements.pinInput.value = "";
  setPinMessage(message, type);
}

async function refreshItems({ quiet = false } = {}) {
  if (state.refreshing || !hopperApi.hasSession()) {
    return;
  }

  state.refreshing = true;

  if (!quiet && state.items.length === 0) {
    setItemsLoading(true);
  }

  if (quiet) {
    setSyncState("Sincronizando", "loading");
  }

  try {
    const result = await hopperApi.listItems();
    const nextItems = Array.isArray(result?.items) ? result.items : [];

    if (itemSignature(nextItems) !== itemSignature(state.items)) {
      state.items = nextItems;
      renderItems(state.items);
    } else {
      updateCountdowns();
    }

    setSyncState("Sincronizado");
  } catch (error) {
    if (error?.status !== 401) {
      setSyncState("Sin conexión", "error");

      if (!quiet) {
        showToast(error.message || "No fue posible cargar la bandeja.", "error");
      }
    }

    throw error;
  } finally {
    state.refreshing = false;
    setItemsLoading(false);
  }
}

async function enterWorkspace() {
  setLocked(false);
  setAuthenticated(true);
  setItemsLoading(true);

  try {
    await refreshItems();
    startWorkspaceTimers();
    requestAnimationFrame(() => elements.textInput.focus());
  } catch (error) {
    if (error?.status === 401) {
      returnToLogin("La sesión venció. Ingresa el PIN de nuevo.", "error");
    }
  }
}

async function handlePinSubmit(event) {
  event?.preventDefault();

  if (state.pinSubmitting) {
    return;
  }

  const pin = normalizePinInput();

  if (!/^\d{4}$/.test(pin)) {
    setPinMessage("El PIN debe tener 4 dígitos.", "error");
    return;
  }

  state.pinSubmitting = true;
  setPinLoading(true);
  setPinMessage("Verificando…");

  try {
    const result = await hopperApi.login(pin);

    if (result?.status === "locked") {
      hopperApi.clearSession();
      setLocked(true);
      return;
    }

    if (result?.status === "invalid-pin") {
      const remaining = Number(result.remainingAttempts) || 0;
      setPinMessage(
        remaining === 1
          ? "PIN incorrecto. Queda 1 intento."
          : `PIN incorrecto. Quedan ${remaining} intentos.`,
        "error"
      );
      elements.pinInput.value = "";
      elements.pinInput.focus();
      return;
    }

    if (result?.status !== "authorized") {
      setPinMessage("No fue posible autorizar el acceso.", "error");
      return;
    }

    elements.pinInput.value = "";
    await enterWorkspace();
  } catch (error) {
    setPinMessage(error.message || "No fue posible verificar el PIN.", "error");
  } finally {
    state.pinSubmitting = false;
    setPinLoading(false);
  }
}

async function requestRecovery() {
  elements.recoveryRequestButton.disabled = true;
  setRecoveryRequestMessage("Solicitando enlace…");

  try {
    await hopperApi.requestRecovery();
    setRecoveryRequestMessage("Enlace enviado al correo de recuperación.", "success");
  } catch (error) {
    setRecoveryRequestMessage(error.message || "No fue posible enviar el enlace.", "error");
  } finally {
    elements.recoveryRequestButton.disabled = false;
  }
}

function addFiles(fileList) {
  const files = Array.from(fileList || []);

  if (files.length === 0) {
    return;
  }

  const availableSlots = Math.max(0, 20 - state.selectedFiles.length);
  const accepted = files.slice(0, availableSlots);

  if (files.length > availableSlots) {
    showToast("Puedes preparar hasta 20 archivos por envío.", "error");
  }

  for (const file of accepted) {
    if (file.size > appConfig.maxFileBytes) {
      showToast(`${file.name} supera el límite de ${formatBytes(appConfig.maxFileBytes)}.`, "error");
      continue;
    }

    state.selectedFiles.push({
      key: crypto.randomUUID(),
      file,
      progress: 0,
      status: ""
    });
  }

  renderSelectedFiles(state.selectedFiles, state.sending);
}

function updateSelectedFile(key, patch) {
  const entry = state.selectedFiles.find((item) => item.key === key);

  if (!entry) {
    return;
  }

  Object.assign(entry, patch);

  const row = elements.selectedFiles.querySelector(`[data-file-key="${CSS.escape(key)}"]`);
  const bar = row?.querySelector(".file-progress > span");

  if (bar && patch.progress !== undefined) {
    const progress = Math.max(0, Math.min(100, Number(patch.progress) || 0));
    bar.style.width = `${progress}%`;

    const progressLabel = row?.querySelector(".selected-file-progress-label");

    if (progressLabel && entry.status === "subiendo") {
      progressLabel.textContent = `${progress}%`;
    }
  }

  if (patch.status !== undefined) {
    renderSelectedFiles(state.selectedFiles, state.sending);
  }
}

async function completeUploadWithRetry(id) {
  let lastError = null;
  const retryableCodes = new Set(["upload-not-found", "storage-error"]);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await hopperApi.completeUpload(id);
    } catch (error) {
      lastError = error;

      if (!retryableCodes.has(error?.code) || attempt === 3) {
        throw error;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 800 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function uploadEntry(entry, ttlMinutes) {
  let uploadId = "";

  try {
    updateSelectedFile(entry.key, { status: "preparando", progress: 0 });
    const initialized = await hopperApi.initializeUpload(entry.file, ttlMinutes);
    uploadId = initialized?.upload?.id || "";
    const uploadUrl = initialized?.upload?.uploadUrl || "";
    const uploadMimeType = initialized?.upload?.mimeType || entry.file.type || "application/octet-stream";

    if (!uploadId || !uploadUrl) {
      throw new ApiError("Hopper no devolvió una URL de subida válida.", { code: "invalid-upload-url" });
    }

    updateSelectedFile(entry.key, { status: "subiendo" });
    await hopperApi.uploadToSignedUrl(entry.file, uploadUrl, (progress) => {
      updateSelectedFile(entry.key, { progress });
    }, uploadMimeType);
    updateSelectedFile(entry.key, { status: "confirmando", progress: 100 });
    await completeUploadWithRetry(uploadId);
    updateSelectedFile(entry.key, { status: "listo", progress: 100 });
    return { ok: true, key: entry.key };
  } catch (error) {
    if (uploadId) {
      hopperApi.cancelUpload(uploadId).catch(() => {});
    }

    updateSelectedFile(entry.key, { status: "error" });
    return { ok: false, key: entry.key, error };
  }
}

async function runWithConcurrency(values, limit, worker) {
  const results = new Array(values.length);
  let index = 0;

  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(values[currentIndex]);
    }
  });

  await Promise.all(runners);
  return results;
}

async function handleSend() {
  if (state.sending) {
    return;
  }

  const content = elements.textInput.value;
  const files = state.selectedFiles.filter((entry) => entry.status !== "listo");
  const hasText = Boolean(content.trim());

  if (!hasText && files.length === 0) {
    showToast("Pega texto o adjunta al menos un archivo.", "error");
    return;
  }

  const ttlMinutes = Number(elements.ttlSelect.value) || appConfig.defaultTtlMinutes;
  state.sending = true;
  setSending(true);
  renderSelectedFiles(state.selectedFiles, true);
  const failures = [];
  let textCreated = false;

  try {
    if (hasText) {
      try {
        await hopperApi.createText(content, ttlMinutes);
        textCreated = true;
      } catch (error) {
        failures.push({ label: "texto", error });
      }
    }

    const uploadResults = await runWithConcurrency(files, 3, (entry) => uploadEntry(entry, ttlMinutes));

    for (const result of uploadResults) {
      if (!result?.ok) {
        const entry = state.selectedFiles.find((item) => item.key === result.key);
        failures.push({ label: entry?.file?.name || "archivo", error: result?.error });
      }
    }

    if (textCreated) {
      elements.textInput.value = "";
    }

    const successfulKeys = new Set(
      uploadResults.filter((result) => result?.ok).map((result) => result.key)
    );
    state.selectedFiles = state.selectedFiles.filter((entry) => !successfulKeys.has(entry.key));
    renderSelectedFiles(state.selectedFiles, false);

    if (failures.length === 0) {
      showToast("Contenido disponible en Hopper.", "success");
    } else if (failures.length === 1) {
      showToast(`${failures[0].label}: ${failures[0].error?.message || "no pudo enviarse"}`, "error");
    } else {
      showToast(`${failures.length} elementos no pudieron enviarse.`, "error");
    }

    await refreshItems({ quiet: true }).catch(() => {});
  } catch (error) {
    showToast(error.message || "No fue posible completar el envío.", "error");
  } finally {
    state.sending = false;
    setSending(false);
    renderSelectedFiles(state.selectedFiles, false);
  }
}

async function copyText(item) {
  try {
    await navigator.clipboard.writeText(item.content || "");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = item.content || "";
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  showToast("Texto copiado.", "success");
}

async function downloadFile(item) {
  const result = await hopperApi.getFileUrl(item.id, "download");
  const link = document.createElement("a");
  link.href = result.url;
  link.download = item.name || "archivo";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

async function previewFile(item) {
  const result = await hopperApi.getFileUrl(item.id, "preview");
  openPreview(item, result.url);
}

async function resetTtl(item, minutes, sourceButton) {
  sourceButton.disabled = true;

  try {
    const result = await hopperApi.resetTtl(item.id, minutes);
    const updated = result?.item;

    if (updated) {
      state.items = state.items.map((current) => current.id === updated.id ? updated : current);
      renderItems(state.items);
      showToast("Cuenta regresiva reiniciada.", "success");
    }
  } catch (error) {
    showToast(error.message || "No fue posible cambiar la expiración.", "error");
    await refreshItems({ quiet: true }).catch(() => {});
  } finally {
    sourceButton.disabled = false;
  }
}

async function deleteCurrentItem(id) {
  const item = currentItem(id);

  if (!item) {
    return;
  }

  try {
    await hopperApi.deleteItem(id);
    state.items = state.items.filter((current) => current.id !== id);
    renderItems(state.items);
    showToast("Elemento eliminado.", "success");
  } catch (error) {
    showToast(error.message || "No fue posible eliminar el elemento.", "error");
  }
}

function handleItemAction(event) {
  const button = event.target.closest("[data-action]");

  if (!button || !elements.itemList.contains(button)) {
    return;
  }

  const item = currentItem(button.dataset.itemId);

  if (!item) {
    return;
  }

  if (Date.parse(item.expiresAt || "") <= Date.now()) {
    state.items = state.items.filter((current) => current.id !== item.id);
    renderItems(state.items);
    showToast("El elemento ya expiró.", "error");
    refreshItems({ quiet: true }).catch(() => {});
    return;
  }

  const action = button.dataset.action;

  if (action === "copy") {
    copyText(item).catch((error) => showToast(error.message || "No fue posible copiar.", "error"));
    return;
  }

  if (action === "download") {
    downloadFile(item).catch((error) => showToast(error.message || "No fue posible descargar.", "error"));
    return;
  }

  if (action === "preview") {
    previewFile(item).catch((error) => showToast(error.message || "No fue posible abrir la vista previa.", "error"));
    return;
  }

  if (action === "delete") {
    openDeleteDialog(item);
  }
}

function handleItemTtlChange(event) {
  const select = event.target.closest(".expiry-select");

  if (!select || !elements.itemList.contains(select) || !select.value) {
    return;
  }

  const item = currentItem(select.dataset.itemId);
  const minutes = Number(select.value);
  select.value = "";

  if (!item || !Number.isFinite(minutes)) {
    return;
  }

  resetTtl(item, minutes, select);
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

  elements.dropZone.addEventListener("click", () => {
    if (!state.sending) {
      elements.fileInput.click();
    }
  });
  elements.dropZone.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && !state.sending) {
      event.preventDefault();
      elements.fileInput.click();
    }
  });
  elements.fileInput.addEventListener("change", () => {
    addFiles(elements.fileInput.files);
    elements.fileInput.value = "";
  });

  for (const eventName of ["dragenter", "dragover"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  }

  elements.dropZone.addEventListener("drop", (event) => {
    if (!state.sending) {
      addFiles(event.dataTransfer?.files);
    }
  });

  elements.selectedFiles.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="remove-selected-file"]');

    if (!button || state.sending) {
      return;
    }

    state.selectedFiles = state.selectedFiles.filter((entry) => entry.key !== button.dataset.fileKey);
    renderSelectedFiles(state.selectedFiles, false);
  });

  elements.sendButton.addEventListener("click", handleSend);
  elements.textInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      handleSend();
    }
  });
  elements.refreshButton.addEventListener("click", async () => {
    elements.refreshButton.disabled = true;
    elements.refreshButton.classList.add("is-spinning");

    try {
      await refreshItems();
    } catch {
      // El estado de sincronización ya muestra el fallo.
    } finally {
      elements.refreshButton.classList.remove("is-spinning");
      elements.refreshButton.disabled = false;
    }
  });
  elements.itemList.addEventListener("click", handleItemAction);
  elements.itemList.addEventListener("change", handleItemTtlChange);

  elements.previewClose.addEventListener("click", closePreview);
  elements.previewDialog.addEventListener("click", (event) => {
    if (event.target === elements.previewDialog) {
      closePreview();
    }
  });

  elements.deleteDialog.addEventListener("close", () => {
    const id = elements.deleteDialog.dataset.itemId;

    if (elements.deleteDialog.returnValue === "confirm" && id) {
      deleteCurrentItem(id);
    }

    elements.deleteDialog.dataset.itemId = "";
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && hopperApi.hasSession() && !state.sending) {
      refreshItems({ quiet: true }).catch(() => {});
    }
  });

  window.addEventListener("hopper:session-expired", () => {
    returnToLogin("La sesión venció. Ingresa el PIN de nuevo.", "error");
  });
}

async function initialize() {
  bindEvents();
  setDropLimit();
  renderItems([]);
  renderSelectedFiles([]);

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
    setPinMessage("Todo desaparece automáticamente. 15 min por defecto.");
  } catch (error) {
    setAuthenticated(false);
    setPinMessage(error.message || "No fue posible conectar con Hopper.", "error");
  }
}

initialize();
