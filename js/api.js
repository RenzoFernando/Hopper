import { appConfig } from "./config.js";

const SESSION_KEY = "hopper-session-v1";

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

function readStoredSession() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");

    if (!parsed?.token || !Number.isFinite(parsed?.expiresAt) || parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }

    return parsed;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function getSessionToken() {
  return readStoredSession()?.token || "";
}

function setSession(token, expiresInSeconds) {
  const expiresAt = Date.now() + Math.max(1, Number(expiresInSeconds) || 0) * 1000;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

async function request(path, {
  method = "GET",
  body,
  auth = false
} = {}) {
  const headers = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    const token = getSessionToken();

    if (!token) {
      throw new ApiError("La sesión venció. Ingresa de nuevo.", {
        status: 401,
        code: "invalid-session"
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

    if (response.status === 401 && auth) {
      clearSession();
      window.dispatchEvent(new CustomEvent("hopper:session-expired"));
    }

    throw error;
  }

  return payload;
}

function uploadToSignedUrl(file, uploadUrl, onProgress, contentType = "") {
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

      reject(new ApiError(`R2 rechazó la subida (${xhr.status}).`, {
        status: xhr.status,
        code: "storage-upload-error"
      }));
    });

    xhr.addEventListener("error", () => {
      reject(new ApiError("La subida a R2 se interrumpió.", { code: "storage-upload-error" }));
    });

    xhr.addEventListener("abort", () => {
      reject(new ApiError("La subida fue cancelada.", { code: "upload-aborted" }));
    });

    xhr.send(file);
  });
}

const hopperApi = {
  hasConfiguredWorker() {
    return Boolean(String(appConfig.workerBaseUrl || "").trim());
  },

  hasSession() {
    return Boolean(getSessionToken());
  },

  clearSession,

  async securityStatus() {
    return request("/api/security/status");
  },

  async login(pin) {
    const result = await request("/api/auth/login", {
      method: "POST",
      body: { pin }
    });

    if (result?.ok && result?.token) {
      setSession(result.token, result.expiresIn);
    }

    return result;
  },

  async requestRecovery() {
    return request("/api/recovery/request", {
      method: "POST",
      body: {}
    });
  },

  async verifyRecovery(token) {
    return request("/api/recovery/verify", {
      method: "POST",
      body: { token }
    });
  },

  async resetPin(token, pin, confirmation) {
    return request("/api/recovery/reset", {
      method: "POST",
      body: { token, pin, confirmation }
    });
  },

  async listItems() {
    return request("/api/items", { auth: true });
  },

  async createText(content, ttlMinutes) {
    return request("/api/items/text", {
      method: "POST",
      auth: true,
      body: { content, ttlMinutes }
    });
  },

  async initializeUpload(file, ttlMinutes) {
    return request("/api/uploads/init", {
      method: "POST",
      auth: true,
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
      auth: true,
      body: {}
    });
  },

  async cancelUpload(id) {
    return request(`/api/uploads/${encodeURIComponent(id)}/cancel`, {
      method: "DELETE",
      auth: true
    });
  },

  async getFileUrl(id, mode = "download") {
    const query = new URLSearchParams({ mode });
    return request(`/api/items/${encodeURIComponent(id)}/url?${query.toString()}`, { auth: true });
  },

  async resetTtl(id, ttlMinutes) {
    return request(`/api/items/${encodeURIComponent(id)}/ttl`, {
      method: "PATCH",
      auth: true,
      body: { ttlMinutes }
    });
  },

  async deleteItem(id) {
    return request(`/api/items/${encodeURIComponent(id)}`, {
      method: "DELETE",
      auth: true
    });
  }
};

export { ApiError, hopperApi };
