import { appConfig } from "./config.js";

const SESSION_KEY = "hopper-session-v1";
const ROOM_SESSION_KEY = "hopper-room-session-v1";
const ROOM_CODES_KEY = "hopper-room-codes-v1";

class ApiError extends Error {
  constructor(message, { status = 0, code = "network-error" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function apiRoot() {
  const value = String(appConfig.workerBaseUrl || "").trim().replace(/\/+$/, "");

  if (!value) {
    throw new ApiError(
      "El endpoint de Hopper todavía no está configurado. Ejecuta hopper-admin.ps1 para completar el despliegue.",
      { code: "app-not-configured" }
    );
  }

  return value;
}

function readSession(key) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || "null");

    if (!parsed?.token || !Number.isFinite(parsed?.expiresAt) || parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(key);
      return null;
    }

    return parsed;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

function setSession(key, token, expiresInSeconds, extra = {}) {
  const expiresAt = Date.now() + Math.max(1, Number(expiresInSeconds) || 0) * 1000;
  sessionStorage.setItem(key, JSON.stringify({ token, expiresAt, ...extra }));
}

function clearSession(key) {
  sessionStorage.removeItem(key);
}

function readRoomCodes() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ROOM_CODES_KEY) || "{}");
    const now = Date.now();
    const filtered = Object.fromEntries(
      Object.entries(parsed || {}).filter(([, value]) => value?.code && Number(value?.expiresAt || 0) > now)
    );
    sessionStorage.setItem(ROOM_CODES_KEY, JSON.stringify(filtered));
    return filtered;
  } catch {
    sessionStorage.removeItem(ROOM_CODES_KEY);
    return {};
  }
}

function rememberRoomCode(roomId, code, expiresAt) {
  if (!roomId || !code) {
    return;
  }

  const codes = readRoomCodes();
  codes[roomId] = { code, expiresAt: Date.parse(expiresAt || "") || Date.now() + 3600000 };
  sessionStorage.setItem(ROOM_CODES_KEY, JSON.stringify(codes));
}

function forgetRoomCode(roomId) {
  const codes = readRoomCodes();
  delete codes[roomId];
  sessionStorage.setItem(ROOM_CODES_KEY, JSON.stringify(codes));
}

function tokenFor(auth) {
  if (auth === "personal") {
    return readSession(SESSION_KEY)?.token || "";
  }

  if (auth === "room") {
    return readSession(ROOM_SESSION_KEY)?.token || "";
  }

  return "";
}

async function request(path, {
  method = "GET",
  body,
  auth = ""
} = {}) {
  const headers = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    const token = tokenFor(auth);

    if (!token) {
      throw new ApiError("La sesión venció. Ingresa de nuevo.", {
        status: 401,
        code: auth === "room" ? "invalid-room-session" : "invalid-session"
      });
    }

    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(`${apiRoot()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "omit"
    });
  } catch {
    throw new ApiError("No fue posible conectar con Hopper.", { code: "network-error" });
  }

  let payload = null;

  try {
    payload = response.status === 204 ? null : await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false && response.status >= 400) {
    const error = new ApiError(
      payload?.message || "Hopper no pudo completar la solicitud.",
      { status: response.status, code: payload?.code || "api-error" }
    );

    if (response.status === 401 && auth === "personal") {
      clearSession(SESSION_KEY);
      window.dispatchEvent(new CustomEvent("hopper:session-expired"));
    }

    if (response.status === 401 && auth === "room") {
      clearSession(ROOM_SESSION_KEY);
      window.dispatchEvent(new CustomEvent("hopper:room-session-expired"));
    }

    throw error;
  }

  return payload;
}

function uploadToSignedUrl(file, uploadUrl, onProgress, contentType = "", signal = null) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && typeof onProgress === "function") {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }

      reject(new ApiError(`El almacenamiento rechazó la subida (${xhr.status}).`, {
        status: xhr.status,
        code: "storage-upload-error"
      }));
    });

    xhr.addEventListener("error", () => {
      reject(new ApiError("La subida al almacenamiento se interrumpió.", { code: "storage-upload-error" }));
    });

    xhr.addEventListener("abort", () => {
      reject(new ApiError("La subida fue cancelada.", { code: "upload-aborted" }));
    });

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }

      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(file);
  });
}

const hopperApi = {
  hasConfiguredWorker() {
    return Boolean(String(appConfig.workerBaseUrl || "").trim());
  },

  hasSession() {
    return Boolean(tokenFor("personal"));
  },

  hasRoomSession() {
    return Boolean(tokenFor("room"));
  },

  getRoomSession() {
    return readSession(ROOM_SESSION_KEY);
  },

  getRememberedRoomCodes() {
    return readRoomCodes();
  },

  clearSession() {
    clearSession(SESSION_KEY);
  },

  clearRoomSession() {
    clearSession(ROOM_SESSION_KEY);
  },

  async securityStatus() {
    return request("/api/security/status");
  },

  async login(pin) {
    const result = await request("/api/auth/login", {
      method: "POST",
      body: { pin }
    });

    if (result?.ok && result?.token) {
      setSession(SESSION_KEY, result.token, result.expiresIn);
    }

    return result;
  },

  async requestRecovery() {
    return request("/api/recovery/request", { method: "POST", body: {} });
  },

  async verifyRecovery(token) {
    return request("/api/recovery/verify", { method: "POST", body: { token } });
  },

  async resetPin(token, pin, confirmation) {
    return request("/api/recovery/reset", {
      method: "POST",
      body: { token, pin, confirmation }
    });
  },

  async listItems() {
    return request("/api/items", { auth: "personal" });
  },

  async createText(content, ttlMinutes) {
    return request("/api/items/text", {
      method: "POST",
      auth: "personal",
      body: { content, ttlMinutes }
    });
  },

  async initializeUpload(file, ttlMinutes) {
    return request("/api/uploads/init", {
      method: "POST",
      auth: "personal",
      body: {
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        ttlMinutes
      }
    });
  },

  uploadToSignedUrl,

  async completeUpload(id) {
    return request(`/api/uploads/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      auth: "personal",
      body: {}
    });
  },

  async cancelUpload(id) {
    return request(`/api/uploads/${encodeURIComponent(id)}/cancel`, {
      method: "DELETE",
      auth: "personal"
    });
  },

  async getFileUrl(id, mode = "download") {
    const query = new URLSearchParams({ mode });
    return request(`/api/items/${encodeURIComponent(id)}/url?${query.toString()}`, { auth: "personal" });
  },

  async resetTtl(id, ttlMinutes) {
    return request(`/api/items/${encodeURIComponent(id)}/ttl`, {
      method: "PATCH",
      auth: "personal",
      body: { ttlMinutes }
    });
  },

  async deleteItem(id) {
    return request(`/api/items/${encodeURIComponent(id)}`, {
      method: "DELETE",
      auth: "personal"
    });
  },

  async roomCapacity() {
    return request("/api/rooms/capacity");
  },

  async createRoom() {
    const result = await request("/api/rooms", {
      method: "POST",
      body: {}
    });

    if (result?.room?.id && result?.code) {
      rememberRoomCode(result.room.id, result.code, result.room.expiresAt);
    }

    if (result?.token && result?.room?.id) {
      setSession(ROOM_SESSION_KEY, result.token, result.expiresIn, { roomId: result.room.id });
    }

    return result;
  },

  async listRooms() {
    return request("/api/rooms", { auth: "personal" });
  },

  async closeRoom(roomId) {
    const result = await request(`/api/rooms/${encodeURIComponent(roomId)}`, {
      method: "DELETE",
      auth: "personal"
    });
    forgetRoomCode(roomId);
    const session = readSession(ROOM_SESSION_KEY);

    if (session?.roomId === roomId) {
      clearSession(ROOM_SESSION_KEY);
    }

    return result;
  },

  async joinRoom(code) {
    const result = await request("/api/rooms/join", {
      method: "POST",
      body: { code }
    });

    if (result?.token && result?.room?.id) {
      setSession(ROOM_SESSION_KEY, result.token, result.expiresIn, { roomId: result.room.id });
      rememberRoomCode(result.room.id, String(code || "").trim().toUpperCase(), result.room.expiresAt);
    }

    return result;
  },

  async roomStatus() {
    return request("/api/room/status", { auth: "room" });
  },

  async roomActivity() {
    const result = await request("/api/room/activity", {
      method: "POST",
      auth: "room",
      body: {}
    });
    const session = readSession(ROOM_SESSION_KEY);
    const code = session?.roomId ? readRoomCodes()?.[session.roomId]?.code : "";

    if (code && result?.room?.id) {
      rememberRoomCode(result.room.id, code, result.room.expiresAt);
    }

    return result;
  },

  async roomListItems() {
    return request("/api/room/items", { auth: "room" });
  },

  async roomCreateText(content) {
    return request("/api/room/items/text", {
      method: "POST",
      auth: "room",
      body: { content, ttlMinutes: 5 }
    });
  },

  async roomInitializeUpload(file) {
    return request("/api/room/uploads/init", {
      method: "POST",
      auth: "room",
      body: {
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        ttlMinutes: 5
      }
    });
  },

  async roomCompleteUpload(id) {
    return request(`/api/room/uploads/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      auth: "room",
      body: {}
    });
  },

  async roomCancelUpload(id) {
    return request(`/api/room/uploads/${encodeURIComponent(id)}/cancel`, {
      method: "DELETE",
      auth: "room"
    });
  },

  async roomGetFileUrl(id, mode = "download") {
    const query = new URLSearchParams({ mode });
    return request(`/api/room/items/${encodeURIComponent(id)}/url?${query.toString()}`, { auth: "room" });
  },


  async roomDeleteItem(id) {
    return request(`/api/room/items/${encodeURIComponent(id)}`, {
      method: "DELETE",
      auth: "room"
    });
  },

  async adminUsage() {
    return request("/api/admin/usage", { auth: "personal" });
  },

  async adminHealth() {
    return request("/api/admin/health", { auth: "personal" });
  },

  async adminRooms() {
    return request("/api/admin/rooms", { auth: "personal" });
  },

  async adminOpenRoom(roomId) {
    const result = await request(`/api/admin/rooms/${encodeURIComponent(roomId)}/session`, {
      method: "POST",
      auth: "personal",
      body: {}
    });

    if (result?.token && result?.room?.id) {
      setSession(ROOM_SESSION_KEY, result.token, result.expiresIn, { roomId: result.room.id });
    }

    return result;
  },

  async adminReconcile() {
    return request("/api/admin/reconcile-storage", {
      method: "POST",
      auth: "personal",
      body: {}
    });
  },

  async adminCleanup() {
    return request("/api/admin/cleanup", {
      method: "POST",
      auth: "personal",
      body: {}
    });
  },

  async adminDeleteStatistics() {
    return request("/api/admin/statistics", {
      method: "DELETE",
      auth: "personal"
    });
  }
};

export { ApiError, hopperApi };
