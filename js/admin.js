import { hopperApi } from "./api.js";
import { formatBytes, formatCountdown } from "./transfer-controller.js";

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
  refreshButton: document.querySelector("#admin-refresh-button"),
  cleanupButton: document.querySelector("#cleanup-button"),
  reconcileButton: document.querySelector("#reconcile-button"),
  changePinButton: document.querySelector("#change-pin-button"),
  deleteStatsButton: document.querySelector("#delete-stats-button"),
  resetSystemButton: document.querySelector("#reset-system-button"),
  changePinDialog: document.querySelector("#change-pin-dialog"),
  changePinForm: document.querySelector("#change-pin-form"),
  changePinNew: document.querySelector("#change-pin-new"),
  changePinConfirm: document.querySelector("#change-pin-confirm"),
  changePinMessage: document.querySelector("#change-pin-message"),
  changePinCancel: document.querySelector("#change-pin-cancel"),
  changePinSubmit: document.querySelector("#change-pin-submit"),
  toastRegion: document.querySelector("#toast-region")
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

function statusRow(label, value, variant = "") {
  const row = document.createElement("div");
  row.className = "status-row";
  const name = document.createElement("span");
  name.textContent = label;
  const status = document.createElement("strong");
  status.className = variant ? `is-${variant}` : "";
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
    statusRow("Advertencia", formatBytes(usage.limits.storageWarningBytes), "info"),
    statusRow("Salas activas", `${usage.rooms.active} / ${usage.rooms.maximum}`),
    statusRow("Archivo por sala", formatBytes(usage.limits.roomMaxFileBytes)),
    statusRow("Almacenamiento por sala", formatBytes(usage.limits.roomMaxBytes)),
    statusRow("Elementos por sala", String(usage.limits.roomMaxItems)),
    statusRow("Inactividad de sala", `${usage.limits.roomMaxTtlMinutes} min`),
    statusRow("Elementos activos", String(usage.limits.activeItems)),
    statusRow("Uploads pendientes", String(usage.limits.pendingUploads), usage.limits.pendingUploads > 0 ? "info" : ""),
    statusRow("Huérfanos", String(usage.limits.orphanItems), usage.limits.orphanItems === 0 ? "ok" : "error"),
    statusRow("Fallos cleanup", String(usage.limits.cleanupFailures), usage.limits.cleanupFailures === 0 ? "ok" : "error")
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
    statusRow("Worker", healthLabel(health.worker), health.worker.ok ? "ok" : "error"),
    statusRow("D1", healthLabel(health.d1), health.d1.ok ? "ok" : "error"),
    statusRow("B2", healthLabel(health.b2), health.b2.ok ? "ok" : "error"),
    statusRow("Firma B2", healthLabel(health.b2Signing), health.b2Signing.ok ? "ok" : "error"),
    statusRow("Resend", health.resend.configured ? "Configurado" : "No configurado", health.resend.ok ? "ok" : "error"),
    statusRow("Cleanup", health.cleanup.ok ? "OK" : "Revisar", health.cleanup.ok ? "ok" : "error"),
    statusRow("Última limpieza", cleanupTime, health.cleanup.lastCleanupAt ? "info" : "error"),
    statusRow("Reconciliación", health.reconcile.lastReconcileAt ? "Ejecutada" : "Pendiente", health.reconcile.lastReconcileAt ? "info" : "error")
  );
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

  state.rooms.forEach((room, index) => {
    const card = document.createElement("article");
    card.className = "admin-room";
    card.dataset.roomId = room.id;
    card.dataset.expiresAt = room.expiresAt;
    const info = document.createElement("div");
    info.className = "admin-room-info";
    const title = document.createElement("strong");
    title.textContent = `Sala ${index + 1}`;
    const meta = document.createElement("span");
    meta.innerHTML = `<span data-room-countdown>${formatCountdown(room.expiresAt)}</span> · ${formatBytes(room.usedBytes)} · ${room.itemCount} elemento${room.itemCount === 1 ? "" : "s"}`;
    info.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "admin-room-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "admin-room-action is-info";
    open.dataset.action = "open";
    open.dataset.roomId = room.id;
    open.setAttribute("aria-label", "Abrir sala");
    open.title = "Abrir sala";
    open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Zm2.5 7h5M13.5 9l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
    const close = document.createElement("button");
    close.type = "button";
    close.className = "admin-room-action is-danger";
    close.dataset.action = "close";
    close.dataset.roomId = room.id;
    close.setAttribute("aria-label", "Cerrar sala");
    close.title = "Cerrar sala";
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>';
    actions.append(open, close);
    card.append(info, actions);
    elements.roomList.append(card);
  });
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

    showToast(error.message || "No fue posible actualizar Administración.", "error");
  } finally {
    state.busy = false;
    elements.refreshButton.disabled = false;
    elements.refreshButton.classList.remove("is-spinning");
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

  if (button.dataset.action === "open") {
    button.disabled = true;

    try {
      await hopperApi.adminOpenRoom(room.id);
      window.location.assign("room.html");
    } catch (error) {
      showToast(error.message || "No fue posible abrir la sala.", "error");
      button.disabled = false;
    }
    return;
  }

  if (button.dataset.action === "close") {
    button.disabled = true;

    try {
      await hopperApi.closeRoom(room.id);
      showToast("Sala cerrada.", "success");
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


function normalizePinInput(input) {
  const normalized = String(input.value || "").replace(/\D/g, "").slice(0, 4);

  if (input.value !== normalized) {
    input.value = normalized;
  }

  return normalized;
}

function setChangePinMessage(message, type = "") {
  elements.changePinMessage.textContent = message;
  elements.changePinMessage.className = `form-message ${type ? `is-${type}` : ""}`.trim();
  elements.changePinMessage.hidden = !message;
}

function openChangePinDialog() {
  elements.changePinNew.value = "";
  elements.changePinConfirm.value = "";
  setChangePinMessage("");
  elements.changePinDialog.showModal();
  window.requestAnimationFrame(() => elements.changePinNew.focus());
}

function closeChangePinDialog() {
  if (!elements.changePinSubmit.disabled) {
    elements.changePinDialog.close();
  }
}

async function changePin(event) {
  event.preventDefault();
  const pin = normalizePinInput(elements.changePinNew);
  const confirmation = normalizePinInput(elements.changePinConfirm);

  if (pin.length !== 4 || confirmation.length !== 4) {
    setChangePinMessage("Escribe cuatro dígitos en ambos campos.", "error");
    return;
  }

  if (pin !== confirmation) {
    setChangePinMessage("Los PIN no coinciden.", "error");
    return;
  }

  elements.changePinSubmit.disabled = true;
  elements.changePinCancel.disabled = true;
  elements.changePinNew.disabled = true;
  elements.changePinConfirm.disabled = true;
  setChangePinMessage("Guardando…");

  try {
    await hopperApi.adminChangePin(pin, confirmation);
    hopperApi.clearSession();
    setChangePinMessage("PIN actualizado. Volviendo al inicio…", "success");
    window.setTimeout(() => window.location.replace("./"), 450);
  } catch (error) {
    setChangePinMessage(error.message || "No fue posible cambiar el PIN.", "error");
    elements.changePinSubmit.disabled = false;
    elements.changePinCancel.disabled = false;
    elements.changePinNew.disabled = false;
    elements.changePinConfirm.disabled = false;
  }
}

async function resetSystem() {
  if (!window.confirm("¿Reiniciar Hopper? Se eliminará todo el contenido temporal, se cerrarán las salas y se invalidarán las sesiones. El PIN, la configuración y las estadísticas se conservarán.")) {
    return;
  }

  elements.resetSystemButton.disabled = true;

  try {
    await hopperApi.adminResetSystem();
    hopperApi.clearSession();
    hopperApi.clearRoomSession();
    showToast("Sistema reiniciado. Volviendo al inicio…", "success");
    window.setTimeout(() => window.location.replace("./"), 450);
  } catch (error) {
    showToast(error.message || "No fue posible reiniciar Hopper.", "error");
    elements.resetSystemButton.disabled = false;
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
  elements.roomList.addEventListener("click", (event) => handleRoomAction(event).catch((error) => showToast(error.message, "error")));
  elements.cleanupButton.addEventListener("click", () => runMaintenance("cleanup"));
  elements.reconcileButton.addEventListener("click", () => runMaintenance("reconcile"));
  elements.changePinButton.addEventListener("click", openChangePinDialog);
  elements.changePinNew.addEventListener("input", () => { normalizePinInput(elements.changePinNew); setChangePinMessage(""); });
  elements.changePinConfirm.addEventListener("input", () => { normalizePinInput(elements.changePinConfirm); setChangePinMessage(""); });
  elements.changePinForm.addEventListener("submit", changePin);
  elements.changePinCancel.addEventListener("click", closeChangePinDialog);
  elements.changePinDialog.addEventListener("click", (event) => {
    if (event.target === elements.changePinDialog) {
      closeChangePinDialog();
    }
  });
  elements.deleteStatsButton.addEventListener("click", deleteStatistics);
  elements.resetSystemButton.addEventListener("click", resetSystem);
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
