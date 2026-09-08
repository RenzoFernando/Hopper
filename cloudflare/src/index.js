import { MAX_FAILED_ATTEMPTS, SESSION_TTL_SECONDS } from "./constants.js";
import { checkB2Access } from "./b2.js";
import {
  getAdminHealth,
  getAdminUsage,
  deleteAdminStatistics,
  maybeReconcileStorage,
  reconcileStorage
} from "./admin.js";
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
  cleanupRateLimits,
  createSessionToken,
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
  createRoom,
  cleanupExpiredRooms,
  closeRoom,
  joinRoom,
  listActiveRooms,
  requireRoomRequest
} from "./rooms.js";
import {
  issueRecovery,
  resetPinWithRecovery,
  verifyRecoveryToken
} from "./recovery.js";
import { ensureEvolutionSchema } from "./schema.js";
import {
  cleanupUsageStatistics,
  recordCleanupState
} from "./usage.js";

const PERSONAL_CONTEXT = Object.freeze({ spaceType: "personal" });

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

async function authorizePersonal(request, env) {
  const client = getClientInfo(request);
  await requireAuthorizedRequest(request, env, client);
  return client;
}

async function authorizeRoom(request, env, scope, limit = 120, windowSeconds = 60) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);
  await enforceRateLimit(env.DB, client, scope, limit, windowSeconds);
  const roomAuth = await requireRoomRequest(request, env);
  return { client, ...roomAuth };
}

async function handleItemsList(request, env, origin) {
  await authorizePersonal(request, env);
  const items = await listActiveItems(env, PERSONAL_CONTEXT);
  return jsonResponse({ ok: true, items, serverTime: new Date().toISOString() }, 200, origin);
}

async function handleTextCreate(request, env, origin) {
  await authorizePersonal(request, env);
  const body = await readJson(request);
  const item = await createTextItem(env, body, PERSONAL_CONTEXT);
  return jsonResponse({ ok: true, item }, 201, origin);
}

async function handleUploadInit(request, env, origin) {
  await authorizePersonal(request, env);
  const body = await readJson(request);
  const upload = await initializeFileUpload(env, body, PERSONAL_CONTEXT);
  return jsonResponse({ ok: true, upload }, 201, origin);
}

async function handleUploadComplete(request, env, origin, id) {
  await authorizePersonal(request, env);
  await readJson(request);
  const item = await completeFileUpload(env, id, PERSONAL_CONTEXT);
  return jsonResponse({ ok: true, item }, 200, origin);
}

async function handleUploadCancel(request, env, origin, id) {
  await authorizePersonal(request, env);
  await cancelFileUpload(env, id, PERSONAL_CONTEXT);
  return jsonResponse({ ok: true }, 200, origin);
}

async function handleDownloadUrl(request, env, origin, id, url) {
  await authorizePersonal(request, env);
  const requestedMode = url.searchParams.get("mode");
  const mode = ["preview", "stream"].includes(requestedMode) ? requestedMode : "download";
  const result = await createItemDownloadUrl(env, id, mode, PERSONAL_CONTEXT);
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function handleTtlReset(request, env, origin, id) {
  await authorizePersonal(request, env);
  const body = await readJson(request);
  const item = await resetItemTtl(env, id, body?.ttlMinutes, PERSONAL_CONTEXT);
  return jsonResponse({ ok: true, item }, 200, origin);
}

async function handleItemDelete(request, env, origin, id) {
  await authorizePersonal(request, env);
  await deleteItem(env, id, PERSONAL_CONTEXT);
  return jsonResponse({ ok: true }, 200, origin);
}

async function handleRoomCreate(request, env, origin) {
  const client = await authorizePersonal(request, env);
  const body = await readJson(request);
  const result = await createRoom(env, body, client);
  return jsonResponse({ ok: true, ...result }, 201, origin);
}

async function handleRoomsList(request, env, origin) {
  await authorizePersonal(request, env);
  const rooms = await listActiveRooms(env.DB);
  return jsonResponse({ ok: true, rooms }, 200, origin);
}

async function handleRoomClose(request, env, origin, roomId) {
  await authorizePersonal(request, env);
  const result = await closeRoom(env, roomId);
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function handleRoomJoin(request, env, origin) {
  const client = getClientInfo(request);
  await ensureClientAllowed(env.DB, client);
  await enforceRateLimit(env.DB, client, "room-join", 12, 10 * 60);
  const body = await readJson(request);
  const result = await joinRoom(env, body?.code);
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function handleRoomStatus(request, env, origin) {
  const auth = await authorizeRoom(request, env, "room-status", 90, 60);
  return jsonResponse({ ok: true, room: auth.room, serverTime: new Date().toISOString() }, 200, origin);
}

async function handleRoomItemsList(request, env, origin) {
  const auth = await authorizeRoom(request, env, "room-list", 120, 60);
  const items = await listActiveItems(env, auth.context);
  return jsonResponse({ ok: true, items, room: auth.room, serverTime: new Date().toISOString() }, 200, origin);
}

async function handleRoomTextCreate(request, env, origin) {
  const auth = await authorizeRoom(request, env, "room-text", 60, 60);
  const body = await readJson(request);
  const item = await createTextItem(env, body, auth.context);
  return jsonResponse({ ok: true, item }, 201, origin);
}

async function handleRoomUploadInit(request, env, origin) {
  const auth = await authorizeRoom(request, env, "room-upload", 40, 60);
  const body = await readJson(request);
  const upload = await initializeFileUpload(env, body, auth.context);
  return jsonResponse({ ok: true, upload }, 201, origin);
}

async function handleRoomUploadComplete(request, env, origin, id) {
  const auth = await authorizeRoom(request, env, "room-upload-complete", 60, 60);
  await readJson(request);
  const item = await completeFileUpload(env, id, auth.context);
  return jsonResponse({ ok: true, item }, 200, origin);
}

async function handleRoomUploadCancel(request, env, origin, id) {
  const auth = await authorizeRoom(request, env, "room-upload-cancel", 60, 60);
  await cancelFileUpload(env, id, auth.context);
  return jsonResponse({ ok: true }, 200, origin);
}

async function handleRoomDownloadUrl(request, env, origin, id, url) {
  const auth = await authorizeRoom(request, env, "room-download", 120, 60);
  const requestedMode = url.searchParams.get("mode");
  const mode = ["preview", "stream"].includes(requestedMode) ? requestedMode : "download";
  const result = await createItemDownloadUrl(env, id, mode, auth.context);
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function handleRoomTtlReset(request, env, origin, id) {
  const auth = await authorizeRoom(request, env, "room-ttl", 90, 60);
  const body = await readJson(request);
  const item = await resetItemTtl(env, id, body?.ttlMinutes, auth.context);
  return jsonResponse({ ok: true, item }, 200, origin);
}

async function handleRoomItemDelete(request, env, origin, id) {
  const auth = await authorizeRoom(request, env, "room-delete", 90, 60);
  await deleteItem(env, id, auth.context);
  return jsonResponse({ ok: true }, 200, origin);
}

async function handleAdminUsage(request, env, origin) {
  await authorizePersonal(request, env);
  const result = await getAdminUsage(env);
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function handleAdminHealth(request, env, origin) {
  await authorizePersonal(request, env);
  const result = await getAdminHealth(env);
  return jsonResponse({ ok: true, health: result }, 200, origin);
}

async function handleAdminRooms(request, env, origin) {
  await authorizePersonal(request, env);
  const rooms = await listActiveRooms(env.DB);
  return jsonResponse({ ok: true, rooms }, 200, origin);
}

async function handleAdminReconcile(request, env, origin) {
  await authorizePersonal(request, env);
  await readJson(request);
  const result = await reconcileStorage(env);
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function runCleanup(env) {
  const roomCleanup = await cleanupExpiredRooms(env);
  const itemCleanup = await cleanupExpiredItems(env);
  const failed = Number(roomCleanup.failed || 0) + Number(itemCleanup.failed || 0);
  await recordCleanupState(env.DB, failed);
  return { rooms: roomCleanup, items: itemCleanup, failed };
}

async function handleAdminCleanup(request, env, origin) {
  await authorizePersonal(request, env);
  await readJson(request);
  const result = await runCleanup(env);
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function handleAdminDeleteStatistics(request, env, origin) {
  await authorizePersonal(request, env);
  const result = await deleteAdminStatistics(env);
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function requireAdminCli(request, env) {
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
  const client = await requireAdminCli(request, env);
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

async function handleCliCleanup(request, env, origin) {
  const client = await requireAdminCli(request, env);
  await readJson(request);
  const result = await runCleanup(env);
  await logSecurityEvent(env.DB, "admin-cleanup", client, result);
  return jsonResponse({ ok: true, ...result }, 200, origin);
}

async function handleAdminStorageCheck(request, env, origin) {
  const client = await requireAdminCli(request, env);
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

  if (request.method === "POST" && pathname === "/api/rooms") {
    return handleRoomCreate(request, env, origin);
  }

  if (request.method === "GET" && pathname === "/api/rooms") {
    return handleRoomsList(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/api/rooms/join") {
    return handleRoomJoin(request, env, origin);
  }

  const roomManageMatch = pathname.match(/^\/api\/rooms\/([0-9a-f-]{36})$/i);

  if (roomManageMatch && request.method === "DELETE") {
    return handleRoomClose(request, env, origin, roomManageMatch[1]);
  }

  if (request.method === "GET" && pathname === "/api/room/status") {
    return handleRoomStatus(request, env, origin);
  }

  if (request.method === "GET" && pathname === "/api/room/items") {
    return handleRoomItemsList(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/api/room/items/text") {
    return handleRoomTextCreate(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/api/room/uploads/init") {
    return handleRoomUploadInit(request, env, origin);
  }

  const roomUploadMatch = pathname.match(/^\/api\/room\/uploads\/([0-9a-f-]{36})\/(complete|cancel)$/i);

  if (roomUploadMatch && request.method === "POST" && roomUploadMatch[2] === "complete") {
    return handleRoomUploadComplete(request, env, origin, roomUploadMatch[1]);
  }

  if (roomUploadMatch && request.method === "DELETE" && roomUploadMatch[2] === "cancel") {
    return handleRoomUploadCancel(request, env, origin, roomUploadMatch[1]);
  }

  const roomItemMatch = pathname.match(/^\/api\/room\/items\/([0-9a-f-]{36})(?:\/(url|ttl))?$/i);

  if (roomItemMatch && roomItemMatch[2] === "url" && request.method === "GET") {
    return handleRoomDownloadUrl(request, env, origin, roomItemMatch[1], url);
  }

  if (roomItemMatch && roomItemMatch[2] === "ttl" && request.method === "PATCH") {
    return handleRoomTtlReset(request, env, origin, roomItemMatch[1]);
  }

  if (roomItemMatch && !roomItemMatch[2] && request.method === "DELETE") {
    return handleRoomItemDelete(request, env, origin, roomItemMatch[1]);
  }

  if (request.method === "GET" && pathname === "/api/admin/usage") {
    return handleAdminUsage(request, env, origin);
  }

  if (request.method === "GET" && pathname === "/api/admin/health") {
    return handleAdminHealth(request, env, origin);
  }

  if (request.method === "GET" && pathname === "/api/admin/rooms") {
    return handleAdminRooms(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/api/admin/reconcile-storage") {
    return handleAdminReconcile(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/api/admin/cleanup") {
    return handleAdminCleanup(request, env, origin);
  }

  if (request.method === "DELETE" && pathname === "/api/admin/statistics") {
    return handleAdminDeleteStatistics(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/admin/change-pin") {
    return handleAdminChangePin(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/admin/cleanup") {
    return handleCliCleanup(request, env, origin);
  }

  if (request.method === "POST" && pathname === "/admin/storage-check") {
    return handleAdminStorageCheck(request, env, origin);
  }

  throw new HttpError(404, "not-found", "Ruta no encontrada.");
}

async function scheduledMaintenance(env) {
  await ensureEvolutionSchema(env);
  const cleanup = await runCleanup(env);
  await Promise.all([
    cleanupRateLimits(env.DB),
    cleanupUsageStatistics(env.DB)
  ]);

  try {
    await maybeReconcileStorage(env);
  } catch (error) {
    console.error("La reconciliación automática de almacenamiento falló.", error);
  }

  return cleanup;
}

export default {
  async fetch(request, env) {
    let origin = "";

    try {
      origin = resolveCorsOrigin(request, env);

      if (request.method === "OPTIONS") {
        return jsonResponse({ ok: true }, 204, origin);
      }

      await ensureEvolutionSchema(env);
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
    ctx.waitUntil(scheduledMaintenance(env));
  }
};
