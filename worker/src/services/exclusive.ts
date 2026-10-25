import type { ClientInfo, Env } from "../types/env.ts";
import { HttpError } from "../lib/http.ts";
import { DOWNLOAD_URL_TTL_SECONDS, SESSION_TTL_SECONDS, STORAGE_REFERENCE_BYTES, UPLOAD_URL_TTL_SECONDS } from "../lib/constants.ts";
import { abortB2Multipart, abortB2MultipartByPrefix, completeB2Multipart, createB2Multipart, createSignedB2Url, deleteB2Version, getB2ObjectMetadata, listB2VersionsByPrefix } from "./b2.ts";
import { resetAdminSystem } from "./admin.ts";
import { createSessionToken, getSessionVersion, resetSecurityState } from "./security.ts";

export const EXCLUSIVE_LIMIT = STORAGE_REFERENCE_BYTES; // 10 GiB nominales, nunca se presume espacio físico mayor.
export const EXCLUSIVE_CHUNK = 32 * 1024 * 1024;
export const EXCLUSIVE_DURATIONS = [60, 360, 720, 1440] as const;
type ModeRow = { status: string; started_at: string; expires_at: string };
type UploadRow = { id: string; name: string; size: number; mime_type: string; storage_key: string; upload_id: string | null; status: string; created_at: string };

export async function getExclusiveMode(env: Env): Promise<ModeRow | null> {
  const row = await env.DB.prepare("SELECT status, started_at, expires_at FROM exclusive_mode WHERE id = 1").first<ModeRow>();
  return row && row.status !== "inactive" ? row : null;
}

export function publicExclusiveStatus(mode: ModeRow | null) {
  return { active: Boolean(mode), status: mode?.status || "inactive", startedAt: mode?.started_at || null, expiresAt: mode?.expires_at || null, limitBytes: EXCLUSIVE_LIMIT };
}

export async function requireExclusiveActive(env: Env): Promise<ModeRow> {
  const mode = await getExclusiveMode(env);
  if (!mode || mode.status !== "active") throw new HttpError(423, "exclusive-not-ready", "La carga exclusiva no está lista.");
  if (Date.parse(mode.expires_at) <= Date.now()) throw new HttpError(423, "exclusive-expired", "La sesión finalizó. Se está liberando el almacenamiento.");
  return mode;
}

export async function activateExclusiveMode(env: Env, durationMinutes: number, client: ClientInfo, retry = false) {
  if (!EXCLUSIVE_DURATIONS.includes(durationMinutes as typeof EXCLUSIVE_DURATIONS[number])) throw new HttpError(400, "invalid-duration", "Selecciona 1, 6, 12 o 24 horas.");
  const now = new Date();
  if (!retry) {
    const inserted = await env.DB.prepare(`INSERT INTO exclusive_mode (id,status,started_at,expires_at) VALUES(1,'preparing',?1,?2)
      ON CONFLICT(id) DO UPDATE SET status='preparing', started_at=excluded.started_at, expires_at=excluded.expires_at, ended_at=NULL
      WHERE exclusive_mode.status='inactive'`).bind(now.toISOString(), new Date(now.getTime() + durationMinutes * 60_000).toISOString()).run();
    if (Number(inserted.meta?.changes || 0) !== 1) throw new HttpError(409, "exclusive-busy", "Ya existe una sesión exclusiva.");
  } else {
    const mode = await getExclusiveMode(env);
    if (mode?.status !== "preparing") throw new HttpError(409, "exclusive-not-preparing", "No hay una limpieza pendiente que reintentar.");
  }
  // El bloqueo se publica ANTES de borrar: ninguna transferencia común puede incorporarse durante la limpieza.
  const result = await resetAdminSystem(env);
  if (Number(result.failed || 0) > 0) {
    throw new HttpError(502, "exclusive-cleanup-incomplete", "No se confirmó el almacenamiento vacío. Hopper seguirá bloqueado; reintenta la limpieza.");
  }
  const pendingCleanup = await abortB2MultipartByPrefix(env,"drop/");
  if (pendingCleanup.failed) throw new HttpError(502,"exclusive-multipart-cleanup","B2 no confirmó la cancelación de todas las subidas pendientes. Hopper seguirá bloqueado.");
  await resetSecurityState(env.DB, client, "exclusive-mode-start");
  await env.DB.prepare("UPDATE exclusive_mode SET status='active' WHERE id=1 AND status='preparing'").run();
  const version = await getSessionVersion(env.DB);
  const token = await createSessionToken(env.SESSION_SECRET, version);
  return { ...publicExclusiveStatus(await getExclusiveMode(env)), token, expiresIn: SESSION_TTL_SECONDS };
}

async function item(env: Env, id: string): Promise<UploadRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "invalid-id", "Archivo no válido.");
  const row = await env.DB.prepare("SELECT * FROM exclusive_uploads WHERE id=?1").bind(id).first<UploadRow>();
  if (!row) throw new HttpError(404, "exclusive-file-not-found", "El archivo no existe.");
  return row;
}

export async function listExclusiveFiles(env: Env) {
  const result = await env.DB.prepare("SELECT id,name,size,mime_type,status,created_at FROM exclusive_uploads ORDER BY created_at DESC LIMIT 200").all();
  return result.results || [];
}

export async function initiateExclusiveUpload(env: Env, input: { name: string; size: number; mimeType: string }) {
  await requireExclusiveActive(env);
  const name = String(input.name || "archivo").replace(/[\\/\x00-\x1f\x7f]/g, "-").trim().slice(0,180) || "archivo";
  const size = Number(input.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > EXCLUSIVE_LIMIT) throw new HttpError(413, "exclusive-size", "El archivo debe ocupar entre 1 byte y 10 GiB.");
  const id = crypto.randomUUID();
  const key = `drop/super/${id}/${encodeURIComponent(name)}`;
  // Reserva atómica para impedir el sobreconsumo incluso si el usuario agrega archivos simultáneos.
  const result = await env.DB.prepare(`INSERT INTO exclusive_uploads(id,name,size,mime_type,storage_key,status,created_at)
    SELECT ?1,?2,?3,?4,?5,'pending',?6 WHERE
    (SELECT status FROM exclusive_mode WHERE id=1)='active' AND
    (SELECT expires_at FROM exclusive_mode WHERE id=1)>?6 AND
    COALESCE((SELECT SUM(size) FROM exclusive_uploads),0) + ?3 <= ?7`)
    .bind(id,name,size,String(input.mimeType||"application/octet-stream").slice(0,160),key,new Date().toISOString(),EXCLUSIVE_LIMIT).run();
  if (Number(result.meta?.changes || 0) !== 1) throw new HttpError(409, "exclusive-capacity", "No queda capacidad reservable en esta sesión.");
  try {
    const uploadId = await createB2Multipart(env,key);
    await env.DB.prepare("UPDATE exclusive_uploads SET upload_id=?2 WHERE id=?1").bind(id,uploadId).run();
    return {id,name,size,chunkSize:EXCLUSIVE_CHUNK,partCount:Math.ceil(size/EXCLUSIVE_CHUNK)};
  } catch(error) {
    await env.DB.prepare("DELETE FROM exclusive_uploads WHERE id=?1").bind(id).run();
    throw error;
  }
}

export async function signExclusivePart(env: Env, id: string, partNumber: number) {
  await requireExclusiveActive(env);
  const row = await item(env,id);
  if (row.status !== "pending" || !row.upload_id) throw new HttpError(409,"exclusive-not-pending","Esta carga no admite más fragmentos.");
  const count = Math.ceil(row.size/EXCLUSIVE_CHUNK);
  if (!Number.isInteger(partNumber) || partNumber<1 || partNumber>count) throw new HttpError(400,"invalid-part","Número de fragmento incorrecto.");
  const url = await createSignedB2Url(env,{method:"PUT",objectName:row.storage_key,expiresSeconds:UPLOAD_URL_TTL_SECONDS,queryParameters:{uploadId:row.upload_id,partNumber}});
  return {url,partNumber};
}

export async function completeExclusiveUpload(env: Env,id:string,parts:Array<{partNumber:number;etag:string}>) {
  await requireExclusiveActive(env);
  const row=await item(env,id);
  if (row.status!=="pending"||!row.upload_id) throw new HttpError(409,"exclusive-not-pending","La carga ya fue publicada o cancelada.");
  const required=Math.ceil(row.size/EXCLUSIVE_CHUNK);
  if (parts.length!==required || parts.some((p,i)=>p.partNumber!==i+1 || !/^\"?[a-f0-9]{32}(?:-\d+)?\"?$/i.test(p.etag))) throw new HttpError(400,"invalid-parts","La lista de fragmentos no coincide.");
  const claimed=await env.DB.prepare("UPDATE exclusive_uploads SET status='completing' WHERE id=?1 AND status='pending'").bind(id).run();
  if (Number(claimed.meta?.changes||0)!==1) throw new HttpError(409,"exclusive-busy","El archivo ya se está cerrando.");
  try {
    await completeB2Multipart(env,row.storage_key,row.upload_id,parts);
    const metadata=await getB2ObjectMetadata(env,row.storage_key);
    if (!metadata || metadata.size!==row.size) throw new HttpError(502,"exclusive-size-mismatch","B2 no confirmó el tamaño correcto; la sesión permanece bloqueada.");
    await env.DB.prepare("UPDATE exclusive_uploads SET status='ready' WHERE id=?1").bind(id).run();
    return {id,status:"ready"};
  } catch(error) {
    // Un fallo de red tras completar puede haber publicado el objeto; se requiere verificación, no reintentar a ciegas.
    const metadata=await getB2ObjectMetadata(env,row.storage_key).catch(()=>null);
    if (metadata?.size===row.size) {
      await env.DB.prepare("UPDATE exclusive_uploads SET status='ready' WHERE id=?1").bind(id).run();
      return {id,status:"ready"};
    }
    await env.DB.prepare("UPDATE exclusive_uploads SET status='pending' WHERE id=?1").bind(id).run();
    throw error;
  }
}

export async function exclusiveDownload(env:Env,id:string) {
  await requireExclusiveActive(env);
  const row=await item(env,id);
  if(row.status!=="ready")throw new HttpError(409,"exclusive-not-ready","Archivo pendiente de publicación.");
  return {url:await createSignedB2Url(env,{method:"GET",objectName:row.storage_key,expiresSeconds:DOWNLOAD_URL_TTL_SECONDS}),name:row.name};
}

export async function removeExclusiveFile(env:Env,id:string) {
  await requireExclusiveActive(env);
  const row=await item(env,id);
  if(row.upload_id && row.status!=="ready") await abortB2Multipart(env,row.storage_key,row.upload_id);
  const result=await listB2VersionsByPrefix(env,row.storage_key,2);
  if(result.truncated)throw new HttpError(502,"exclusive-delete-incomplete","La limpieza no pudo verificar todas las versiones.");
  for(const version of result.entries.filter(x=>x.key===row.storage_key)) await deleteB2Version(env,version.key,version.versionId);
  await env.DB.prepare("DELETE FROM exclusive_uploads WHERE id=?1").bind(id).run();
  return {removed:true};
}

export async function closeExclusiveMode(env:Env) {
  const mode=await getExclusiveMode(env);
  if(!mode)return {active:false,failed:0};
  if (mode.status === "preparing") {
    // Nunca liberar un sistema cuya limpieza de las transferencias comunes falló.
    const reset = await resetAdminSystem(env);
    if (Number(reset.failed || 0) > 0) return {active:true, failed:Number(reset.failed || 1)};
    try { const pendingCleanup=await abortB2MultipartByPrefix(env,"drop/"); if(pendingCleanup.failed)return {active:true,failed:pendingCleanup.failed}; }
    catch { return {active:true,failed:1}; }
  }
  await env.DB.prepare("UPDATE exclusive_mode SET status='closing' WHERE id=1 AND status!='inactive'").run();
  let failures=0;
  const all=await env.DB.prepare("SELECT * FROM exclusive_uploads").all<UploadRow>();
  for(const row of all.results||[]) {
    if(row.upload_id && row.status!=="ready") {
      try { await abortB2Multipart(env,row.storage_key,row.upload_id); } catch {failures++;}
    }
  }
  try {
    const pendingCleanup=await abortB2MultipartByPrefix(env,"drop/super/");
    failures += pendingCleanup.failed;
    const listing=await listB2VersionsByPrefix(env,"drop/super/",50);
    if(listing.truncated)failures++;
    for(const entry of listing.entries) {
      try{await deleteB2Version(env,entry.key,entry.versionId);}catch{failures++;}
    }
    const check=await listB2VersionsByPrefix(env,"drop/super/",2);
    if(check.truncated||check.entries.length>0)failures++;
  }catch{failures++;}
  if(failures)return {active:true,failed:failures}; // fail closed; se reintenta por CRON/admin
  await env.DB.prepare("DELETE FROM exclusive_uploads").run();
  await env.DB.prepare("UPDATE exclusive_mode SET status='inactive',ended_at=?1 WHERE id=1").bind(new Date().toISOString()).run();
  await env.DB.prepare("UPDATE session_state SET version=version+1,updated_at=?1 WHERE id=1").bind(new Date().toISOString()).run();
  return {active:false,failed:0};
}

export async function maybeCloseExclusiveMode(env:Env) {
  const mode=await getExclusiveMode(env);
  if(mode && (mode.status==='closing' || Date.parse(mode.expires_at)<=Date.now()))return closeExclusiveMode(env);
  return {skipped:true};
}
