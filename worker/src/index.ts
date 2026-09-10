import { Hono } from "hono";
import type { Next } from "hono";
import { jsonResponse, HttpError, resolveCorsOrigin } from "./lib/http.ts";
import { healthResponseSchema, criticalJson } from "./schemas/responses.ts";
import { maybeReconcileStorage } from "./services/admin.ts";
import { cleanupRateLimits } from "./services/security.ts";
import { cleanupUsageStatistics } from "./services/usage.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import type { HopperContext, HopperHonoEnv } from "./routes/common.ts";
import { responseOrigin, runCleanup } from "./routes/common.ts";
import { registerItemRoutes } from "./routes/items.ts";
import { registerRoomRoutes } from "./routes/rooms.ts";
import type { Env, ExecutionContextLike } from "./types/env.ts";

export const app = new Hono<HopperHonoEnv>();

app.use("*", async (c: HopperContext, next: Next) => {
  const origin = resolveCorsOrigin(c.req.raw, c.env);
  c.set("corsOrigin", origin);

  if (c.req.method === "OPTIONS") {
    return jsonResponse({ ok: true }, 204, origin);
  }

  await next();
});

app.get("/health", (c: HopperContext) => criticalJson(healthResponseSchema, {
  ok: true,
  service: "hopper-api",
  configured: {
    d1: Boolean(c.env.DB),
    b2Bucket: Boolean(c.env.B2_BUCKET_NAME && c.env.B2_ENDPOINT),
    b2Signing: Boolean(c.env.B2_KEY_ID && c.env.B2_APPLICATION_KEY),
    recoveryEmail: Boolean(c.env.RECOVERY_EMAIL)
  }
}, 200, responseOrigin(c)));

registerAuthRoutes(app);
registerItemRoutes(app);
registerRoomRoutes(app);
registerAdminRoutes(app);

app.notFound((c: HopperContext) => jsonResponse({
  ok: false,
  code: "not-found",
  message: "Ruta no encontrada."
}, 404, responseOrigin(c)));

app.onError((error: Error, c: HopperContext) => {
  const origin = c.get("corsOrigin") || "";

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
});

async function scheduledMaintenance(env: Env): Promise<void> {
  await runCleanup(env);
  await Promise.all([
    cleanupRateLimits(env.DB),
    cleanupUsageStatistics(env.DB)
  ]);

  try {
    await maybeReconcileStorage(env);
  } catch (error) {
    console.error("La reconciliación automática de almacenamiento falló.", error);
  }
}

export default {
  fetch: app.fetch,
  scheduled(_controller: unknown, env: Env, ctx: ExecutionContextLike) {
    ctx.waitUntil(scheduledMaintenance(env));
  }
};
