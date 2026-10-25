import { z } from "zod";
import { request } from "./client";

const base = "/api/admin/super";
const anyResponse = z.object({ ok: z.boolean() }).passthrough();
const fileSchema = z.object({ id: z.string(), name: z.string(), size: z.number(), mime_type: z.string(), status: z.string(), created_at: z.string() });
const statusSchema = anyResponse.extend({ active: z.boolean(), status: z.string(), expiresAt: z.string().nullable(), limitBytes: z.number(), files: z.array(fileSchema) });
const initSchema = anyResponse.extend({ upload: z.object({ id: z.string(), chunkSize: z.number(), partCount: z.number() }) });
const partSchema = anyResponse.extend({ url: z.string() });
const downloadSchema = anyResponse.extend({ url: z.string().url(), name: z.string() });
const startSchema = anyResponse.extend({ token: z.string(), expiresIn: z.number() });

export const exclusiveApi = {
  status: () => request(`${base}/status`, statusSchema, {auth:"personal"}),
  start: (currentPin: string, durationMinutes: number) => request(`${base}/start`, startSchema, {auth:"personal",method:"POST",body:{currentPin,confirmation:"BORRAR TODO Y BLOQUEAR",durationMinutes}}),
  retry: (currentPin: string) => request(`${base}/retry`,startSchema,{auth:"personal",method:"POST",body:{currentPin,confirmation:"REINTENTAR LIMPIEZA"}}),
  end: (currentPin: string) => request(`${base}/end`,anyResponse,{auth:"personal",method:"POST",body:{currentPin,confirmation:"FINALIZAR CARGA"}}),
  init: (file: File) => request(`${base}/uploads`,initSchema,{auth:"personal",method:"POST",body:{name:file.name,size:file.size,mimeType:file.type||"application/octet-stream"}}),
  part: (id: string, partNumber: number) => request(`${base}/uploads/${encodeURIComponent(id)}/part`,partSchema,{auth:"personal",method:"POST",body:{partNumber}}),
  complete: (id: string, parts: Array<{partNumber:number;etag:string}>) => request(`${base}/uploads/${encodeURIComponent(id)}/complete`,anyResponse,{auth:"personal",method:"POST",body:{parts}}),
  download: (id: string) => request(`${base}/uploads/${encodeURIComponent(id)}/url`,downloadSchema,{auth:"personal"}),
  remove: (id: string) => request(`${base}/uploads/${encodeURIComponent(id)}`,anyResponse,{auth:"personal",method:"DELETE"})
};

// Los fragmentos no cruzan el Worker: PUT directo con URL SigV4 de duración limitada.
export async function multipartUpload(file: File, onProgress: (bytes:number)=>void): Promise<void> {
  const {upload}=await exclusiveApi.init(file);
  const parts:Array<{partNumber:number;etag:string}>=[];
  for(let index=0;index<upload.partCount;index++){
    const partNumber=index+1;
    const start=index*upload.chunkSize;
    const chunk=file.slice(start,Math.min(file.size,start+upload.chunkSize));
    let lastError: unknown;
    for(let attempt=0;attempt<3;attempt++){
      try {
        const {url}=await exclusiveApi.part(upload.id,partNumber);
        const response=await fetch(url,{method:"PUT",body:chunk});
        if(!response.ok)throw new Error(`B2 rechazó el fragmento ${partNumber} (${response.status}).`);
        const etag=response.headers.get("ETag");
        if(!etag)throw new Error("B2 no expone ETag; comprueba la configuración CORS del bucket.");
        parts.push({partNumber,etag});
        onProgress(start+chunk.size);
        lastError=undefined;
        break;
      }catch(error){lastError=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,600*(attempt+1)));}
    }
    if(lastError)throw lastError;
  }
  await exclusiveApi.complete(upload.id,parts);
}
