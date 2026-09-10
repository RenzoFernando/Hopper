import type { ClientInfo, Env } from "../types/env.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});

export function jsonResponse(
  body: unknown,
  status: number = 200,
  origin: string = "",
  extraHeaders: Record<string, string> = {}
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...SECURITY_HEADERS,
    ...extraHeaders
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
    headers.Vary = "Origin";
  }

  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function resolveCorsOrigin(request: Request, env: Env): string {
  const origin = request.headers.get("Origin") || "";

  if (!origin) {
    return "";
  }

  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowedOrigins.includes(origin)) {
    return origin;
  }

  if (
    env.ALLOW_LOCALHOST === "true"
    && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
  ) {
    return origin;
  }

  throw new HttpError(403, "origin-not-allowed", "Origen no permitido.");
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "invalid-content-type", "La solicitud debe usar application/json.");
  }

  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "invalid-json", "El cuerpo JSON no es válido.");
  }
}

export function getClientInfo(request: Request): ClientInfo {
  return {
    ip: normalizeText(request.headers.get("CF-Connecting-IP")),
    country: normalizeText(request.headers.get("CF-IPCountry")),
    userAgent: normalizeText(request.headers.get("User-Agent")).slice(0, 220)
  };
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}
