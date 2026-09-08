import {
  MAX_FAILED_ATTEMPTS,
  SESSION_TTL_SECONDS
} from "./constants.js";
import {
  base64UrlDecodeBytes,
  base64UrlEncodeBytes,
  base64UrlEncodeText,
  randomBytes,
  sha256Bytes,
  timingSafeEqualBytes
} from "./crypto.js";
import { bearerToken, HttpError, normalizeText } from "./http.js";

async function importHmacKey(secret, namespace) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
  }

  const keyBytes = await sha256Bytes(`hopper-${namespace}-key-v1:${secret}`);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export function isValidPin(pin) {
  return /^\d{4}$/.test(normalizeText(pin));
}

async function derivePinHash(pin, salt, secret) {
  const key = await importHmacKey(secret, "pin");
  const payload = new TextEncoder().encode(`hopper-pin-v1:${salt}:${pin}`);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
}

async function createPinCredentialValues(pin, env) {
  const salt = base64UrlEncodeBytes(randomBytes(16));
  const pinHash = await derivePinHash(pin, salt, env.SESSION_SECRET);

  return {
    salt,
    pinHash: base64UrlEncodeBytes(pinHash),
    algorithm: "hmac-sha256-v1"
  };
}

export async function getPinCredentials(env) {
  const row = await env.DB.prepare(`
    SELECT salt, pin_hash AS pinHash, algorithm
    FROM pin_credentials
    WHERE id = 1
  `).first();

  if (!row) {
    throw new HttpError(503, "pin-not-configured", "Hopper todavía no tiene un PIN configurado.");
  }

  return row;
}

export async function verifyConfiguredPin(env, candidate) {
  const credentials = await getPinCredentials(env);

  if (credentials.algorithm !== "hmac-sha256-v1") {
    throw new Error("La configuración del PIN no es válida.");
  }

  let expectedHash;

  try {
    expectedHash = base64UrlDecodeBytes(String(credentials.pinHash || ""));
  } catch {
    throw new Error("La configuración del PIN no es válida.");
  }

  const candidateHash = await derivePinHash(
    candidate,
    String(credentials.salt || ""),
    env.SESSION_SECRET
  );

  return timingSafeEqualBytes(candidateHash, expectedHash);
}

export async function writePinCredentials(db, pin, env) {
  if (!isValidPin(pin)) {
    throw new HttpError(400, "invalid-pin-format", "El PIN debe tener exactamente 4 dígitos numéricos.");
  }

  const credentials = await createPinCredentialValues(pin, env);
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO pin_credentials (id, salt, pin_hash, algorithm, updated_at)
    VALUES (1, ?1, ?2, ?3, ?4)
    ON CONFLICT(id) DO UPDATE SET
      salt = excluded.salt,
      pin_hash = excluded.pin_hash,
      algorithm = excluded.algorithm,
      updated_at = excluded.updated_at
  `).bind(
    credentials.salt,
    credentials.pinHash,
    credentials.algorithm,
    now
  ).run();
}

async function signSessionBody(body, secret) {
  const key = await importHmacKey(secret, "session");
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`hopper-session-v1:${body}`)
    )
  );
  return base64UrlEncodeBytes(signature);
}

export async function createSessionToken(secret, sessionVersion, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
    ver: Number(sessionVersion),
    nonce: base64UrlEncodeBytes(randomBytes(12))
  };
  const body = base64UrlEncodeText(JSON.stringify(payload));
  const signature = await signSessionBody(body, secret);
  return `${body}.${signature}`;
}

export async function verifySessionToken(token, secret, now = Date.now()) {
  const [body, signature, extra] = String(token || "").split(".");

  if (!body || !signature || extra !== undefined) {
    return null;
  }

  let expected;
  let candidate;
  let payload;

  try {
    expected = base64UrlDecodeBytes(await signSessionBody(body, secret));
    candidate = base64UrlDecodeBytes(signature);
    const json = new TextDecoder().decode(base64UrlDecodeBytes(body));
    payload = JSON.parse(json);
  } catch {
    return null;
  }

  if (!timingSafeEqualBytes(expected, candidate)) {
    return null;
  }

  const nowSeconds = Math.floor(now / 1000);

  if (
    !Number.isInteger(payload?.iat)
    || !Number.isInteger(payload?.exp)
    || !Number.isInteger(payload?.ver)
    || payload.exp <= nowSeconds
    || payload.iat > nowSeconds + 60
    || payload.exp - payload.iat > SESSION_TTL_SECONDS + 5
  ) {
    return null;
  }

  return payload;
}

export async function getSecurityState(db) {
  const row = await db.prepare(`
    SELECT
      failed_attempts AS failedAttempts,
      locked,
      locked_at AS lockedAt,
      last_failed_at AS lastFailedAt,
      last_success_at AS lastSuccessAt
    FROM security_state
    WHERE id = 1
  `).first();

  if (!row) {
    throw new Error("La base D1 no está inicializada. Ejecuta cloudflare/schema.sql.");
  }

  return {
    failedAttempts: Number(row.failedAttempts) || 0,
    locked: Number(row.locked) === 1,
    lockedAt: row.lockedAt || null,
    lastFailedAt: row.lastFailedAt || null,
    lastSuccessAt: row.lastSuccessAt || null
  };
}

export async function getSessionVersion(db) {
  const row = await db.prepare(`
    SELECT version
    FROM session_state
    WHERE id = 1
  `).first();

  if (!row) {
    throw new Error("La base D1 no está inicializada. Ejecuta cloudflare/schema.sql.");
  }

  return Number(row.version) || 1;
}

export async function logSecurityEvent(db, type, client, details = {}) {
  const payload = {
    ip: client?.ip || "",
    country: client?.country || "",
    userAgent: client?.userAgent || "",
    ...details
  };

  await db.prepare(`
    INSERT INTO security_events (type, created_at, details)
    VALUES (?1, ?2, ?3)
  `).bind(type, new Date().toISOString(), JSON.stringify(payload)).run();
}

function parseIpv4(value) {
  const parts = String(value || "").split(".");

  if (parts.length !== 4) {
    return null;
  }

  const numbers = parts.map((part) => Number(part));

  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return (((numbers[0] * 256 + numbers[1]) * 256 + numbers[2]) * 256) + numbers[3];
}

export function ipv4MatchesCidr(ip, cidr) {
  const [network, prefixText, extra] = String(cidr || "").split("/");
  const prefix = Number(prefixText);
  const ipValue = parseIpv4(ip);
  const networkValue = parseIpv4(network);

  if (
    extra !== undefined
    || ipValue === null
    || networkValue === null
    || !Number.isInteger(prefix)
    || prefix < 0
    || prefix > 32
  ) {
    return false;
  }

  if (prefix === 0) {
    return true;
  }

  const divisor = 2 ** (32 - prefix);
  return Math.floor(ipValue / divisor) === Math.floor(networkValue / divisor);
}

export async function isClientBlocked(db, ip) {
  if (!ip) {
    return false;
  }

  const result = await db.prepare(`
    SELECT target, kind
    FROM blocked_clients
    ORDER BY id ASC
  `).all();
  const rows = Array.isArray(result?.results) ? result.results : [];

  return rows.some((row) => {
    const target = normalizeText(row?.target);
    const kind = normalizeText(row?.kind);

    if (kind === "ip") {
      return target === ip;
    }

    if (kind === "cidr") {
      return ipv4MatchesCidr(ip, target);
    }

    return false;
  });
}

export async function ensureClientAllowed(db, client) {
  if (await isClientBlocked(db, client.ip)) {
    await logSecurityEvent(db, "blocked-client-request", client);
    throw new HttpError(403, "client-blocked", "Acceso denegado.");
  }
}

async function rateLimitKey(scope, client) {
  const ip = client?.ip || "unknown";
  const digest = await sha256Bytes(ip);
  return `${scope}:${base64UrlEncodeBytes(digest).slice(0, 32)}`;
}

export async function enforceRateLimit(db, client, scope, limit, windowSeconds) {
  const key = await rateLimitKey(scope, client);
  const now = Date.now();
  const row = await db.prepare(`
    SELECT window_started_at AS windowStartedAt, count
    FROM rate_limits
    WHERE key = ?1
  `).bind(key).first();
  const startedAt = row?.windowStartedAt ? Date.parse(row.windowStartedAt) : NaN;
  const windowExpired = !Number.isFinite(startedAt) || startedAt + windowSeconds * 1000 <= now;
  const count = windowExpired ? 1 : Number(row?.count || 0) + 1;
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + windowSeconds * 1000).toISOString();

  await db.prepare(`
    INSERT INTO rate_limits (key, window_started_at, count, expires_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(key) DO UPDATE SET
      window_started_at = excluded.window_started_at,
      count = excluded.count,
      expires_at = excluded.expires_at
  `).bind(
    key,
    windowExpired ? nowIso : row.windowStartedAt,
    count,
    expiresAt
  ).run();

  if (count > limit) {
    throw new HttpError(429, "rate-limit", "Demasiadas solicitudes. Intenta de nuevo en unos minutos.");
  }
}

export async function cleanupRateLimits(db) {
  await db.prepare(`
    DELETE FROM rate_limits
    WHERE expires_at <= ?1
  `).bind(new Date().toISOString()).run();
}

export async function registerFailedAttempt(db, client) {
  const now = new Date().toISOString();
  const clientDetails = JSON.stringify(client);
  const results = await db.batch([
    db.prepare(`
      UPDATE security_state
      SET
        failed_attempts = CASE
          WHEN failed_attempts < ?1 THEN failed_attempts + 1
          ELSE failed_attempts
        END,
        locked = CASE
          WHEN failed_attempts + 1 >= ?1 THEN 1
          ELSE locked
        END,
        last_failed_at = ?2,
        locked_at = CASE
          WHEN locked = 0 AND failed_attempts + 1 >= ?1 THEN ?2
          ELSE locked_at
        END,
        updated_at = ?2
      WHERE id = 1 AND locked = 0
    `).bind(MAX_FAILED_ATTEMPTS, now),
    db.prepare(`
      INSERT INTO security_events (type, created_at, details)
      VALUES ('pin-failed', ?1, ?2)
    `).bind(now, clientDetails),
    db.prepare(`
      INSERT INTO security_events (type, created_at, details)
      SELECT 'pin-lockout', ?1, ?2
      FROM security_state
      WHERE id = 1 AND locked = 1 AND lock_event_recorded = 0
    `).bind(now, clientDetails),
    db.prepare(`
      UPDATE session_state
      SET version = version + 1, updated_at = ?1
      WHERE id = 1
        AND EXISTS (
          SELECT 1 FROM security_state
          WHERE id = 1 AND locked = 1 AND lock_event_recorded = 0
        )
    `).bind(now),
    db.prepare(`
      UPDATE security_state
      SET lock_event_recorded = 1
      WHERE id = 1 AND locked = 1 AND lock_event_recorded = 0
    `),
    db.prepare(`
      SELECT failed_attempts AS failedAttempts, locked, locked_at AS lockedAt
      FROM security_state
      WHERE id = 1
    `)
  ]);

  const row = results[5]?.results?.[0];

  if (!row) {
    throw new Error("No fue posible leer el estado de seguridad.");
  }

  const failedAttempts = Number(row.failedAttempts) || 0;
  const locked = Number(row.locked) === 1;

  return {
    failedAttempts,
    locked,
    newlyLocked: Number(results[2]?.meta?.changes || 0) === 1,
    remainingAttempts: Math.max(MAX_FAILED_ATTEMPTS - failedAttempts, 0),
    lockedAt: row.lockedAt || null
  };
}

export async function registerSuccessfulPin(db, client) {
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`
      UPDATE security_state
      SET failed_attempts = 0, last_success_at = ?1, updated_at = ?1
      WHERE id = 1 AND locked = 0
    `).bind(now),
    db.prepare(`
      INSERT INTO security_events (type, created_at, details)
      VALUES ('pin-success', ?1, ?2)
    `).bind(now, JSON.stringify(client)),
    db.prepare(`
      SELECT failed_attempts AS failedAttempts, locked
      FROM security_state
      WHERE id = 1
    `)
  ]);
  const row = results[2]?.results?.[0];

  if (!row) {
    throw new Error("No fue posible leer el estado de seguridad.");
  }

  return {
    failedAttempts: Number(row.failedAttempts) || 0,
    locked: Number(row.locked) === 1
  };
}

export async function resetSecurityState(db, client, eventType) {
  const now = new Date().toISOString();

  await db.batch([
    db.prepare(`
      UPDATE security_state
      SET
        failed_attempts = 0,
        locked = 0,
        lock_event_recorded = 0,
        locked_at = NULL,
        last_success_at = ?1,
        updated_at = ?1
      WHERE id = 1
    `).bind(now),
    db.prepare(`
      UPDATE session_state
      SET version = version + 1, updated_at = ?1
      WHERE id = 1
    `).bind(now),
    db.prepare(`
      UPDATE recovery_tokens
      SET used_at = COALESCE(used_at, ?1)
      WHERE used_at IS NULL
    `).bind(now)
  ]);

  await logSecurityEvent(db, eventType, client);
}

export async function hasValidAdminCliToken(request, env) {
  const expected = normalizeText(env.ADMIN_CLI_TOKEN);
  const candidate = bearerToken(request);

  if (expected.length < 32 || candidate.length < 32) {
    return false;
  }

  const [expectedHash, candidateHash] = await Promise.all([
    sha256Bytes(expected),
    sha256Bytes(candidate)
  ]);

  return timingSafeEqualBytes(expectedHash, candidateHash);
}

export async function requireAuthorizedRequest(request, env, client) {
  await ensureClientAllowed(env.DB, client);
  await enforceRateLimit(env.DB, client, "api", 180, 60);

  const token = bearerToken(request);
  const session = await verifySessionToken(token, env.SESSION_SECRET);
  const sessionVersion = await getSessionVersion(env.DB);

  if (!session || session.ver !== sessionVersion) {
    throw new HttpError(401, "invalid-session", "La sesión venció o ya no es válida.");
  }

  const state = await getSecurityState(env.DB);

  if (state.locked) {
    throw new HttpError(423, "locked", "Hopper está bloqueado.");
  }

  return session;
}
