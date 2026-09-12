import { TTL_OPTIONS } from "../lib/constants.ts";
import {
  cancelFileUpload,
  completeFileUpload,
  createItemDownloadUrl,
  createTextItem,
  deleteItem,
  initializeFileUpload,
  listActiveItems,
  resetItemTtl
} from "../services/items.ts";
import type { ItemContext } from "../services/items.ts";
import {
  emptyBodySchema,
  fileUploadBodySchema,
  idParamSchema,
  parseJsonBody,
  parseParams,
  textItemBodySchema,
  ttlBodySchema
} from "../schemas/requests.ts";
import {
  criticalJson,
  fileUrlResponseSchema,
  itemResponseSchema,
  itemsResponseSchema,
  operationResponseSchema,
  uploadResponseSchema
} from "../schemas/responses.ts";
import type { HopperApp, HopperContext } from "./common.ts";
import { authorizePersonal, responseOrigin } from "./common.ts";

const PERSONAL_CONTEXT: ItemContext = Object.freeze({
  spaceType: "personal",
  roomId: null,
  roomExpiresAt: null,
  maxFileBytes: null,
  maxBytes: null,
  maxItems: null,
  ttlOptions: TTL_OPTIONS
});

export function registerItemRoutes(app: HopperApp): void {
  app.get("/api/items", async (c: HopperContext) => {
    await authorizePersonal(c, "items-list", 120, 60);
    const items = await listActiveItems(c.env, PERSONAL_CONTEXT);
    return criticalJson(itemsResponseSchema, {
      ok: true,
      items,
      serverTime: new Date().toISOString()
    }, 200, responseOrigin(c));
  });

  app.post("/api/items/text", async (c: HopperContext) => {
    await authorizePersonal(c, "items-text", 60, 60);
    const body = await parseJsonBody(c.req.raw, textItemBodySchema);
    const item = await createTextItem(c.env, body, PERSONAL_CONTEXT);
    return criticalJson(itemResponseSchema, { ok: true, item }, 201, responseOrigin(c));
  });

  app.post("/api/uploads/init", async (c: HopperContext) => {
    await authorizePersonal(c, "uploads-init", 40, 60);
    const body = await parseJsonBody(c.req.raw, fileUploadBodySchema);
    const upload = await initializeFileUpload(c.env, body, PERSONAL_CONTEXT);
    return criticalJson(uploadResponseSchema, { ok: true, upload }, 201, responseOrigin(c));
  });

  app.post("/api/uploads/:id/complete", async (c: HopperContext) => {
    await authorizePersonal(c, "uploads-complete", 60, 60);
    const { id } = parseParams({ id: c.req.param("id") }, idParamSchema);
    await parseJsonBody(c.req.raw, emptyBodySchema);
    const item = await completeFileUpload(c.env, id, PERSONAL_CONTEXT);
    return criticalJson(itemResponseSchema, { ok: true, item }, 200, responseOrigin(c));
  });

  app.delete("/api/uploads/:id/cancel", async (c: HopperContext) => {
    await authorizePersonal(c, "uploads-cancel", 60, 60);
    const { id } = parseParams({ id: c.req.param("id") }, idParamSchema);
    const recordFailure = c.req.query("outcome") === "failed";
    await cancelFileUpload(c.env, id, PERSONAL_CONTEXT, { recordFailure });
    return criticalJson(operationResponseSchema, { ok: true }, 200, responseOrigin(c));
  });

  app.get("/api/items/:id/url", async (c: HopperContext) => {
    await authorizePersonal(c, "items-url", 120, 60);
    const { id } = parseParams({ id: c.req.param("id") }, idParamSchema);
    const requestedMode = c.req.query("mode");
    const mode = requestedMode === "preview" || requestedMode === "stream" ? requestedMode : "download";
    const result = await createItemDownloadUrl(c.env, id, mode, PERSONAL_CONTEXT);
    return criticalJson(fileUrlResponseSchema, { ok: true, ...result }, 200, responseOrigin(c));
  });

  app.patch("/api/items/:id/ttl", async (c: HopperContext) => {
    await authorizePersonal(c, "items-ttl", 60, 60);
    const { id } = parseParams({ id: c.req.param("id") }, idParamSchema);
    const body = await parseJsonBody(c.req.raw, ttlBodySchema);
    const item = await resetItemTtl(c.env, id, body.ttlMinutes, PERSONAL_CONTEXT);
    return criticalJson(itemResponseSchema, { ok: true, item }, 200, responseOrigin(c));
  });

  app.delete("/api/items/:id", async (c: HopperContext) => {
    await authorizePersonal(c, "items-delete", 90, 60);
    const { id } = parseParams({ id: c.req.param("id") }, idParamSchema);
    await deleteItem(c.env, id, PERSONAL_CONTEXT);
    return criticalJson(operationResponseSchema, { ok: true }, 200, responseOrigin(c));
  });
}
