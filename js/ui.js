import { appConfig } from "./config.js?v=20260908-3";

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
  syncState: document.querySelector("#sync-state"),
  textInput: document.querySelector("#text-input"),
  dropZone: document.querySelector("#drop-zone"),
  dropLimit: document.querySelector("#drop-limit"),
  fileInput: document.querySelector("#file-input"),
  selectedFiles: document.querySelector("#selected-files"),
  ttlSelect: document.querySelector("#ttl-select"),
  sendButton: document.querySelector("#send-button"),
  refreshButton: document.querySelector("#refresh-button"),
  itemCount: document.querySelector("#item-count"),
  loadingState: document.querySelector("#loading-state"),
  emptyState: document.querySelector("#empty-state"),
  itemList: document.querySelector("#item-list"),
  previewDialog: document.querySelector("#preview-dialog"),
  previewTitle: document.querySelector("#preview-title"),
  previewImage: document.querySelector("#preview-image"),
  previewClose: document.querySelector("#preview-close"),
  deleteDialog: document.querySelector("#delete-dialog"),
  deleteCopy: document.querySelector("#delete-copy"),
  toastRegion: document.querySelector("#toast-region")
};

function formatBytes(bytes) {
  const value = Number(bytes) || 0;

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let amount = value;
  let unitIndex = -1;

  do {
    amount /= 1024;
    unitIndex += 1;
  } while (amount >= 1024 && unitIndex < units.length - 1);

  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

function formatCountdown(expiresAt, now = Date.now()) {
  const remaining = Math.max(0, Date.parse(expiresAt || "") - now);
  const totalSeconds = Math.ceil(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function textPreview(content) {
  return String(content || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "Texto vacío";
}

function fileTypeLabel(name, mimeType) {
  const extension = String(name || "").split(".").pop();

  if (extension && extension !== name && extension.length <= 8) {
    return extension.toUpperCase();
  }

  const category = String(mimeType || "").split("/")[0];
  return category ? category.toUpperCase() : "ARCHIVO";
}

function createTypeMark(type) {
  const mark = document.createElement("div");
  mark.className = "item-type-mark";

  if (type === "text") {
    mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12M6 9h12M6 13h8M6 17h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>';
  } else {
    mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4V20H7zM14 3.5V8h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path></svg>';
  }

  return mark;
}

function createAction(label, action, itemId, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `action-button ${className}`.trim();
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.itemId = itemId;
  return button;
}

function createExpiryMenu(item) {
  const controls = document.createElement("div");
  controls.className = "expiry-controls";

  const countdown = document.createElement("span");
  countdown.className = "expiry-countdown";
  countdown.dataset.expiresAt = item.expiresAt;
  countdown.textContent = formatCountdown(item.expiresAt);
  countdown.setAttribute("aria-label", "Tiempo restante");
  controls.append(countdown);

  const select = document.createElement("select");
  select.className = "expiry-select";
  select.dataset.itemId = item.id;
  select.setAttribute("aria-label", "Reiniciar tiempo de expiración");

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Tiempo";
  placeholder.selected = true;
  select.append(placeholder);

  for (const [minutes, label] of [[15, "15 min"], [30, "30 min"], [60, "1 hora"], [360, "6 horas"]]) {
    const option = document.createElement("option");
    option.value = String(minutes);
    option.textContent = label;
    select.append(option);
  }

  controls.append(select);
  return controls;
}

function createItemCard(item) {
  const card = document.createElement("article");
  card.className = "item-card";
  card.dataset.itemId = item.id;
  card.dataset.expiresAt = item.expiresAt;

  const main = document.createElement("div");
  main.className = "item-main";
  main.append(createTypeMark(item.type));

  const copy = document.createElement("div");
  copy.className = "item-copy";
  const title = document.createElement("h3");
  title.className = "item-title";
  title.textContent = item.type === "text" ? "Texto" : item.name;
  copy.append(title);

  const preview = document.createElement("p");
  preview.className = "item-preview";
  preview.textContent = item.type === "text"
    ? textPreview(item.content)
    : `${fileTypeLabel(item.name, item.mimeType)} · ${item.mimeType || "application/octet-stream"}`;
  copy.append(preview);

  const meta = document.createElement("div");
  meta.className = "item-meta";
  const detail = document.createElement("span");
  detail.textContent = item.type === "text"
    ? `${String(item.content || "").length.toLocaleString("es-CO")} caracteres`
    : formatBytes(item.size);
  meta.append(detail);

  const created = document.createElement("span");
  const createdDate = new Date(item.createdAt);
  created.textContent = Number.isNaN(createdDate.getTime())
    ? "Temporal"
    : createdDate.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  meta.append(created);
  copy.append(meta);
  main.append(copy);

  const actions = document.createElement("div");
  actions.className = "item-actions";
  actions.append(createExpiryMenu(item));

  if (item.type === "text") {
    actions.append(createAction("Copiar", "copy", item.id));
  } else {
    if (item.previewable) {
      actions.append(createAction("Ver", "preview", item.id));
    }
    actions.append(createAction("Descargar", "download", item.id));
  }

  actions.append(createAction("Eliminar", "delete", item.id, "is-danger"));
  card.append(main, actions);
  return card;
}

function renderItems(items) {
  const source = Array.isArray(items) ? items : [];
  elements.itemList.replaceChildren();

  for (const item of source) {
    elements.itemList.append(createItemCard(item));
  }

  elements.itemCount.textContent = String(source.length);
  elements.emptyState.hidden = source.length > 0;
  elements.itemList.hidden = source.length === 0;
}

function updateCountdowns(now = Date.now()) {
  let hasExpired = false;

  for (const element of document.querySelectorAll("[data-expires-at]")) {
    const expiresAt = element.dataset.expiresAt;
    const expiresMs = Date.parse(expiresAt || "");

    if (!Number.isFinite(expiresMs) || expiresMs <= now) {
      if (element.matches(".expiry-countdown")) {
        element.textContent = "0:00";
      }
      hasExpired = true;
      continue;
    }

    if (element.matches(".expiry-countdown")) {
      element.textContent = formatCountdown(expiresAt, now);
    }
  }

  return hasExpired;
}

function setAuthenticated(authenticated) {
  elements.authScreen.hidden = authenticated;
  elements.workspaceScreen.hidden = !authenticated;
  elements.headerSession.hidden = !authenticated;

  if (!authenticated) {
    requestAnimationFrame(() => elements.pinInput?.focus());
  }
}

function setPinLoading(loading) {
  elements.pinInput.disabled = loading;

  if (elements.pinLoader) {
    elements.pinLoader.hidden = !loading;
  }
}

function setPinMessage(message, type = "") {
  elements.pinMessage.textContent = message;
  elements.pinMessage.className = `form-message ${type ? `is-${type}` : ""}`.trim();
}

function setLocked(locked) {
  elements.lockPanel.hidden = !locked;
  elements.pinForm.hidden = locked;

  if (locked) {
    setPinMessage("El acceso queda detenido hasta restablecer el PIN.", "error");
  }
}

function setRecoveryRequestMessage(message, type = "") {
  elements.recoveryRequestMessage.textContent = message;
  elements.recoveryRequestMessage.className = `form-message ${type ? `is-${type}` : ""}`.trim();
}

function setItemsLoading(loading) {
  elements.loadingState.hidden = !loading;

  if (loading) {
    elements.emptyState.hidden = true;
    elements.itemList.hidden = true;
    return;
  }

  const itemCount = Number(elements.itemCount.textContent) || 0;
  elements.emptyState.hidden = itemCount > 0;
  elements.itemList.hidden = itemCount === 0;
}

function setSyncState(label, state = "") {
  elements.syncState.textContent = label;
  elements.syncState.className = `sync-state ${state ? `is-${state}` : ""}`.trim();
}

function showToast(message, type = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${type ? `is-${type}` : ""}`.trim();
  toast.textContent = message;
  elements.toastRegion.append(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3600);
}

function selectedFileStatus(entry) {
  const progress = Math.max(0, Math.min(100, Number(entry.progress) || 0));

  if (entry.status === "error") {
    return { label: "Error", error: true };
  }

  if (entry.status === "preparando") {
    return { label: "0% · Preparando", error: false };
  }

  if (entry.status === "subiendo") {
    return { label: `${progress}%`, error: false };
  }

  if (entry.status === "confirmando") {
    return { label: "100% · Confirmando", error: false };
  }

  if (entry.status === "listo") {
    return { label: "100% · Listo", error: false };
  }

  return { label: "0% · Listo para enviar", error: false };
}

function renderSelectedFiles(entries, sending = false) {
  elements.selectedFiles.replaceChildren();
  elements.selectedFiles.hidden = entries.length === 0;

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "selected-file";
    row.dataset.fileKey = entry.key;

    const copy = document.createElement("div");
    copy.className = "selected-file-copy";
    const name = document.createElement("span");
    name.className = "selected-file-name";
    name.textContent = entry.file.name;
    const size = document.createElement("span");
    size.className = "selected-file-size";
    size.textContent = formatBytes(entry.file.size);
    const statusValue = selectedFileStatus(entry);
    const status = document.createElement("span");
    status.className = `selected-file-status selected-file-progress-label ${statusValue.error ? "is-error" : ""}`.trim();
    status.textContent = statusValue.label;
    copy.append(name, size, status);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-file-button";
    remove.dataset.action = "remove-selected-file";
    remove.dataset.fileKey = entry.key;
    remove.setAttribute("aria-label", `Quitar ${entry.file.name}`);
    remove.disabled = sending || ["preparando", "subiendo", "confirmando"].includes(entry.status);
    remove.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>';

    const progress = document.createElement("div");
    progress.className = "file-progress";
    const bar = document.createElement("span");
    bar.style.width = `${Math.max(0, Math.min(100, Number(entry.progress) || 0))}%`;
    progress.append(bar);
    row.append(copy, remove, progress);
    elements.selectedFiles.append(row);
  }
}

function setSending(sending) {
  elements.sendButton.disabled = sending;
  elements.textInput.disabled = sending;
  elements.fileInput.disabled = sending;
  elements.ttlSelect.disabled = sending;
  elements.sendButton.textContent = sending ? "Enviando…" : "Enviar";
}

function setDropLimit() {
  elements.dropLimit.textContent = `Hasta ${formatBytes(appConfig.maxFileBytes)} por archivo`;
}

function openPreview(item, url) {
  elements.previewTitle.textContent = item.name || "Imagen";
  elements.previewImage.src = url;
  elements.previewImage.alt = `Vista previa de ${item.name || "imagen"}`;
  elements.previewDialog.showModal();
}

function closePreview() {
  elements.previewDialog.close();
  elements.previewImage.removeAttribute("src");
  elements.previewImage.alt = "";
}

function openDeleteDialog(item) {
  elements.deleteDialog.dataset.itemId = item.id;
  elements.deleteCopy.textContent = item.type === "file"
    ? `“${item.name}” se eliminará inmediatamente y dejará de estar disponible en todos los dispositivos.`
    : "El texto se eliminará inmediatamente y dejará de estar disponible en todos los dispositivos.";
  elements.deleteDialog.showModal();
}

export {
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
};