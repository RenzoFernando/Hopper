import { ApiError } from "./api.js";

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);

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

function ttlLabel(minutes) {
  if (minutes === 60) {
    return "1 hora";
  }

  if (minutes === 360) {
    return "6 horas";
  }

  return `${minutes} min`;
}

function textPreview(content) {
  return String(content || "").replace(/\s+/g, " ").trim().slice(0, 150) || "Texto vacío";
}

function fileTypeLabel(name, mimeType) {
  const extension = String(name || "").split(".").pop();

  if (extension && extension !== name && extension.length <= 8) {
    return extension.toUpperCase();
  }

  const category = String(mimeType || "").split("/")[0];
  return category ? category.toUpperCase() : "ARCHIVO";
}

function createTypeMark(item) {
  const mark = document.createElement("div");
  mark.className = "item-type-mark";

  if (item.type === "text") {
    mark.classList.add("is-text");
    mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12M6 9h12M6 13h8M6 17h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>';
  } else if (item.audio) {
    mark.classList.add("is-audio");
    mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V8a6 6 0 0 1 12 0v8M6 14H4.8A1.8 1.8 0 0 0 3 15.8v2.4A1.8 1.8 0 0 0 4.8 20H7v-6Zm12 0h1.2a1.8 1.8 0 0 1 1.8 1.8v2.4a1.8 1.8 0 0 1-1.8 1.8H17v-6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  } else {
    mark.classList.add("is-file");
    mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4V20H7zM14 3.5V8h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path></svg>';
  }

  return mark;
}

function actionIcon(action) {
  const icons = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>',
    preview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12s3.2-5 8.5-5 8.5 5 8.5 5-3.2 5-8.5 5-8.5-5-8.5-5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path><circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"></circle></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 18v2h14v-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 12v6.2A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8V12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8v10m4-10v10m4-10v10M5 6h14M9 6V4h6v2m3 0-1 15H7L6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
  };
  return icons[action] || "";
}

function createAction(label, action, itemId, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `action-button ${className || "is-info"}`.trim();
  button.dataset.action = action;
  button.dataset.itemId = itemId;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = actionIcon(action);

  if (!button.innerHTML) {
    button.textContent = label;
  }

  return button;
}

function selectedStatus(entry) {
  const progress = Math.max(0, Math.min(100, Number(entry.progress) || 0));

  if (entry.status === "error") {
    return { label: "Error · Reintentar", variant: "error" };
  }

  if (entry.status === "preparando") {
    return { label: "Preparando", variant: "info" };
  }

  if (entry.status === "queued" || !entry.status) {
    return { label: "Listo para enviar", variant: "" };
  }

  if (entry.status === "subiendo") {
    return { label: `${Math.max(1, Math.min(99, progress))}% · Subiendo`, variant: "info" };
  }

  if (entry.status === "confirmando") {
    return { label: "100% · Confirmando", variant: "info" };
  }

  if (entry.status === "listo") {
    return { label: "100% · Listo", variant: "success" };
  }

  return { label: "Listo para enviar", variant: "" };
}

function createTransferController({
  api,
  maxFileBytes,
  defaultTtlMinutes = 5,
  ttlOptions = [5, 15, 30, 60, 360],
  pollIntervalMs = 3000,
  uploadConcurrency = 2,
  maxSelectedFiles = 20,
  allowTtlReset = true,
  onActivity = () => {},
  onUnauthorized = () => {},
  onStateChange = () => {}
}) {
  const elements = {
    syncState: document.querySelector("#sync-state"),
    composerCard: document.querySelector(".composer-card"),
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
  const state = {
    items: [],
    selectedFiles: [],
    sending: false,
    started: false,
    refreshTimer: null,
    countdownTimer: null,
    bound: false
  };

  function showToast(message, type = "") {
    if (!elements.toastRegion) {
      return;
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type ? `is-${type}` : ""}`.trim();
    toast.textContent = message;
    elements.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function setSync(label, variant = "") {
    if (!elements.syncState) {
      return;
    }

    elements.syncState.textContent = label;
    elements.syncState.className = `sync-state ${variant ? `is-${variant}` : ""}`.trim();
  }

  function setLoading(loading) {
    if (!elements.loadingState || !elements.emptyState || !elements.itemList) {
      return;
    }

    elements.loadingState.hidden = !loading;

    if (loading) {
      elements.emptyState.hidden = true;
      elements.itemList.hidden = true;
    }
  }

  function createExpiryControls(item) {
    const controls = document.createElement("div");
    controls.className = "expiry-controls";
    const countdown = document.createElement("span");
    countdown.className = "expiry-countdown";
    countdown.dataset.expiresAt = item.expiresAt;
    countdown.textContent = formatCountdown(item.expiresAt);
    countdown.setAttribute("aria-label", "Tiempo restante");
    controls.append(countdown);

    if (allowTtlReset) {
      const select = document.createElement("select");
      select.className = "expiry-select";
      select.dataset.itemId = item.id;
      select.setAttribute("aria-label", "Reiniciar tiempo de expiración");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Tiempo";
      placeholder.selected = true;
      select.append(placeholder);

      for (const minutes of ttlOptions) {
        const option = document.createElement("option");
        option.value = String(minutes);
        option.textContent = ttlLabel(minutes);
        select.append(option);
      }

      controls.append(select);
    }

    return controls;
  }

  function createItemCard(item) {
    const card = document.createElement("article");
    card.className = "item-card";
    card.dataset.itemId = item.id;
    card.dataset.expiresAt = item.expiresAt;
    const main = document.createElement("div");
    main.className = "item-main";
    main.append(createTypeMark(item));
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

    if (item.audio) {
      const audioRow = document.createElement("div");
      audioRow.className = "audio-row";
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "none";
      audio.hidden = true;
      audio.dataset.audioItemId = item.id;
      audio.setAttribute("aria-label", `Reproductor de ${item.name || "audio"}`);
      const load = document.createElement("button");
      load.type = "button";
      load.className = "audio-load-button";
      load.dataset.action = "load-audio";
      load.dataset.itemId = item.id;
      load.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.5v9l7-4.5-7-4.5Z" fill="currentColor"></path></svg><span>Reproducir audio</span>';
      audio.addEventListener("error", () => {
        audio.hidden = true;
        audio.removeAttribute("src");
        delete audio.dataset.urlExpiresAt;
        load.hidden = false;
        load.disabled = false;
      });
      audioRow.append(load, audio);
      copy.append(audioRow);
    }

    main.append(copy);
    const actions = document.createElement("div");
    actions.className = "item-actions";
    actions.append(createExpiryControls(item));

    if (item.type === "text") {
      actions.append(createAction("Copiar", "copy", item.id));
    } else {
      if (item.previewable) {
        actions.append(createAction("Ver", "preview", item.id));
      }
      actions.append(createAction("Descargar", "download", item.id));
    }

    if (typeof navigator.share === "function") {
      actions.append(createAction("Compartir", "share", item.id));
    }

    actions.append(createAction("Eliminar", "delete", item.id, "is-danger"));
    card.append(main, actions);
    return card;
  }

  function renderItems() {
    const source = Array.isArray(state.items) ? state.items : [];
    elements.itemList?.replaceChildren();

    for (const item of source) {
      elements.itemList?.append(createItemCard(item));
    }

    if (elements.itemCount) {
      elements.itemCount.textContent = String(source.length);
    }

    if (elements.emptyState) {
      elements.emptyState.hidden = source.length > 0;
    }

    if (elements.itemList) {
      elements.itemList.hidden = source.length === 0;
    }

    onStateChange({ items: [...state.items], selectedFiles: [...state.selectedFiles] });
  }

  function renderSelectedFiles() {
    if (!elements.selectedFiles) {
      return;
    }

    elements.selectedFiles.replaceChildren();
    elements.selectedFiles.hidden = state.selectedFiles.length === 0;

    for (const entry of state.selectedFiles) {
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
      const statusValue = selectedStatus(entry);
      const status = document.createElement("span");
      status.className = `selected-file-status selected-file-progress-label ${statusValue.variant ? `is-${statusValue.variant}` : ""}`.trim();
      status.textContent = statusValue.label;
      copy.append(name, size, status);
      const action = document.createElement("button");
      action.type = "button";
      action.dataset.fileKey = entry.key;

      if (["subiendo", "confirmando", "preparando"].includes(entry.status)) {
        action.className = "remove-file-button is-cancel";
        action.dataset.action = "cancel-selected-file";
        action.setAttribute("aria-label", `Cancelar ${entry.file.name}`);
        action.title = "Cancelar";
        action.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>';
      } else if (entry.status === "error") {
        action.className = "selected-file-retry-button";
        action.dataset.action = "retry-selected-file";
        action.setAttribute("aria-label", `Reintentar ${entry.file.name}`);
        action.title = "Reintentar";
        action.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7v5h-5M5 17v-5h5M7.1 8.2A6.5 6.5 0 0 1 18.4 10M16.9 15.8A6.5 6.5 0 0 1 5.6 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
      } else {
        action.className = "remove-file-button";
        action.dataset.action = "remove-selected-file";
        action.setAttribute("aria-label", `Quitar ${entry.file.name}`);
        action.title = "Quitar";
        action.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>';
      }

      const activeProgress = ["preparando", "subiendo", "confirmando"].includes(entry.status);
      const progress = document.createElement("div");
      progress.className = "file-progress";
      progress.hidden = !activeProgress;
      const bar = document.createElement("span");
      bar.style.width = `${Math.max(0, Math.min(100, Number(entry.progress) || 0))}%`;
      progress.append(bar);
      row.append(copy, action, progress);
      elements.selectedFiles.append(row);
    }
  }

  function setSending(sending) {
    state.sending = sending;
    elements.composerCard?.classList.toggle("is-sending", sending);
    elements.dropZone?.classList.toggle("is-disabled", sending);
    elements.dropZone?.setAttribute("aria-disabled", String(sending));

    if (elements.sendButton) {
      elements.sendButton.disabled = sending;
      elements.sendButton.textContent = sending ? "Enviando…" : "Enviar";
    }

    if (elements.textInput) {
      elements.textInput.disabled = sending;
    }

    if (elements.fileInput) {
      elements.fileInput.disabled = sending;
    }

    if (elements.ttlSelect) {
      elements.ttlSelect.disabled = sending;
    }
  }

  function updateSelected(key, patch) {
    const entry = state.selectedFiles.find((item) => item.key === key);

    if (!entry) {
      return;
    }

    Object.assign(entry, patch);
    renderSelectedFiles();
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []);

    if (files.length === 0) {
      return;
    }

    const availableSlots = Math.max(0, maxSelectedFiles - state.selectedFiles.length);
    const accepted = files.slice(0, availableSlots);

    if (files.length > availableSlots) {
      showToast(`Puedes preparar hasta ${maxSelectedFiles} archivos por envío.`, "error");
    }

    for (const file of accepted) {
      if (file.size > maxFileBytes) {
        showToast(`${file.name} supera el límite de ${formatBytes(maxFileBytes)}.`, "error");
        continue;
      }

      state.selectedFiles.push({
        key: crypto.randomUUID(),
        file,
        progress: 0,
        status: "",
        uploadId: "",
        controller: null
      });
    }

    onActivity();
    renderSelectedFiles();
  }

  async function completeUploadWithRetry(id) {
    let lastError = null;
    const retryableCodes = new Set(["upload-not-found", "storage-error", "network-error"]);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await api.completeUpload(id);

        if (attempt > 0) {
          showToast("La confirmación se recuperó tras un reintento.", "success");
        }

        return result;
      } catch (error) {
        lastError = error;

        if (!retryableCodes.has(error?.code) || attempt === 3) {
          throw error;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
      }
    }

    throw lastError;
  }

  async function putWithRetry(entry, uploadUrl, mimeType) {
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await api.uploadToSignedUrl(
          entry.file,
          uploadUrl,
          (progress) => {
            updateSelected(entry.key, { progress });
            onActivity();
          },
          mimeType,
          entry.controller.signal
        );
        return;
      } catch (error) {
        lastError = error;
        const status = Number(error?.status || 0);
        const retryable = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;

        if (error?.code === "upload-aborted" || !retryable || attempt === 1) {
          throw error;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }
    }

    throw lastError;
  }

  async function uploadEntry(entry, ttlMinutes) {
    let uploadId = "";

    try {
      entry.controller = new AbortController();
      updateSelected(entry.key, { status: "preparando", progress: 0, controller: entry.controller });
      const initialized = await api.initializeUpload(entry.file, ttlMinutes);
      uploadId = initialized?.upload?.id || "";
      const uploadUrl = initialized?.upload?.uploadUrl || "";
      const uploadMimeType = initialized?.upload?.mimeType || entry.file.type || "application/octet-stream";

      if (!uploadId || !uploadUrl) {
        throw new ApiError("Hopper no devolvió una URL de subida válida.", { code: "invalid-upload-url" });
      }

      updateSelected(entry.key, { status: "subiendo", uploadId });
      await putWithRetry(entry, uploadUrl, uploadMimeType);
      updateSelected(entry.key, { status: "confirmando", progress: 100 });
      await completeUploadWithRetry(uploadId);
      updateSelected(entry.key, { status: "listo", progress: 100, controller: null });
      return { ok: true, key: entry.key };
    } catch (error) {
      if (uploadId) {
        api.cancelUpload(uploadId).catch(() => {});
      }

      if (error?.code === "upload-aborted") {
        state.selectedFiles = state.selectedFiles.filter((current) => current.key !== entry.key);
        renderSelectedFiles();
        return { ok: false, cancelled: true, key: entry.key, error };
      }

      updateSelected(entry.key, { status: "error", controller: null });
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

  async function refreshItems({ quiet = false } = {}) {
    if (!state.started) {
      return;
    }

    if (!navigator.onLine) {
      setSync("Sin conexión", "offline");
      return;
    }

    if (!quiet) {
      setLoading(true);
    }

    setSync("Sincronizando…", "busy");

    try {
      const result = await api.listItems();
      state.items = Array.isArray(result?.items) ? result.items : [];
      renderItems();
      setSync("Sincronizado", "ok");
    } catch (error) {
      if (["invalid-session", "invalid-room-session"].includes(error?.code) || error?.status === 401) {
        onUnauthorized(error);
        return;
      }

      setSync(navigator.onLine ? "Reintentando" : "Sin conexión", navigator.onLine ? "busy" : "offline");

      if (!quiet) {
        showToast(error.message || "No fue posible actualizar Hopper.", "error");
      }

      throw error;
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }

  async function handleSend() {
    if (state.sending) {
      return;
    }

    const content = elements.textInput?.value || "";
    const files = state.selectedFiles.filter((entry) => entry.status !== "listo");
    const hasText = Boolean(content.trim());

    if (!hasText && files.length === 0) {
      showToast("Pega texto o adjunta al menos un archivo.", "error");
      return;
    }

    const ttlMinutes = Number(elements.ttlSelect?.value) || defaultTtlMinutes;
    onActivity();
    setSending(true);
    renderSelectedFiles();
    const failures = [];
    let textCreated = false;

    try {
      if (hasText) {
        try {
          await api.createText(content, ttlMinutes);
          textCreated = true;
        } catch (error) {
          failures.push({ label: "texto", error });
        }
      }

      const uploadResults = await runWithConcurrency(files, uploadConcurrency, (entry) => uploadEntry(entry, ttlMinutes));

      for (const result of uploadResults) {
        if (!result?.ok && !result?.cancelled) {
          const entry = state.selectedFiles.find((item) => item.key === result.key);
          failures.push({ label: entry?.file?.name || "archivo", error: result?.error });
        }
      }

      if (textCreated && elements.textInput) {
        elements.textInput.value = "";
      }

      const successfulKeys = new Set(uploadResults.filter((result) => result?.ok).map((result) => result.key));
      state.selectedFiles = state.selectedFiles.filter((entry) => !successfulKeys.has(entry.key));
      renderSelectedFiles();

      if (failures.length === 0) {
        showToast("Contenido disponible en Hopper.", "success");
      } else if (failures.length === 1) {
        showToast(`${failures[0].label}: ${failures[0].error?.message || "no pudo enviarse"}`, "error");
      } else {
        showToast(`${failures.length} elementos no pudieron enviarse.`, "error");
      }

      await refreshItems({ quiet: true }).catch(() => {});
    } finally {
      setSending(false);
      renderSelectedFiles();
    }
  }

  function currentItem(id) {
    return state.items.find((item) => item.id === id) || null;
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
    const result = await api.getFileUrl(item.id, "download");
    const link = document.createElement("a");
    link.href = result.url;
    link.download = item.name || "archivo";
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  }

  async function previewFile(item) {
    const result = await api.getFileUrl(item.id, "preview");
    elements.previewTitle.textContent = item.name || "Imagen";
    elements.previewImage.src = result.url;
    elements.previewImage.alt = `Vista previa de ${item.name || "imagen"}`;
    elements.previewDialog.showModal();
  }

  function closePreview() {
    if (elements.previewDialog?.open) {
      elements.previewDialog.close();
    }

    elements.previewImage?.removeAttribute("src");

    if (elements.previewImage) {
      elements.previewImage.alt = "";
    }
  }

  async function loadAudio(item, button) {
    const card = button.closest(".item-card");
    const audio = card?.querySelector(`[data-audio-item-id="${CSS.escape(item.id)}"]`);

    if (!audio) {
      return;
    }

    button.disabled = true;

    try {
      const result = await api.getFileUrl(item.id, "stream");
      audio.src = result.url;
      audio.dataset.urlExpiresAt = String(Date.now() + Math.max(1, Number(result.expiresIn) || 300) * 1000);
      audio.hidden = false;
      button.hidden = true;
      onActivity();
      await audio.play().catch(() => {});
    } catch (error) {
      button.disabled = false;
      showToast(error.message || "No fue posible cargar el audio.", "error");
    }
  }

  async function shareItem(item) {
    if (typeof navigator.share !== "function") {
      throw new ApiError("Compartir no está disponible en este navegador.");
    }

    if (item.type === "text") {
      await navigator.share({ title: "Hopper", text: item.content || "" });
      return;
    }

    const result = await api.getFileUrl(item.id, "download");
    await navigator.share({
      title: item.name || "Hopper",
      text: `${item.name || "Archivo"} · enlace temporal de Hopper`,
      url: result.url
    });
  }

  function openDeleteDialog(item) {
    elements.deleteDialog.dataset.itemId = item.id;
    elements.deleteCopy.textContent = item.type === "file"
      ? `“${item.name}” se eliminará inmediatamente y dejará de estar disponible en todos los dispositivos.`
      : "El texto se eliminará inmediatamente y dejará de estar disponible en todos los dispositivos.";
    elements.deleteDialog.showModal();
  }

  async function deleteCurrentItem(id) {
    try {
      await api.deleteItem(id);
      state.items = state.items.filter((current) => current.id !== id);
      renderItems();
      showToast("Elemento eliminado.", "success");
    } catch (error) {
      showToast(error.message || "No fue posible eliminar el elemento.", "error");
    }
  }

  async function resetTtl(item, minutes, select) {
    select.disabled = true;

    try {
      const result = await api.resetTtl(item.id, minutes);
      const updated = result?.item;

      if (updated) {
        state.items = state.items.map((current) => current.id === updated.id ? updated : current);
        renderItems();
        showToast("Cuenta regresiva reiniciada.", "success");
      }
    } catch (error) {
      showToast(error.message || "No fue posible cambiar la expiración.", "error");
      await refreshItems({ quiet: true }).catch(() => {});
    } finally {
      select.disabled = false;
    }
  }

  async function handleItemClick(event) {
    const button = event.target.closest("[data-action]");

    if (!button || !elements.itemList?.contains(button)) {
      return;
    }

    const item = currentItem(button.dataset.itemId);

    if (!item) {
      return;
    }

    if (Date.parse(item.expiresAt || "") <= Date.now()) {
      state.items = state.items.filter((current) => current.id !== item.id);
      renderItems();
      showToast("El elemento ya expiró.", "error");
      refreshItems({ quiet: true }).catch(() => {});
      return;
    }

    try {
      if (button.dataset.action === "copy") {
        await copyText(item);
      } else if (button.dataset.action === "download") {
        await downloadFile(item);
      } else if (button.dataset.action === "preview") {
        await previewFile(item);
      } else if (button.dataset.action === "load-audio") {
        await loadAudio(item, button);
      } else if (button.dataset.action === "share") {
        await shareItem(item);
      } else if (button.dataset.action === "delete") {
        openDeleteDialog(item);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        showToast(error.message || "No fue posible completar la acción.", "error");
      }
    }
  }

  function handleItemChange(event) {
    const select = event.target.closest(".expiry-select");

    if (!select || !elements.itemList?.contains(select) || !select.value) {
      return;
    }

    const item = currentItem(select.dataset.itemId);
    const minutes = Number(select.value);
    select.value = "";

    if (item && Number.isFinite(minutes)) {
      resetTtl(item, minutes, select);
    }
  }

  async function retrySelectedFile(key) {
    if (state.sending) {
      return;
    }

    const entry = state.selectedFiles.find((item) => item.key === key);

    if (!entry) {
      return;
    }

    state.sending = true;
    setSending(true);
    renderSelectedFiles();
    const ttlMinutes = Number(elements.ttlSelect?.value) || defaultTtlMinutes;

    try {
      const result = await uploadEntry(entry, ttlMinutes);

      if (result.ok) {
        state.selectedFiles = state.selectedFiles.filter((item) => item.key !== key);
        renderSelectedFiles();
        await refreshItems({ quiet: true }).catch(() => {});
        showToast("Archivo enviado.", "success");
      } else if (!result.cancelled) {
        showToast(result.error?.message || "No fue posible reenviar el archivo.", "error");
      }
    } finally {
      state.sending = false;
      setSending(false);
      renderSelectedFiles();
    }
  }

  function handleSelectedFileAction(event) {
    const button = event.target.closest("[data-action]");

    if (!button || !elements.selectedFiles?.contains(button)) {
      return;
    }

    const key = button.dataset.fileKey;
    const entry = state.selectedFiles.find((item) => item.key === key);

    if (!entry) {
      return;
    }

    if (button.dataset.action === "remove-selected-file") {
      state.selectedFiles = state.selectedFiles.filter((item) => item.key !== key);
      renderSelectedFiles();
      return;
    }

    if (button.dataset.action === "cancel-selected-file") {
      entry.controller?.abort();

      if (entry.uploadId) {
        api.cancelUpload(entry.uploadId).catch(() => {});
      }

      state.selectedFiles = state.selectedFiles.filter((item) => item.key !== key);
      renderSelectedFiles();
      return;
    }

    if (button.dataset.action === "retry-selected-file") {
      retrySelectedFile(key);
    }
  }

  function updateCountdowns() {
    const now = Date.now();
    let expired = false;

    for (const element of document.querySelectorAll(".expiry-countdown[data-expires-at]")) {
      const expiresAt = element.dataset.expiresAt;
      element.textContent = formatCountdown(expiresAt, now);

      if (Date.parse(expiresAt || "") <= now) {
        expired = true;
      }
    }

    if (expired) {
      const nextItems = state.items.filter((item) => Date.parse(item.expiresAt || "") > now);

      if (nextItems.length !== state.items.length) {
        state.items = nextItems;
        renderItems();
        refreshItems({ quiet: true }).catch(() => {});
      }
    }

    for (const audio of document.querySelectorAll("audio[data-audio-item-id]")) {
      const expiry = Number(audio.dataset.urlExpiresAt || 0);

      if (expiry && expiry <= now && audio.paused) {
        const card = audio.closest(".item-card");
        const button = card?.querySelector('[data-action="load-audio"]');
        audio.removeAttribute("src");
        audio.load();
        audio.hidden = true;
        delete audio.dataset.urlExpiresAt;

        if (button) {
          button.hidden = false;
          button.disabled = false;
        }
      }
    }
  }

  function handlePaste(event) {
    const clipboard = event.clipboardData;

    if (!clipboard) {
      return;
    }

    const files = Array.from(clipboard.files || []);

    if (files.length > 0) {
      addFiles(files);
      showToast(files.length === 1 ? "Archivo pegado." : `${files.length} archivos pegados.`, "success");
      return;
    }

    const itemFiles = Array.from(clipboard.items || [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean);

    if (itemFiles.length > 0) {
      addFiles(itemFiles);
      showToast(itemFiles.length === 1 ? "Archivo pegado." : `${itemFiles.length} archivos pegados.`, "success");
    }
  }

  function bindEvents() {
    if (state.bound) {
      return;
    }

    state.bound = true;
    elements.dropZone?.addEventListener("click", () => {
      if (!state.sending) {
        elements.fileInput?.click();
      }
    });
    elements.dropZone?.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !state.sending) {
        event.preventDefault();
        elements.fileInput?.click();
      }
    });
    elements.fileInput?.addEventListener("change", () => {
      addFiles(elements.fileInput.files);
      elements.fileInput.value = "";
    });

    for (const eventName of ["dragenter", "dragover"]) {
      elements.dropZone?.addEventListener(eventName, (event) => {
        event.preventDefault();
        elements.dropZone.classList.add("is-dragging");
      });
    }

    for (const eventName of ["dragleave", "drop"]) {
      elements.dropZone?.addEventListener(eventName, (event) => {
        event.preventDefault();
        elements.dropZone.classList.remove("is-dragging");
      });
    }

    elements.dropZone?.addEventListener("drop", (event) => {
      if (!state.sending) {
        addFiles(event.dataTransfer?.files);
      }
    });
    elements.selectedFiles?.addEventListener("click", handleSelectedFileAction);
    elements.sendButton?.addEventListener("click", handleSend);
    elements.textInput?.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        handleSend();
      }
    });
    elements.textInput?.addEventListener("paste", handlePaste);
    document.addEventListener("paste", (event) => {
      if (event.target !== elements.textInput) {
        handlePaste(event);
      }
    });
    elements.refreshButton?.addEventListener("click", async () => {
      elements.refreshButton.disabled = true;
      elements.refreshButton.classList.add("is-spinning");

      try {
        await refreshItems();
      } catch {
        setSync(navigator.onLine ? "Reintentando" : "Sin conexión", navigator.onLine ? "busy" : "offline");
      } finally {
        elements.refreshButton.classList.remove("is-spinning");
        elements.refreshButton.disabled = false;
      }
    });
    elements.itemList?.addEventListener("click", handleItemClick);
    elements.itemList?.addEventListener("change", handleItemChange);
    elements.previewClose?.addEventListener("click", closePreview);
    elements.previewDialog?.addEventListener("click", (event) => {
      if (event.target === elements.previewDialog) {
        closePreview();
      }
    });
    elements.deleteDialog?.addEventListener("close", () => {
      const id = elements.deleteDialog.dataset.itemId;

      if (elements.deleteDialog.returnValue === "confirm" && id) {
        deleteCurrentItem(id);
      }

      elements.deleteDialog.dataset.itemId = "";
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.started && !state.sending) {
        refreshItems({ quiet: true }).catch(() => {});
      }
    });
    window.addEventListener("offline", () => setSync("Sin conexión", "offline"));
    window.addEventListener("online", () => {
      setSync("Reintentando", "busy");
      refreshItems({ quiet: true }).catch(() => {});
    });
  }

  async function start() {
    bindEvents();
    state.started = true;

    if (elements.dropLimit) {
      elements.dropLimit.textContent = `Hasta ${formatBytes(maxFileBytes)} por archivo`;
    }

    if (elements.ttlSelect && ttlOptions.includes(defaultTtlMinutes)) {
      elements.ttlSelect.value = String(defaultTtlMinutes);
    }

    renderItems();
    renderSelectedFiles();
    clearInterval(state.countdownTimer);
    clearInterval(state.refreshTimer);
    state.countdownTimer = window.setInterval(updateCountdowns, 1000);
    state.refreshTimer = window.setInterval(() => {
      if (!document.hidden && !state.sending) {
        refreshItems({ quiet: true }).catch(() => {});
      }
    }, pollIntervalMs);
    await refreshItems();
  }

  function stop() {
    state.started = false;
    clearInterval(state.countdownTimer);
    clearInterval(state.refreshTimer);
    state.countdownTimer = null;
    state.refreshTimer = null;

    for (const entry of state.selectedFiles) {
      entry.controller?.abort();
    }

    state.items = [];
    state.selectedFiles = [];
    state.sending = false;
    renderItems();
    renderSelectedFiles();
    setSending(false);
  }

  return {
    addFiles,
    formatBytes,
    refreshItems,
    showToast,
    start,
    stop
  };
}

export { createTransferController, formatBytes, formatCountdown };