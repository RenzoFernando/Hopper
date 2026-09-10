import type { ZodType } from "zod";
import { appConfig } from "../lib/config";

const SESSION_KEY = "hopper-session-v1";
const ROOM_SESSION_KEY = "hopper-room-session-v1";
const ROOM_CODES_KEY = "hopper-room-codes-v1";

type AuthScope = "" | "personal" | "room";
type StoredSession = { token: string; expiresAt: number; roomId?: string };
type RoomCodeEntry = { code: string; expiresAt: number };
type RoomCodeStore = Record<string, RoomCodeEntry>;

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: AuthScope;
};

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, { status = 0, code = "network-error" }: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "ApiError";
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

function readSession(key: string): StoredSession | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || "null") as Partial<StoredSession> | null;
    if (!parsed?.token || !Number.isFinite(parsed.expiresAt) || Number(parsed.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(key);
      return null;
    }
    return {
      token: parsed.token,
      expiresAt: Number(parsed.expiresAt),
      ...(parsed.roomId ? { roomId: String(parsed.roomId) } : {})
    };
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

function setSession(key: string, token: string, expiresInSeconds: number, extra: { roomId?: string } = {}) {
  const expiresAt = Date.now() + Math.max(1, Number(expiresInSeconds) || 0) * 1000;
  sessionStorage.setItem(key, JSON.stringify({ token, expiresAt, ...extra }));
}

function clearSession(key: string) {
  sessionStorage.removeItem(key);
}

function readRoomCodes(): RoomCodeStore {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ROOM_CODES_KEY) || "{}") as Record<string, Partial<RoomCodeEntry>>;
    const now = Date.now();
    const filtered: RoomCodeStore = {};
    for (const [roomId, value] of Object.entries(parsed || {})) {
      if (value?.code && Number(value.expiresAt || 0) > now) {
        filtered[roomId] = { code: String(value.code), expiresAt: Number(value.expiresAt) };
      }
    }
    sessionStorage.setItem(ROOM_CODES_KEY, JSON.stringify(filtered));
    return filtered;
  } catch {
    sessionStorage.removeItem(ROOM_CODES_KEY);
    return {};
  }
}

export function rememberRoomCode(roomId: string, code: string, expiresAt: string) {
  if (!roomId || !code) return;
  const codes = readRoomCodes();
  codes[roomId] = { code, expiresAt: Date.parse(expiresAt || "") || Date.now() + 3_600_000 };
  sessionStorage.setItem(ROOM_CODES_KEY, JSON.stringify(codes));
}

export function forgetRoomCode(roomId: string) {
  const codes = readRoomCodes();
  delete codes[roomId];
  sessionStorage.setItem(ROOM_CODES_KEY, JSON.stringify(codes));
}

function tokenFor(auth: AuthScope) {
  if (auth === "personal") return readSession(SESSION_KEY)?.token || "";
  if (auth === "room") return readSession(ROOM_SESSION_KEY)?.token || "";
  return "";
}

function errorPayload(value: unknown) {
  if (!value || typeof value !== "object") return { message: "", code: "" };
  const payload = value as Record<string, unknown>;
  return {
    message: typeof payload.message === "string" ? payload.message : "",
    code: typeof payload.code === "string" ? payload.code : ""
  };
}

export async function request<T>(path: string, schema: ZodType<T>, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = "" } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
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

  let response: Response;
  try {
    const init: RequestInit = {
      method,
      headers,
      cache: "no-store",
      credentials: "omit"
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    response = await fetch(`${apiRoot()}${path}`, init);
  } catch {
    throw new ApiError("No fue posible conectar con Hopper.", { code: "network-error" });
  }

  let payload: unknown;
  try {
    payload = response.status === 204 ? { ok: true } : await response.json();
  } catch {
    payload = null;
  }

  const failure = errorPayload(payload);
  const explicitFailure = Boolean(payload && typeof payload === "object" && (payload as Record<string, unknown>).ok === false && response.status >= 400);
  if (!response.ok || explicitFailure) {
    if (response.status === 401 && auth === "personal") {
      clearSession(SESSION_KEY);
      window.dispatchEvent(new CustomEvent("hopper:session-expired"));
    }
    if (response.status === 401 && auth === "room") {
      clearSession(ROOM_SESSION_KEY);
      window.dispatchEvent(new CustomEvent("hopper:room-session-expired"));
    }
    throw new ApiError(failure.message || "Hopper no pudo completar la solicitud.", {
      status: response.status,
      code: failure.code || "api-error"
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError("Hopper devolvió una respuesta inesperada.", { status: response.status, code: "invalid-api-response" });
  }
  return parsed.data;
}

export function uploadToSignedUrl(
  file: File,
  uploadUrl: string,
  onProgress?: (progress: number) => void,
  contentType = "",
  signal?: AbortSignal
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      reject(new ApiError(`El almacenamiento rechazó la subida (${xhr.status}).`, { status: xhr.status, code: "storage-upload-error" }));
    });
    xhr.addEventListener("error", () => reject(new ApiError("La subida al almacenamiento se interrumpió.", { code: "storage-upload-error" })));
    xhr.addEventListener("abort", () => reject(new ApiError("La subida fue cancelada.", { code: "upload-aborted" })));
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

export const sessionStore = {
  hasConfiguredWorker: () => Boolean(String(appConfig.workerBaseUrl || "").trim()),
  hasPersonal: () => Boolean(tokenFor("personal")),
  hasRoom: () => Boolean(tokenFor("room")),
  getRoom: () => readSession(ROOM_SESSION_KEY),
  getRoomCodes: () => readRoomCodes(),
  setPersonal: (token: string, expiresIn: number) => setSession(SESSION_KEY, token, expiresIn),
  setRoom: (token: string, expiresIn: number, roomId: string) => setSession(ROOM_SESSION_KEY, token, expiresIn, { roomId }),
  clearPersonal: () => clearSession(SESSION_KEY),
  clearRoom: () => clearSession(ROOM_SESSION_KEY)
};
