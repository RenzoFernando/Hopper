import { hopperApi } from "./api.js?v=20260908-4";
import { renderQr } from "./qrcode.js?v=20260908-4";
import { formatBytes, formatCountdown } from "./transfer-controller.js?v=20260908-4";

const elements = {
  usageStorage: document.querySelector("#usage-storage"),
  usageFree: document.querySelector("#usage-free"),
  usageTodayUploads: document.querySelector("#usage-today-uploads"),
  usageTodayDeleted: document.querySelector("#usage-today-deleted"),
  usageTodayTransfers: document.querySelector("#usage-today-transfers"),
  usageTodayFailures: document.querySelector("#usage-today-failures"),
  usageWeekUploads: document.querySelector("#usage-week-uploads"),
  usageWeekTransfers: document.querySelector("#usage-week-transfers"),
  storageMeter: document.querySelector("#storage-meter"),
  storageState: document.querySelector("#storage-state"),
  healthList: document.querySelector("#health-list"),
  limitsList: document.querySelector("#limits-list"),
  roomList: document.querySelector("#admin-room-list"),
  roomCount: document.querySelector("#admin-room-count"),
  roomTtl: document.querySelector("#room-ttl"),
  newRoomButton: document.querySelector("#new-room-button"),
  refreshButton: document.querySelector("#admin-refresh-button"),
  cleanupButton: document.querySelector("#cleanup-button"),
  reconcileButton: document.querySelector("#reconcile-button"),
  deleteStatsButton: document.querySelector("#delete-stats-button"),
  toastRegion: document.querySelector("#toast-region"),
  qrDialog: document.querySelector("#qr-dialog"),
  qrCanvas: document.querySelector("#qr-canvas"),
  qrCode: document.querySelector("#qr-code"),
  qrClose: document.querySelector("#qr-close")
};

const state = {
  usage: null,
  health: null,
  rooms: [],
  busy: false,
  countdownTimer: null
};

function showToast(message, type = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${type ? `is-${type}` : ""}`.trim();
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3800);
}

function statusRow(label, value, ok = true) {
  const row = document.createElement("div");
  row.className = "status-row";
  const name = document.createElement("span");
  name.textContent = label;
  const status = document.createElement("strong");
  status.className = ok ? "is-ok" : "is-error";
  status.textContent = value;
  row.append(name, status);
  return row;
}

function renderUsage() {
  const usage = state.usage;

  if (!usage) {
    return;
  }

  elements.usageStorage.textContent = `${formatBytes(usage.storage.estimatedBytes)} / ${formatBytes(usage.storage.referenceBytes)}`;
  elements.usageFree.textContent = formatBytes(usage.storage.freeEstimatedBytes);
  elements.usageTodayUploads.textContent = formatBytes(usage.today.uploadBytes);
  elements.usageTodayDeleted.textContent = formatBytes(usage.today.deletedBytes);
  elements.usageTodayTransfers.textContent = String(usage.today.uploadsCount);
  elements.usageTodayFailures.textContent = String(usage.today.failedUploads + usage.today.cleanupFailures);
  elements.usageWeekUploads.textContent = formatBytes(usage.last7Days.uploadBytes);
  elements.usageWeekTransfers.textContent = String(usage.last7Days.uploadsCount);
  const percent = Math.min(100, Math.max(0, usage.storage.estimatedBytes / usage.storage.referenceBytes * 100));
  elements.storageMeter.style.width = `${percent}%`;

  if (usage.storage.blocked) {
    elements.storageState.textContent = "Bloqueo preventivo activo";
    elements.storageState.className = "usage-state is-error";
  } else if (usage.storage.warning) {
    elements.storageState.textContent = "Advertencia de almacenamiento";
    elements.storageState.className = "usage-state is-warning";
  } else {
    elements.storageState.textContent = "Dentro del margen interno";
    elements.storageState.className = "usage-state is-ok";
  }

  elements.limitsList.replaceChildren(
    statusRow("Máximo por archivo", formatBytes(usage.limits.maxFileBytes)),
    statusRow("Límite interno", formatBytes(usage.limits.storageInternalLimitBytes)),
    statusRow("Advertencia", formatBytes(usage.limits.storageWarningBytes)),
    statusRow("Salas", `${usage.rooms.active} / ${usage.rooms.maximum}`),
    statusRow("Archivo por sala", formatBytes(usage.limits.roomMaxFileBytes)),
    statusRow("Almacenamiento por sala", formatBytes(usage.limits.roomMaxBytes)),
    statusRow("Elementos por sala", String(usage.limits.roomMaxItems)),
    statusRow("TTL máximo de sala", `${usage.limits.roomMaxTtlMinutes} min`),
    statusRow("Elementos activos", String(usage.limits.activeItems)),
    statusRow("Uploads pendientes", String(usage.limits.pendingUploads)),
    statusRow("Huérfanos", String(usage.limits.orphanItems), usage.limits.orphanItems === 0),
    statusRow("Fallos cleanup", String(usage.limits.cleanupFailures), usage.limits.cleanupFailures === 0)
  );
}

function healthLabel(item, configuredLabel = "OK") {
  return item?.ok ? configuredLabel : "Error";
}

function renderHealth() {
  const health = state.health;

  if (!health) {
    return;
  }

  const cleanupTime = health.cleanup.lastCleanupAt
    ? new Date(health.cleanup.lastCleanupAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "Sin ejecución";
  elements.healthList.replaceChildren(
    statusRow("Worker", healthLabel(health.worker), health.worker.ok),
    statusRow("D1", healthLabel(health.d1), health.d1.ok),
    statusRow("B2", healthLabel(health.b2), health.b2.ok),
    statusRow("Firma B2", healthLabel(health.b2Signing), health.b2Signing.ok),
    statusRow("Resend", health.resend.configured ? "Configurado" : "No configurado", health.resend.ok),
    statusRow("Cleanup", health.cleanup.ok ? "OK" : "Revisar", health.cleanup.ok),
    statusRow("Última limpieza", cleanupTime, Boolean(health.cleanup.lastCleanupAt)),
    statusRow("Reconciliación", health.reconcile.lastReconcileAt ? "Ejecutada" : "Pendiente", Boolean(health.reconcile.lastReconcileAt))
  );
}

function rememberedCode(roomId) {
  return hopperApi.getRememberedRoomCodes()?.[roomId]?.code || "";
}

function roomInviteUrl(code) {
  const url = new URL("room.html", window.location.href);
  url.hash = code;
  return url.toString();
}

async function copyValue(value, message) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  showToast(message, "success");
}

function openQr(code) {
  const url = roomInviteUrl(code);
  renderQr(elements.qrCanvas, url, 260);
  elements.qrCode.textContent = code;
  elements.qrDialog.showModal();
}

async function shareRoom(room, code) {
  const url = roomInviteUrl(code);
  const minutes = Math.max(1, Math.ceil((Date.parse(room.expiresAt) - Date.now()) / 60000));
  const text = `Hopper\nSala: ${code}\nEnlace: ${url}\nExpira en: ${minutes} min`;

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Hopper", text, url });
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
    }
  }

  await copyValue(text, "Invitación copiada.");
}

function renderRooms() {
  elements.roomList.replaceChildren();
  elements.roomCount.textContent = `${state.rooms.length} / 2`;

  if (state.rooms.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "No hay salas activas.";
    elements.roomList.append(empty);
    return;
  }

  for (const room of state.rooms) {
    const code = rememberedCode(room.id);
    const card = document.createElement("article");
    card.className = "admin-room";
    card.dataset.roomId = room.id;
    card.dataset.expiresAt = room.expiresAt;
    const info = document.createElement("div");
    info.className = "admin-room-info";
    const title = document.createElement("strong");
    title.textContent = code || "Sala activa";
    const meta = document.createElement("span");
    meta.innerHTML = `<span data-room-countdown>${formatCountdown(room.expiresAt)}</span> · ${formatBytes(room.usedBytes)} · ${room.itemCount} elemento${room.itemCount === 1 ? "" : "s"}`;
    const codeNote = document.createElement("span");
    codeNote.className = "admin-room-note";
    codeNote.textContent = code ? "Código disponible en esta sesión." : "El código no se conserva; crea otra sala si necesitas una nueva invitación.";
    info.append(title, meta, codeNote);
    const actions = document.createElement("div");
    actions.className = "admin-room-actions";

    if (code) {
      for (const [label, action] of [["QR", "qr"], ["Copiar", "copy"], ["Compartir", "share"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button compact-button";
        button.dataset.action = action;
        button.dataset.roomId = room.id;
        button.textContent = label;
        actions.append(button);
      }
    }

    const open = document.createElement("a");
    open.className = "secondary-button compact-button button-link";
    open.href = code ? `room.html#${encodeURIComponent(code)}` : "room.html";
    open.textContent = "Abrir";
    actions.append(open);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "danger-button compact-button";
    close.dataset.action = "close";
    close.dataset.roomId = room.id;
    close.textContent = "Cerrar";
    actions.append(close);
    card.append(info, actions);
    elements.roomList.append(card);
  }
}

function renderRoomCountdowns() {
  const now = Date.now();

  for (const card of elements.roomList.querySelectorAll("[data-expires-at]")) {
    const countdown = card.querySelector("[data-room-countdown]");

    if (countdown) {
      countdown.textContent = formatCountdown(card.dataset.expiresAt, now);
    }
  }
}

async function refreshAll({ includeHealth = true } = {}) {
  if (state.busy) {
    return;
  }

  state.busy = true;
  elements.refreshButton.disabled = true;
  elements.refreshButton.classList.add("is-spinning");

  try {
    const [usage, rooms, health] = await Promise.all([
      hopperApi.adminUsage(),
      hopperApi.adminRooms(),
      includeHealth ? hopperApi.adminHealth() : Promise.resolve(null)
    ]);
    state.usage = usage;
    state.rooms = Array.isArray(rooms?.rooms) ? rooms.rooms : [];

    if (health?.health) {
      state.health = health.health;
    }

    renderUsage();
    renderRooms();
    renderHealth();
  } catch (error) {
    if (error?.status === 401) {
      window.location.replace("./");
      return;
    }

    showToast(error.message || "No fue posible actualizar Uso.", "error");
  } finally {
    state.busy = false;
    elements.refreshButton.disabled = false;
    elements.refreshButton.classList.remove("is-spinning");
  }
}

async function createNewRoom() {
  elements.newRoomButton.disabled = true;

  try {
    const result = await hopperApi.createRoom(Number(elements.roomTtl.value) || 5);
    showToast(`Sala ${result.code} creada.`, "success");
    await refreshAll({ includeHealth: false });
    openQr(result.code);
  } catch (error) {
    showToast(error.message || "No fue posible crear la sala.", "error");
  } finally {
    elements.newRoomButton.disabled = false;
  }
}

async function handleRoomAction(event) {
  const button = event.target.closest("[data-action]");

  if (!button || !elements.roomList.contains(button)) {
    return;
  }

  const room = state.rooms.find((item) => item.id === button.dataset.roomId);

  if (!room) {
    return;
  }

  const code = rememberedCode(room.id);

  if (button.dataset.action === "qr" && code) {
    openQr(code);
    return;
  }

  if (button.dataset.action === "copy" && code) {
    await copyValue(code, "Código copiado.");
    return;
  }

  if (button.dataset.action === "share" && code) {
    await shareRoom(room, code);
    return;
  }

  if (button.dataset.action === "close") {
    button.disabled = true;

    try {
      await hopperApi.closeRoom(room.id);
      showToast("Sala cerrada y contenido retirado.", "success");
      await refreshAll({ includeHealth: false });
    } catch (error) {
      showToast(error.message || "No fue posible cerrar la sala.", "error");
      button.disabled = false;
    }
  }
}

async function runMaintenance(action) {
  const button = action === "cleanup" ? elements.cleanupButton : elements.reconcileButton;
  button.disabled = true;

  try {
    if (action === "cleanup") {
      const result = await hopperApi.adminCleanup();
      showToast(`Limpieza completada: ${result.items?.deleted || 0} elementos eliminados.`, "success");
    } else {
      const result = await hopperApi.adminReconcile();
      showToast(`Reconciliación: ${result.orphanDeleted || 0} versiones huérfanas eliminadas.`, "success");
    }

    await refreshAll();
  } catch (error) {
    showToast(error.message || "No fue posible ejecutar el mantenimiento.", "error");
  } finally {
    button.disabled = false;
  }
}

async function deleteStatistics() {
  if (!window.confirm("¿Borrar las estadísticas agregadas de Hopper? El contenido temporal no se ve afectado.")) {
    return;
  }

  elements.deleteStatsButton.disabled = true;

  try {
    await hopperApi.adminDeleteStatistics();
    showToast("Estadísticas borradas.", "success");
    await refreshAll({ includeHealth: false });
  } catch (error) {
    showToast(error.message || "No fue posible borrar las estadísticas.", "error");
  } finally {
    elements.deleteStatsButton.disabled = false;
  }
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => refreshAll());
  elements.newRoomButton.addEventListener("click", createNewRoom);
  elements.roomList.addEventListener("click", (event) => handleRoomAction(event).catch((error) => showToast(error.message, "error")));
  elements.cleanupButton.addEventListener("click", () => runMaintenance("cleanup"));
  elements.reconcileButton.addEventListener("click", () => runMaintenance("reconcile"));
  elements.deleteStatsButton.addEventListener("click", deleteStatistics);
  elements.qrClose.addEventListener("click", () => elements.qrDialog.close());
  elements.qrDialog.addEventListener("click", (event) => {
    if (event.target === elements.qrDialog) {
      elements.qrDialog.close();
    }
  });
  window.addEventListener("hopper:session-expired", () => window.location.replace("./"));
}

async function initialize() {
  if (!hopperApi.hasSession()) {
    window.location.replace("./");
    return;
  }

  bindEvents();
  state.countdownTimer = window.setInterval(renderRoomCountdowns, 1000);
  await refreshAll();
}

initialize();