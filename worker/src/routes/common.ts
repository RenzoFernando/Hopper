import type { Context, Hono } from "hono";
import { checkB2Access } from "../services/b2.ts";
import { cleanupExpiredItems } from "../services/items.ts";
import { cleanupExpiredRooms, requireRoomRequest, touchRoomActivity } from "../services/rooms.ts";
import {
  enforceRateLimit,
  ensureClientAllowed,
  hasValidAdminCliToken,
  logSecurityEvent,
  requireAuthorizedRequest
} from "../services/security.ts";
import { recordCleanupState } from "../services/usage.ts";
import { HttpError, getClientInfo, normalizeText } from "../lib/http.ts";
import type { ClientInfo, Env } from "../types/env.ts";

export type HopperHonoEnv = {
  Bindings: Env;
  Variables: {
    corsOrigin: string;
  };
};

export type HopperContext = Context<HopperHonoEnv>;
export type HopperApp = Hono<HopperHonoEnv>;

export function responseOrigin(c: HopperContext): string {
  return c.get("corsOrigin") || "";
}

export async function authorizePersonal(
  c: HopperContext,
  scope: string,
  limit = 120,
  windowSeconds = 60
): Promise<ClientInfo> {
  const client = getClientInfo(c.req.raw);
  await ensureClientAllowed(c.env.DB, client);
  await enforceRateLimit(c.env.DB, client, scope, limit, windowSeconds);
  await requireAuthorizedRequest(c.req.raw, c.env, client);
  return client;
}

export async function authorizeRoom(
  c: HopperContext,
  scope: string,
  limit = 120,
  windowSeconds = 60,
  touch = false
) {
  const client = getClientInfo(c.req.raw);
  await ensureClientAllowed(c.env.DB, client);
  await enforceRateLimit(c.env.DB, client, scope, limit, windowSeconds);
  const roomAuth = await requireRoomRequest(c.req.raw, c.env);

  if (!touch) {
    return { client, ...roomAuth };
  }

  const room = await touchRoomActivity(c.env, roomAuth.room.id);

  if (!room) {
    throw new HttpError(401, "invalid-room-session", "La sala cerró o la sesión ya no es válida.");
  }

  return {
    client,
    ...roomAuth,
    room,
    context: { ...roomAuth.context, roomExpiresAt: room.expiresAt }
  };
}

export async function runCleanup(env: Env) {
  const roomCleanup = await cleanupExpiredRooms(env);
  const itemCleanup = await cleanupExpiredItems(env);
  const failed = Number(roomCleanup.failed || 0) + Number(itemCleanup.failed || 0);
  await recordCleanupState(env.DB, failed);
  return { rooms: roomCleanup, items: itemCleanup, failed };
}

export async function requireAdminCli(c: HopperContext): Promise<ClientInfo> {
  const client = getClientInfo(c.req.raw);
  await ensureClientAllowed(c.env.DB, client);
  await enforceRateLimit(c.env.DB, client, "admin-cli", 30, 60);

  if (normalizeText(c.env.ADMIN_CLI_TOKEN).length < 32) {
    throw new HttpError(404, "not-found", "Ruta no encontrada.");
  }

  if (!(await hasValidAdminCliToken(c.req.raw, c.env))) {
    await logSecurityEvent(c.env.DB, "admin-cli-denied", client);
    throw new HttpError(401, "admin-cli-unauthorized", "Autorización administrativa no válida.");
  }

  return client;
}

export async function runStorageCheck(c: HopperContext) {
  const client = await requireAdminCli(c);
  const result = await checkB2Access(c.env);
  await logSecurityEvent(c.env.DB, "admin-storage-check", client, {
    bucket: result.bucket,
    endpoint: result.endpoint
  });
  return result;
}
