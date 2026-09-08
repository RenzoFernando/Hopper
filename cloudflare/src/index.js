import { MAX_FAILED_ATTEMPTS, SESSION_TTL_SECONDS } from "./constants.js";
import { checkB2Access } from "./b2.js";
import {
  cancelFileUpload,
  cleanupExpiredItems,
  completeFileUpload,
  createItemDownloadUrl,
  createTextItem,
  deleteItem,
  initializeFileUpload,
  listActiveItems,
  resetItemTtl
} from "./items.js";
import {
  getClientInfo,
  HttpError,
  jsonResponse,
  normalizeText,
  readJson,
  resolveCorsOrigin
} from "./http.js";
import {
  createSessionToken,
  cleanupRateLimits,
  enforceRateLimit,
  ensureClientAllowed,
  getSecurityState,
  getSessionVersion,
  hasValidAdminCliToken,
  isValidPin,
  logSecurityEvent,
  registerFailedAttempt,
  registerSuccessfulPin,
  requireAuthorizedRequest,
  resetSecurityState,
  verifyConfiguredPin,
  writePinCredentials
} from "./security.js";
import {
  issueRecovery,
  resetPinWithRecovery,
  verifyRecoveryToken
} from "./recovery.js";

async function handleSecurityStatus(request, env, origin) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);
  await enforceRateLimit(env.DB, client, "status", 60, 60);
  const state = await getSecurityState(env.DB);

  return jsonResponse({
    ok: true,
    locked: state.locked,
    remainingAttempts: Math.max(MAX_FAILED_ATTEMPTS - state.failedAttempts, 0)
  }, 200, origin);
}

async function handleLogin(request, env, origin) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);
  await enforceRateLimit(env.DB, client, "login", 12, 60);
  const body = await readJson(request);
  const pin = normalizeText(body?.pin);

  if (!isValidPin(pin)) {
    throw new HttpError(400, "invalid-pin-format", "El PIN debe tener exactamente 4 dígitos numéricos.");
  }

  const initialState = await getSecurityState(env.DB);

  if (initialState.locked) {
    await logSecurityEvent(env.DB, "pin-attempt-while-locked", client);
    return jsonResponse({
      ok: false,
      status: "locked",
      remainingAttempts: 0
    }, 200, origin);
  }

  if (!(await verifyConfiguredPin(env, pin))) {
    const state = await registerFailedAttempt(env.DB, client);

    if (state.newlyLocked) {
      try {
        await issueRecovery(env, client, { enforceCooldown: false });
      } catch (error) {
        console.error("Hopper quedó bloqueado y no fue posible enviar la recuperación automática.", error);
      }
    }

    return jsonResponse({
      ok: false,
      status: state.locked ? "locked" : "invalid-pin",
      remainingAttempts: state.remainingAttempts
    }, 200, origin);
  }

  const state = await registerSuccessfulPin(env.DB, client);

  if (state.locked) {
    return jsonResponse({
      ok: false,
      status: "locked",
      remainingAttempts: 0
    }, 200, origin);
  }

  const sessionVersion = await getSessionVersion(env.DB);
  const token = await createSessionToken(env.SESSION_SECRET, sessionVersion);

  return jsonResponse({
    ok: true,
    status: "authorized",
    remainingAttempts: MAX_FAILED_ATTEMPTS,
    token,
    expiresIn: SESSION_TTL_SECONDS
  }, 200, origin);
}

async function handleRecoveryRequest(request, env, origin) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);
  await enforceRateLimit(env.DB, client, "recovery", 4, 60 * 60);
  await readJson(request);
  const result = await issueRecovery(env, client);
  return jsonResponse(result, 200, origin);
}

async function handleRecoveryVerify(request, env, origin) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);
  await enforceRateLimit(env.DB, client, "recovery-verify", 20, 60);
  const body = await readJson(request);
  const result = await verifyRecoveryToken(env, body?.token, client);
  return jsonResponse(result, 200, origin);
}

async function handleRecoveryReset(request, env, origin) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);
  await enforceRateLimit(env.DB, client, "recovery-reset", 10, 60);
  const body = await readJson(request);
  const result = await resetPinWithRecovery(
    env,
    body?.token,
    body?.pin,
    body?.confirmation,
    client
  );
  return jsonResponse(result, 200, origin);
}

async function authorize(request, env) {
  const client = getClientInfo(request);
  await requireAuthorizedRequest(request, env, client);
  return client;
}

async function handleItemsList(request, env, origin) {
  await authorize(request, env);
  const items = await listActiveItems(env);
  return jsonResponse({ ok: true, items, serverTime: new Date().toISOString() }, 200, origin);
}

async function handleTextCreate(request, env, origin) {
  await authorize(request, env);
  const body = await readJson(request);
  const item = await createTextItem(env, body);
  return jsonResponse({ ok: true, item }, 201, origin);
}

async function handleUploadInit(request, env, origin) {
  await authorize(request, env);
  const body = await readJson(request);
  const upload = await initializeFileUpload(env, body);
  return jsonResponse({ ok: true, upload }, 201, origin);
}

async function handleUploadComplete(request, env, origin, id) {
  await authorize(request, env);
  await readJson(request);
  const item = await completeFileUpload(env, id);
  return jsonResponse({ ok: true, item }, 200, origin);
}

async function handleUploadCancel(request, env, origin, id) {
  await authorize(request, env);
  await cancelFileUpload(env, id);
  return jsonResponse({ ok: true }, 200, origin);
}

async function handleDownloadUrl(request, env, origin, id, url) {
  await authorize(request, env);
  const mode = url.searchParams.get("mode") === "preview" ? "preview" : "download";
  const result = await createItemDownloadUrl(env, id, mode);
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function handleTtlReset(request, env, origin, id) {
  await authorize(request, env);
  const body = await readJson(request);
  const item = await resetItemTtl(env, id, body?.ttlMinutes);
  return jsonResponse({ ok: true, item }, 200, origin);
}

async function handleItemDelete(request, env, origin, id) {
  await authorize(request, env);
  await deleteItem(env, id);
  return jsonResponse({ ok: true }, 200, origin);
}

async function requireAdmin(request, env) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);

  if (normalizeText(env.ADMIN_CLI_TOKEN).length < 32) {
    throw new HttpError(404, "not-found", "Ruta no encontrada.");
  }

  if (!(await hasValidAdminCliToken(request, env))) {
    await logSecurityEvent(env.DB, "admin-cli-denied", client);
    throw new HttpError(401, "admin-cli-unauthorized", "Autorización administrativa no válida.");
  }

  return client;
}

async function handleAdminChangePin(request, env, origin) {
  const client = await requireAdmin(request, env);
  const body = await readJson(request);
  const pin = normalizeText(body?.pin);
  const confirmation = normalizeText(body?.confirmation);

  if (!isValidPin(pin)) {
    throw new HttpError(400, "invalid-pin-format", "El PIN debe tener exactamente 4 dígitos numéricos.");
  }

  if (pin !== confirmation) {
    throw new HttpError(400, "pin-mismatch", "Los PIN no coinciden.");
  }

  await writePinCredentials(env.DB, pin, env);
  await resetSecurityState(env.DB, client, "admin-pin-change");
  return jsonResponse({ ok: true, status: "updated" }, 200, origin);
}

async function handleAdminCleanup(request, env, origin) {
  const client = await requireAdmin(request, env);
  await readJson(request);
  const result = await cleanupExpiredItems(env);
  await logSecurityEvent(env.DB, "admin-cleanup", client, result);
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function handleAdminStorageCheck(request, env, origin) {
  const client = await requireAdmin(request, env);
  await readJson(request);
  const result = await checkB2Access(env);
  await logSecurityEvent(env.DB, "admin-storage-check", client, {
    bucket: result.bucket,
    endpoint: result.endpoint
  });
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function routeRequest(request, env, origin) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/health") {
    return jsonResponse({
      ok: true,
      service: "hopper-api",
      configured: {
        d1: Boolean(env.DB),
        b2Bucket: Boolean(env.B2_BUCKET_NAME && env.B2_ENDPOINT),
        b2Signing: Boolean(env.B2_KEY_ID && env.B2_APPLICATION_KEY),
        recoveryEmail: Boolean(env.RECOVERY_EMAIL)
      }
    }, 200, origin);
  }

  if (request.method === "GET" && pathname === "/api/security/status") {
    return handleSecurityStatus(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    return handleLogin(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/api/recovery/request") {
    return handleRecoveryRequest(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/api/recovery/verify") {
    return handleRecoveryVerify(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/api/recovery/reset") {
    return handleRecoveryReset(request, env, origin);
  }

  if (request.method === "GET" && pathname === "/api/items") {
    return handleItemsList(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/api/items/text") {
    return handleTextCreate(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/api/uploads/init") {
    return handleUploadInit(request, env, origin);
  }

  const uploadMatch = pathname.match(/^\/api\/uploads\/([0-9a-f-]{36})\/(complete|cancel)$/i);

  if (uploadMatch && request.method === "POST" && uploadMatch[2] === "complete") {
    return handleUploadComplete(request, env, origin, uploadMatch[1]);
  }

  if (uploadMatch && request.method === "DELETE" && uploadMatch[2] === "cancel") {
    return handleUploadCancel(request, env, origin, uploadMatch[1]);
  }

  const itemMatch = pathname.match(/^\/api\/items\/([0-9a-f-]{36})(?:\/(url|ttl))?$/i);

  if (itemMatch && itemMatch[2] === "url" && request.method === "GET") {
    return handleDownloadUrl(request, env, origin, itemMatch[1], url);
  }

  if (itemMatch && itemMatch[2] === "ttl" && request.method === "PATCH") {
    return handleTtlReset(request, env, origin, itemMatch[1]);
  }

  if (itemMatch && !itemMatch[2] && request.method === "DELETE") {
    return handleItemDelete(request, env, origin, itemMatch[1]);
  }

  if (request.method === "POST" && pathname === "/admin/change-pin") {
    return handleAdminChangePin(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/admin/cleanup") {
    return handleAdminCleanup(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/admin/storage-check") {
    return handleAdminStorageCheck(request, env, origin);
  }

  throw new HttpError(404, "not-found", "Ruta no encontrada.");
}

export default {
  async fetch(request, env) {
    let origin = "";

    try {
      origin = resolveCorsOrigin(request, env);

      if (request.method === "OPTIONS") {
        return jsonResponse({ ok: true }, 204, origin);
      }

      return await routeRequest(request, env, origin);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse({
          ok: false,
          code: error.code,
          message: error.message
        }, error.status, origin);
      }

      console.error("Error no controlado en Hopper API.", error);
      return jsonResponse({
        ok: false,
        code: "internal-error",
        message: "Hopper no pudo completar la solicitud."
      }, 500, origin);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([
      cleanupExpiredItems(env),
      cleanupRateLimits(env.DB)
    ]));
  }
};
