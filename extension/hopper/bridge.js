/* El puente solo se ejecuta en Hopper. El token permanece en el almacenamiento de su origen. */
(() => {
  "use strict";

  const API_ROOT = "https://hopper-api.renzofernando.workers.dev";
  const SESSION_KEY = "hopper-session-v1";
  const MAX_FILE_BYTES = 128 * 1024 * 1024;
  const STAGING_TIMEOUT_MS = 19 * 60 * 1000;
  const pending = new Map();

  function sessionToken() {
    let record;
    try { record = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
    catch { return ""; }
    return typeof record?.token === "string" && Number(record.expiresAt) > Date.now() ? record.token : "";
  }

  async function api(path, method = "GET", body) {
    const token = sessionToken();
    if (!token) throw new Error("Inicia sesión en Hopper para usar la extensión.");
    const response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      credentials: "omit"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      throw new Error(result.message || `Hopper rechazó la solicitud (${response.status}).`);
    }
    return result;
  }

  function summary() {
    return [...pending.entries()].map(([key, value]) => ({
      key, name: value.name, size: value.size,
      status: value.status, progress: value.progress,
      createdAt: value.createdAt
    }));
  }

  function notify(key, progress, status) {
    const entry = pending.get(key);
    if (!entry) return;
    entry.progress = progress;
    entry.status = status;
    try { chrome.runtime.sendMessage({ type: "hopper-progress", key, progress, status }, () => { void chrome.runtime.lastError; }); }
    catch { /* La interfaz puede estar cerrada, pero la subida continúa. */ }
  }

  function decodeChunk(base64) {
    const bytes = atob(base64);
    const output = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) output[i] = bytes.charCodeAt(i);
    return output;
  }

  async function remove(key) {
    const entry = pending.get(key);
    if (!entry) return;
    entry.controller?.abort();
    pending.delete(key);
    if (entry.uploadId) await api(`/api/uploads/${encodeURIComponent(entry.uploadId)}/cancel`, "DELETE").catch(() => undefined);
  }

  async function execute(message) {
    const { action, payload = {} } = message;
    if (action === "status") return { authorized: Boolean(sessionToken()), files: summary() };
    if (!sessionToken()) throw new Error("Inicia sesión en Hopper y vuelve a abrir la extensión.");

    if (action === "send-text") {
      const content = String(payload.content || "").trim();
      if (!content || content.length > 250000) throw new Error("El texto debe tener entre 1 y 250 000 caracteres.");
      await api("/api/items/text", "POST", { content, ttlMinutes: payload.ttlMinutes });
      return { sent: true };
    }

    if (action === "start-file") {
      const { key, name, size, mimeType, ttlMinutes } = payload;
      if (typeof key !== "string" || !key || pending.has(key)) throw new Error("Identificador de archivo inválido.");
      if (typeof name !== "string" || !name || !Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
        throw new Error("La extensión permite archivos de hasta 128 MB. Para archivos grandes, abre Hopper.");
      }
      const initialized = await api("/api/uploads/init", "POST", {
        name, size, mimeType: mimeType || "application/octet-stream", ttlMinutes
      });
      if (!initialized.upload?.id || !initialized.upload?.uploadUrl) throw new Error("No fue posible preparar el archivo.");
      pending.set(key, {
        name, size, mimeType: initialized.upload.mimeType || mimeType || "application/octet-stream",
        uploadId: initialized.upload.id, uploadUrl: initialized.upload.uploadUrl,
        createdAt: Date.now(), status: "Preparando", progress: 0,
        parts: [], received: 0, controller: null
      });
      return { started: true };
    }

    if (action === "file-chunk") {
      const entry = pending.get(payload.key);
      if (!entry || entry.status !== "Preparando" || typeof payload.chunk !== "string") throw new Error("La transferencia ya no está disponible.");
      const part = decodeChunk(payload.chunk);
      if (part.length > 256 * 1024 || entry.received + part.length > entry.size) throw new Error("Bloque de archivo inválido.");
      entry.parts.push(part);
      entry.received += part.length;
      return { received: entry.received };
    }

    if (action === "upload-file") {
      const entry = pending.get(payload.key);
      if (!entry || entry.status !== "Preparando" || entry.received !== entry.size) throw new Error("El archivo está incompleto.");
      const blob = new Blob(entry.parts, { type: entry.mimeType });
      entry.parts = [];
      entry.status = "Subiendo";
      const controller = new XMLHttpRequest();
      entry.controller = controller;
      await new Promise((resolve, reject) => {
        controller.open("PUT", entry.uploadUrl);
        controller.setRequestHeader("Content-Type", entry.mimeType);
        controller.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) notify(payload.key, Math.min(99, Math.round(event.loaded / event.total * 100)), "Subiendo");
        });
        controller.addEventListener("load", () => controller.status >= 200 && controller.status < 300
          ? resolve() : reject(new Error(`Backblaze rechazó el archivo (${controller.status}).`)));
        controller.addEventListener("error", () => reject(new Error("La subida fue interrumpida.")));
        controller.addEventListener("abort", () => reject(new Error("La subida fue cancelada.")));
        controller.send(blob);
      }).catch(async (error) => {
        notify(payload.key, entry.progress, "Error");
        await remove(payload.key);
        throw error;
      });
      entry.controller = null;
      notify(payload.key, 100, "Preparado");
      return { uploaded: true };
    }

    if (action === "publish") {
      const entries = [...pending.entries()];
      if (!entries.length) throw new Error("No hay archivos preparados.");
      if (entries.some(([, item]) => item.status !== "Preparado")) throw new Error("Espera a que finalicen todas las subidas.");
      const ttlMinutes = Number(payload.ttlMinutes);
      const published = [];
      const errors = [];
      for (const [key, item] of entries) {
        try {
          if (Date.now() - item.createdAt >= STAGING_TIMEOUT_MS) throw new Error("El archivo preparado caducó. Vuelve a adjuntarlo.");
          await api(`/api/uploads/${encodeURIComponent(item.uploadId)}/complete`, "POST", { ttlMinutes });
          pending.delete(key);
          published.push(key);
        } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      }
      return { published, errors, files: summary() };
    }

    if (action === "remove") { await remove(payload.key); return { files: summary() }; }
    throw new Error("Operación desconocida.");
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "hopper-extension") return false;
    void execute(message).then(
      (data) => sendResponse({ ok: true, ...data }),
      (error) => sendResponse({ ok: false, message: error instanceof Error ? error.message : "Operación fallida." })
    );
    return true;
  });

  window.setInterval(() => {
    for (const [key, entry] of pending) if (Date.now() - entry.createdAt > STAGING_TIMEOUT_MS) void remove(key);
  }, 60_000);
})();
