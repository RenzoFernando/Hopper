export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonResponse(body, status = 200, origin = "", extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
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

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function resolveCorsOrigin(request, env) {
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

export async function readJson(request) {
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

export function getClientInfo(request) {
  return {
    ip: normalizeText(request.headers.get("CF-Connecting-IP")),
    country: normalizeText(request.headers.get("CF-IPCountry")),
    userAgent: normalizeText(request.headers.get("User-Agent")).slice(0, 220)
  };
}

export function bearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}
