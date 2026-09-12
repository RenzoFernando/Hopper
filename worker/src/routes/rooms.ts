import { ROOM_DEFAULT_TTL_MINUTES } from "../lib/constants.ts";
import { HttpError, getClientInfo } from "../lib/http.ts";
import {
  emptyBodySchema,
  fileUploadBodySchema,
  idParamSchema,
  parseJsonBody,
  parseParams,
  roomCreateBodySchema,
  roomIdParamSchema,
  roomJoinBodySchema,
  textItemBodySchema,
  ttlBodySchema
} from "../schemas/requests.ts";
import {
  criticalJson,
  fileUrlResponseSchema,
  itemResponseSchema,
  itemsResponseSchema,
  operationResponseSchema,
  roomCapacityResponseSchema,
  roomsResponseSchema,
  roomSessionResponseSchema,
  roomStatusResponseSchema,
  uploadResponseSchema
} from "../schemas/responses.ts";
import {
  cancelFileUpload,
  completeFileUpload,
  createItemDownloadUrl,
  createTextItem,
  deleteItem,
  initializeFileUpload,
  listActiveItems
} from "../services/items.ts";
import {
  closeRoom,
  createRoom,
  getRoomCapacity,
  joinRoom,
  listActiveRooms
} from "../services/rooms.ts";
import { enforceRateLimit, ensureClientAllowed } from "../services/security.ts";
import type { HopperApp, HopperContext } from "./common.ts";
import { authorizePersonal, authorizeRoom, responseOrigin } from "./common.ts";

export function registerRoomRoutes(app: HopperApp): void {
  app.post("/api/rooms", async (c: HopperContext) => {
    const client = getClientInfo(c.req.raw);
    await ensureClientAllowed(c.env.DB, client);
    await enforceRateLimit(c.env.DB, client, "rooms-create", 6, 10 * 60);
    const body = await parseJsonBody(c.req.raw, roomCreateBodySchema);
    const result = await createRoom(c.env, body, client);
    return criticalJson(roomSessionResponseSchema, { ok: true, ...result }, 201, responseOrigin(c));
  });

  app.get("/api/rooms/capacity", async (c: HopperContext) => {
    const client = getClientInfo(c.req.raw);
    await ensureClientAllowed(c.env.DB, client);
    await enforceRateLimit(c.env.DB, client, "rooms-capacity", 60, 60);
    const capacity = await getRoomCapacity(c.env.DB);
    return criticalJson(roomCapacityResponseSchema, { ok: true, ...capacity }, 200, responseOrigin(c));
  });

  app.get("/api/rooms", async (c: HopperContext) => {
    await authorizePersonal(c, "rooms-list-personal", 60, 60);
    const rooms = await listActiveRooms(c.env.DB);
    return criticalJson(roomsResponseSchema, { ok: true, rooms }, 200, responseOrigin(c));
  });

  app.post("/api/rooms/join", async (c: HopperContext) => {
    const client = getClientInfo(c.req.raw);
    await ensureClientAllowed(c.env.DB, client);
    await enforceRateLimit(c.env.DB, client, "rooms-join", 12, 10 * 60);
    const body = await parseJsonBody(c.req.raw, roomJoinBodySchema);
    const result = await joinRoom(c.env, body.code);
    return criticalJson(roomSessionResponseSchema, { ok: true, ...result }, 200, responseOrigin(c));
  });

  app.delete("/api/rooms/:roomId", async (c: HopperContext) => {
    await authorizePersonal(c, "rooms-close", 30, 60);
    const { roomId } = parseParams({ roomId: c.req.param("roomId") }, roomIdParamSchema);
    const result = await closeRoom(c.env, roomId);
    return criticalJson(operationResponseSchema, { ok: true, ...result }, 200, responseOrigin(c));
  });

  app.get("/api/room/status", async (c: HopperContext) => {
    const auth = await authorizeRoom(c, "room-status", 90, 60);
    return criticalJson(roomStatusResponseSchema, {
      ok: true,
      room: auth.room,
      serverTime: new Date().toISOString()
    }, 200, responseOrigin(c));
  });

  app.post("/api/room/activity", async (c: HopperContext) => {
    const auth = await authorizeRoom(c, "room-activity", 20, 60, true);
    await parseJsonBody(c.req.raw, emptyBodySchema);
    return criticalJson(roomStatusResponseSchema, {
      ok: true,
      room: auth.room,
      serverTime: new Date().toISOString()
    }, 200, responseOrigin(c));
  });

  app.get("/api/room/items", async (c: HopperContext) => {
    const auth = await authorizeRoom(c, "room-items-list", 120, 60);
    const items = await listActiveItems(c.env, auth.context);
    return criticalJson(itemsResponseSchema, {
      ok: true,
      items,
      room: auth.room,
      serverTime: new Date().toISOString()
    }, 200, responseOrigin(c));
  });

  app.post("/api/room/items/text", async (c: HopperContext) => {
    const auth = await authorizeRoom(c, "room-items-text", 60, 60, true);
    const body = await parseJsonBody(c.req.raw, textItemBodySchema);
    const item = await createTextItem(c.env, { ...body, ttlMinutes: ROOM_DEFAULT_TTL_MINUTES }, auth.context);
    return criticalJson(itemResponseSchema, { ok: true, item }, 201, responseOrigin(c));
  });

  app.post("/api/room/uploads/init", async (c: HopperContext) => {
    const auth = await authorizeRoom(c, "room-uploads-init", 40, 60, true);
    const body = await parseJsonBody(c.req.raw, fileUploadBodySchema);
    const upload = await initializeFileUpload(c.env, { ...body, ttlMinutes: ROOM_DEFAULT_TTL_MINUTES }, auth.context);
    return criticalJson(uploadResponseSchema, { ok: true, upload }, 201, responseOrigin(c));
  });

  app.post("/api/room/uploads/:id/complete", async (c: HopperContext) => {
    const auth = await authorizeRoom(c, "room-uploads-complete", 60, 60, true);
    const { id } = parseParams({ id: c.req.param("id") }, idParamSchema);
    await parseJsonBody(c.req.raw, emptyBodySchema);
    const item = await completeFileUpload(c.env, id, auth.context);
    return criticalJson(itemResponseSchema, { ok: true, item }, 200, responseOrigin(c));
  });

  app.delete("/api/room/uploads/:id/cancel", async (c: HopperContext) => {
    const auth = await authorizeRoom(c, "room-uploads-cancel", 60, 60, true);
    const { id } = parseParams({ id: c.req.param("id") }, idParamSchema);
    const recordFailure = c.req.query("outcome") === "failed";
    await cancelFileUpload(c.env, id, auth.context, { recordFailure });
    return criticalJson(operationResponseSchema, { ok: true }, 200, responseOrigin(c));
  });

  app.get("/api/room/items/:id/url", async (c: HopperContext) => {
    const auth = await authorizeRoom(c, "room-items-url", 120, 60, true);
    const { id } = parseParams({ id: c.req.param("id") }, idParamSchema);
    const requestedMode = c.req.query("mode");
    const mode = requestedMode === "preview" || requestedMode === "stream" ? requestedMode : "download";
    const result = await createItemDownloadUrl(c.env, id, mode, auth.context);
    return criticalJson(fileUrlResponseSchema, { ok: true, ...result }, 200, responseOrigin(c));
  });

  app.patch("/api/room/items/:id/ttl", async (c: HopperContext) => {
    await authorizeRoom(c, "room-items-ttl", 30, 60);
    parseParams({ id: c.req.param("id") }, idParamSchema);
    await parseJsonBody(c.req.raw, ttlBodySchema);
    throw new HttpError(403, "room-ttl-fixed", "La expiración de los elementos de sala es fija.");
  });

  app.delete("/api/room/items/:id", async (c: HopperContext) => {
    const auth = await authorizeRoom(c, "room-items-delete", 90, 60, true);
    const { id } = parseParams({ id: c.req.param("id") }, idParamSchema);
    await deleteItem(c.env, id, auth.context);
    return criticalJson(operationResponseSchema, { ok: true }, 200, responseOrigin(c));
  });
}
