import { HttpError, normalizeText } from "../lib/http.ts";
import {
  cliPinChangeBodySchema,
  deleteStatisticsBodySchema,
  emptyBodySchema,
  parseJsonBody,
  parseParams,
  resetSystemBodySchema,
  roomIdParamSchema,
  webPinChangeBodySchema
} from "../schemas/requests.ts";
import {
  adminHealthResponseSchema,
  adminUsageResponseSchema,
  criticalJson,
  operationResponseSchema,
  passthroughResponseSchema,
  roomSessionResponseSchema,
  roomsResponseSchema,
  statusResponseSchema
} from "../schemas/responses.ts";
import {
  deleteAdminStatistics,
  getAdminHealth,
  getAdminUsage,
  reconcileStorage,
  resetAdminSystem
} from "../services/admin.ts";
import { issueRoomSession, listActiveRooms } from "../services/rooms.ts";
import {
  isValidPin,
  logSecurityEvent,
  requireCurrentPin,
  resetSecurityState,
  writePinCredentials
} from "../services/security.ts";
import type { HopperApp, HopperContext } from "./common.ts";
import {
  authorizePersonal,
  requireAdminCli,
  responseOrigin,
  runCleanup,
  runStorageCheck
} from "./common.ts";

export function registerAdminRoutes(app: HopperApp): void {
  app.get("/api/admin/usage", async (c: HopperContext) => {
    await authorizePersonal(c, "admin-usage", 30, 60);
    const result = await getAdminUsage(c.env);
    return criticalJson(adminUsageResponseSchema, { ok: true, ...result }, 200, responseOrigin(c));
  });

  app.get("/api/admin/health", async (c: HopperContext) => {
    await authorizePersonal(c, "admin-health", 12, 60);
    const result = await getAdminHealth(c.env);
    return criticalJson(adminHealthResponseSchema, { ok: true, health: result }, 200, responseOrigin(c));
  });

  app.get("/api/admin/rooms", async (c: HopperContext) => {
    await authorizePersonal(c, "admin-rooms", 30, 60);
    const rooms = await listActiveRooms(c.env.DB);
    return criticalJson(roomsResponseSchema, { ok: true, rooms }, 200, responseOrigin(c));
  });

  app.post("/api/admin/rooms/:roomId/session", async (c: HopperContext) => {
    await authorizePersonal(c, "admin-room-session", 20, 60);
    const { roomId } = parseParams({ roomId: c.req.param("roomId") }, roomIdParamSchema);
    await parseJsonBody(c.req.raw, emptyBodySchema);
    const result = await issueRoomSession(c.env, roomId, { touch: true });
    return criticalJson(roomSessionResponseSchema, { ok: true, ...result }, 200, responseOrigin(c));
  });

  app.post("/api/admin/reconcile-storage", async (c: HopperContext) => {
    await authorizePersonal(c, "admin-reconcile", 4, 10 * 60);
    await parseJsonBody(c.req.raw, emptyBodySchema);
    const result = await reconcileStorage(c.env);
    return criticalJson(passthroughResponseSchema, { ok: true, ...result }, 200, responseOrigin(c));
  });

  app.post("/api/admin/cleanup", async (c: HopperContext) => {
    await authorizePersonal(c, "admin-cleanup", 10, 10 * 60);
    await parseJsonBody(c.req.raw, emptyBodySchema);
    const result = await runCleanup(c.env);
    return criticalJson(passthroughResponseSchema, { ok: true, ...result }, 200, responseOrigin(c));
  });

  app.delete("/api/admin/statistics", async (c: HopperContext) => {
    const client = await authorizePersonal(c, "admin-delete-statistics", 3, 60 * 60);
    const body = await parseJsonBody(c.req.raw, deleteStatisticsBodySchema);
    await requireCurrentPin(c.env, body.currentPin, client, "admin-delete-statistics-reauth");
    const result = await deleteAdminStatistics(c.env);
    await logSecurityEvent(c.env.DB, "admin-statistics-deleted", client);
    return criticalJson(operationResponseSchema, { ok: true, ...result }, 200, responseOrigin(c));
  });

  app.post("/api/admin/pin", async (c: HopperContext) => {
    const client = await authorizePersonal(c, "admin-pin-change", 5, 60 * 60);
    const body = await parseJsonBody(c.req.raw, webPinChangeBodySchema);
    const currentPin = normalizeText(body.currentPin);
    const pin = normalizeText(body.pin);
    const confirmation = normalizeText(body.confirmation);

    if (!isValidPin(currentPin) || !isValidPin(pin)) {
      throw new HttpError(400, "invalid-pin-format", "El PIN debe tener exactamente 4 dígitos numéricos.");
    }

    if (pin !== confirmation) {
      throw new HttpError(400, "pin-mismatch", "Los PIN no coinciden.");
    }

    await requireCurrentPin(c.env, currentPin, client, "admin-pin-change-reauth");
    await writePinCredentials(c.env.DB, pin, c.env);
    await resetSecurityState(c.env.DB, client, "admin-web-pin-change");
    return criticalJson(statusResponseSchema, { ok: true, status: "updated" }, 200, responseOrigin(c));
  });

  app.post("/api/admin/reset-system", async (c: HopperContext) => {
    const client = await authorizePersonal(c, "admin-reset-system", 2, 60 * 60);
    const body = await parseJsonBody(c.req.raw, resetSystemBodySchema);
    await requireCurrentPin(c.env, body.currentPin, client, "admin-reset-system-reauth");
    const result = await resetAdminSystem(c.env);

    if (Number(result.failed || 0) > 0) {
      await logSecurityEvent(c.env.DB, "admin-system-reset-incomplete", client, {
        failed: Number(result.failed || 0),
        verification: result.verification
      });
      throw new HttpError(
        502,
        "system-reset-incomplete",
        "El reinicio no pudo eliminar todo el contenido temporal. Inténtalo de nuevo."
      );
    }

    await resetSecurityState(c.env.DB, client, "admin-system-reset");
    return criticalJson(statusResponseSchema, {
      ok: true,
      status: "reset",
      ...result
    }, 200, responseOrigin(c));
  });

  app.post("/admin/change-pin", async (c: HopperContext) => {
    const client = await requireAdminCli(c);
    const body = await parseJsonBody(c.req.raw, cliPinChangeBodySchema);
    const pin = normalizeText(body.pin);
    const confirmation = normalizeText(body.confirmation);

    if (!isValidPin(pin)) {
      throw new HttpError(400, "invalid-pin-format", "El PIN debe tener exactamente 4 dígitos numéricos.");
    }

    if (pin !== confirmation) {
      throw new HttpError(400, "pin-mismatch", "Los PIN no coinciden.");
    }

    await writePinCredentials(c.env.DB, pin, c.env);
    await resetSecurityState(c.env.DB, client, "admin-pin-change");
    return criticalJson(statusResponseSchema, { ok: true, status: "updated" }, 200, responseOrigin(c));
  });

  app.post("/admin/cleanup", async (c: HopperContext) => {
    const client = await requireAdminCli(c);
    await parseJsonBody(c.req.raw, emptyBodySchema);
    const result = await runCleanup(c.env);
    await logSecurityEvent(c.env.DB, "admin-cleanup", client, result);
    return criticalJson(passthroughResponseSchema, { ok: true, ...result }, 200, responseOrigin(c));
  });

  app.post("/admin/storage-check", async (c: HopperContext) => {
    await parseJsonBody(c.req.raw, emptyBodySchema);
    const result = await runStorageCheck(c);
    return criticalJson(passthroughResponseSchema, { ok: true, ...result }, 200, responseOrigin(c));
  });
}
