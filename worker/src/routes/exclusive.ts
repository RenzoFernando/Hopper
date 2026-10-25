import type { HopperApp, HopperContext } from "./common.ts";
import { authorizePersonal, responseOrigin } from "./common.ts";
import { criticalJson, passthroughResponseSchema } from "../schemas/responses.ts";
import { HttpError } from "../lib/http.ts";
import { parseJsonBody } from "../schemas/requests.ts";
import { z } from "zod";
import { logSecurityEvent, requireCurrentPin } from "../services/security.ts";
import {
  activateExclusiveMode, closeExclusiveMode, completeExclusiveUpload, exclusiveDownload, getExclusiveMode,
  initiateExclusiveUpload, listExclusiveFiles, publicExclusiveStatus, removeExclusiveFile, signExclusivePart
} from "../services/exclusive.ts";

const beginSchema = z.object({ currentPin: z.string(), confirmation: z.literal("BORRAR TODO Y BLOQUEAR"), durationMinutes: z.union([z.literal(60),z.literal(360),z.literal(720),z.literal(1440)]) }).strip();
const retrySchema = z.object({ currentPin: z.string(), confirmation: z.literal("REINTENTAR LIMPIEZA") }).strip();
const uploadSchema = z.object({ name: z.string().min(1).max(240), size: z.number().int().positive().max(10737418240), mimeType: z.string().max(160) }).strip();
const partsSchema = z.object({ parts: z.array(z.object({partNumber:z.number().int().positive(),etag:z.string().max(100)})).min(1).max(10000) }).strip();
function validId(value: string) { if(!/^[0-9a-f-]{36}$/i.test(value)) throw new HttpError(400,"invalid-id","Identificador no válido."); return value; }
function result(c: HopperContext, data: Record<string,unknown>, status=200) {return criticalJson(passthroughResponseSchema,{ok:true,...data},status,responseOrigin(c));}

export function registerExclusiveRoutes(app: HopperApp) {
  // Consulta pública sin datos de los archivos: necesaria para mostrar el bloqueo en cualquier PWA.
  app.get("/api/exclusive/status",async c => result(c,publicExclusiveStatus(await getExclusiveMode(c.env))));
  app.get("/api/admin/super/status",async c=> {await authorizePersonal(c,"super-status",80,60);return result(c,{...publicExclusiveStatus(await getExclusiveMode(c.env)),files:await listExclusiveFiles(c.env)});});
  app.post("/api/admin/super/start",async c=>{
    const client=await authorizePersonal(c,"super-start",2,3600);
    const data=await parseJsonBody(c.req.raw,beginSchema);
    await requireCurrentPin(c.env,data.currentPin,client,"super-start-reauth");
    const mode=await activateExclusiveMode(c.env,data.durationMinutes,client);
    await logSecurityEvent(c.env.DB,"super-started",client,{durationMinutes:data.durationMinutes});
    return result(c,mode);
  });
  app.post("/api/admin/super/retry",async c=>{
    const client=await authorizePersonal(c,"super-retry",3,3600);
    const data=await parseJsonBody(c.req.raw,retrySchema);
    await requireCurrentPin(c.env,data.currentPin,client,"super-retry-reauth");
    return result(c,await activateExclusiveMode(c.env,60,client,true));
  });
  app.post("/api/admin/super/end",async c=>{
    const client=await authorizePersonal(c,"super-end",4,3600);
    const data=await parseJsonBody(c.req.raw,z.object({currentPin:z.string(),confirmation:z.literal("FINALIZAR CARGA")}).strip());
    await requireCurrentPin(c.env,data.currentPin,client,"super-end-reauth");
    const ended=await closeExclusiveMode(c.env);
    await logSecurityEvent(c.env.DB,"super-ended",client,ended);
    return result(c,ended);
  });
  app.post("/api/admin/super/uploads",async c=>{
    await authorizePersonal(c,"super-upload",30,60);
    return result(c,{upload:await initiateExclusiveUpload(c.env,await parseJsonBody(c.req.raw,uploadSchema))},201);
  });
  app.post("/api/admin/super/uploads/:id/part",async c=>{
    await authorizePersonal(c,"super-sign",600,60);
    const body=await parseJsonBody(c.req.raw,z.object({partNumber:z.number().int().positive()}).strip());
    return result(c,await signExclusivePart(c.env,validId(c.req.param("id")),body.partNumber));
  });
  app.post("/api/admin/super/uploads/:id/complete",async c=>{
    await authorizePersonal(c,"super-complete",30,60);
    const data=await parseJsonBody(c.req.raw,partsSchema);
    return result(c,await completeExclusiveUpload(c.env,validId(c.req.param("id")),data.parts));
  });
  app.get("/api/admin/super/uploads/:id/url",async c=>{
    await authorizePersonal(c,"super-url",100,60);
    return result(c,await exclusiveDownload(c.env,validId(c.req.param("id"))));
  });
  app.delete("/api/admin/super/uploads/:id",async c=>{
    await authorizePersonal(c,"super-delete",40,60);
    return result(c,await removeExclusiveFile(c.env,validId(c.req.param("id"))));
  });
}
