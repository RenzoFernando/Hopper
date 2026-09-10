import {
  RECOVERY_COOLDOWN_SECONDS,
  RECOVERY_TTL_SECONDS
} from "./constants.js";
import {
  base64UrlEncodeBytes,
  randomBytes,
  sha256Bytes
} from "./crypto.js";
import { HttpError, normalizeText } from "./http.js";
import {
  getSecurityState,
  isValidPin,
  logSecurityEvent,
  resetSecurityState,
  writePinCredentials
} from "./security.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resolvePublicAppUrl(env) {
  const candidate = normalizeText(env.PUBLIC_APP_URL);

  if (!candidate) {
    throw new HttpError(503, "public-url-not-configured", "La URL pública de Hopper no está configurada.");
  }

  try {
    const url = new URL(candidate);

    if (
      url.protocol !== "https:"
      && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      throw new Error("invalid-public-url");
    }

    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  } catch {
    throw new HttpError(503, "public-url-not-configured", "La URL pública de Hopper no es válida.");
  }
}

export function buildRecoveryUrl(env, token) {
  const cleanFrontendUrls = normalizeText(env.CLEAN_FRONTEND_URLS).toLowerCase() === "true";
  const url = new URL(cleanFrontendUrls ? "recover" : "recover.html", resolvePublicAppUrl(env));
  url.hash = cleanFrontendUrls ? token : `token=${encodeURIComponent(token)}`;
  return url.toString();
}

export function validateRecoveryToken(value) {
  const token = normalizeText(value);

  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new HttpError(400, "invalid-recovery-token", "El enlace de recuperación no es válido.");
  }

  return token;
}

async function recoveryTokenHash(token) {
  return base64UrlEncodeBytes(await sha256Bytes(token));
}

async function getRecoveryRecord(db, token) {
  const tokenHash = await recoveryTokenHash(token);
  const row = await db.prepare(`
    SELECT
      id,
      token_hash AS tokenHash,
      created_at AS createdAt,
      expires_at AS expiresAt,
      used_at AS usedAt,
      requested_ip AS requestedIp,
      used_ip AS usedIp
    FROM recovery_tokens
    WHERE token_hash = ?1
  `).bind(tokenHash).first();

  return row || null;
}

export function recoveryRecordStatus(record, now = Date.now()) {
  if (!record) {
    return "invalid";
  }

  if (record.usedAt) {
    return "used";
  }

  const expiresAt = Date.parse(record.expiresAt || "");

  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return "expired";
  }

  return "valid";
}

async function sendRecoveryEmail(env, recoveryUrl, client, tokenId) {
  const apiKey = normalizeText(env.RESEND_API_KEY);
  const recipient = normalizeText(env.RECOVERY_EMAIL);
  const sender = normalizeText(env.RESEND_FROM_EMAIL) || "Hopper <onboarding@resend.dev>";

  if (!apiKey || !recipient) {
    throw new HttpError(503, "recovery-not-configured", "La recuperación por correo no está configurada.");
  }

  const occurredAt = new Date().toISOString();
  const ipLine = client.ip ? `<p><strong>IP:</strong> ${escapeHtml(client.ip)}</p>` : "";
  const countryLine = client.country ? `<p><strong>País:</strong> ${escapeHtml(client.country)}</p>` : "";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `hopper-recovery-${tokenId}`
    },
    body: JSON.stringify({
      from: sender,
      to: [recipient],
      subject: "Hopper — recuperación de acceso",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#202123">
          <h2>Hopper bloqueado</h2>
          <p>Hopper fue bloqueado después de cinco intentos de PIN incorrectos.</p>
          <p><strong>Fecha:</strong> ${escapeHtml(occurredAt)}</p>
          ${ipLine}
          ${countryLine}
          <p>Usa el siguiente enlace para establecer un PIN nuevo y desbloquear la aplicación.</p>
          <p><a href="${escapeHtml(recoveryUrl)}">Recuperar acceso</a></p>
          <p>El enlace expira en 15 minutos y solo puede utilizarse una vez.</p>
        </div>
      `
    })
  });

  if (!response.ok) {
    let details = "";

    try {
      details = await response.text();
    } catch {
      details = "";
    }

    console.error("Resend no pudo enviar la recuperación.", response.status, details.slice(0, 500));
    throw new HttpError(502, "recovery-email-failed", "No fue posible enviar el enlace de recuperación.");
  }
}

export async function issueRecovery(env, client, { enforceCooldown = true } = {}) {
  const state = await getSecurityState(env.DB);

  if (!state.locked) {
    throw new HttpError(409, "not-locked", "Hopper no está bloqueado.");
  }

  if (enforceCooldown) {
    const latest = await env.DB.prepare(`
      SELECT created_at AS createdAt
      FROM recovery_tokens
      ORDER BY created_at DESC
      LIMIT 1
    `).first();
    const latestAt = latest?.createdAt ? Date.parse(latest.createdAt) : NaN;

    if (Number.isFinite(latestAt) && Date.now() - latestAt < RECOVERY_COOLDOWN_SECONDS * 1000) {
      return { ok: true, status: "sent" };
    }
  }

  const token = base64UrlEncodeBytes(randomBytes(32));
  const tokenHash = await recoveryTokenHash(token);
  const tokenId = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + RECOVERY_TTL_SECONDS * 1000).toISOString();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE recovery_tokens
      SET used_at = ?1
      WHERE used_at IS NULL
    `).bind(createdAt),
    env.DB.prepare(`
      INSERT INTO recovery_tokens (
        id, token_hash, created_at, expires_at, requested_ip
      ) VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(tokenId, tokenHash, createdAt, expiresAt, client.ip || null)
  ]);

  const recoveryUrl = buildRecoveryUrl(env, token);

  try {
    await sendRecoveryEmail(env, recoveryUrl, client, tokenId);
  } catch (error) {
    await env.DB.prepare(`DELETE FROM recovery_tokens WHERE id = ?1`).bind(tokenId).run();
    await logSecurityEvent(env.DB, "recovery-email-failed", client, { tokenId });
    throw error;
  }

  await logSecurityEvent(env.DB, "recovery-email-sent", client, { tokenId });
  return { ok: true, status: "sent" };
}

export async function verifyRecoveryToken(env, token, client) {
  const normalizedToken = validateRecoveryToken(token);
  const record = await getRecoveryRecord(env.DB, normalizedToken);
  const status = recoveryRecordStatus(record);
  await logSecurityEvent(env.DB, "recovery-token-check", client, { status });

  return { ok: status === "valid", status };
}

export async function resetPinWithRecovery(env, token, pin, confirmation, client) {
  const normalizedToken = validateRecoveryToken(token);
  const normalizedPin = normalizeText(pin);
  const normalizedConfirmation = normalizeText(confirmation);

  if (!isValidPin(normalizedPin)) {
    throw new HttpError(400, "invalid-pin-format", "El PIN debe tener exactamente 4 dígitos numéricos.");
  }

  if (normalizedPin !== normalizedConfirmation) {
    throw new HttpError(400, "pin-mismatch", "Los PIN no coinciden.");
  }

  const record = await getRecoveryRecord(env.DB, normalizedToken);
  const status = recoveryRecordStatus(record);

  if (status !== "valid") {
    return { ok: false, status };
  }

  const tokenHash = await recoveryTokenHash(normalizedToken);
  const now = new Date().toISOString();
  const claim = await env.DB.prepare(`
    UPDATE recovery_tokens
    SET used_at = ?1, used_ip = ?2
    WHERE token_hash = ?3
      AND used_at IS NULL
      AND expires_at > ?1
  `).bind(now, client.ip || null, tokenHash).run();

  if (Number(claim?.meta?.changes || 0) !== 1) {
    const currentRecord = await getRecoveryRecord(env.DB, normalizedToken);
    return { ok: false, status: recoveryRecordStatus(currentRecord) };
  }

  await writePinCredentials(env.DB, normalizedPin, env);
  await resetSecurityState(env.DB, client, "recovery-success");

  return { ok: true, status: "updated" };
}
