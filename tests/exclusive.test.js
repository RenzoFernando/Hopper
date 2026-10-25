import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TestD1 } from "./d1-test-helper.js";
import { activateExclusiveMode, closeExclusiveMode, completeExclusiveUpload, EXCLUSIVE_CHUNK, EXCLUSIVE_LIMIT, extendExclusiveMode, getExclusiveMode, initiateExclusiveUpload, listExclusiveFiles, exclusiveUsage, publicExclusiveStatus, requireExclusiveActive, signExclusivePart } from "../worker/src/services/exclusive.ts";
import { getSessionVersion, createSessionToken } from "../worker/src/services/security.ts";
import worker from "../worker/src/index.ts";
const root = new URL("../worker/migrations/",import.meta.url);
const schema=["0001_baseline.sql","0002_product_tuning.sql","0003_exclusive_transfer.sql"].map(file=>readFileSync(new URL(file,root),"utf8")).join("\n");
const client={ip:"198.51.100.30",country:"CO",userAgent:"Hopper tests"};
const name="drop/super/";

function mockB2(objects) {
  return async (input,init={})=>{
    const url=new URL(String(input));const method=init.method||"GET";
    if(method==="GET" && url.searchParams.has("uploads"))return new Response("<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>",{status:200});
    if(url.searchParams.has("uploads"))return new Response("<InitiateMultipartUploadResult><UploadId>upload-test-1</UploadId></InitiateMultipartUploadResult>",{status:200});
    if(method==="POST"&&url.searchParams.has("uploadId")){
      objects.add(decodeURIComponent(url.pathname.split('/').slice(2).join('/')));
      return new Response("<CompleteMultipartUploadResult><ETag>ok</ETag></CompleteMultipartUploadResult>",{status:200});
    }
    if(method==="GET"&&url.searchParams.has("versions")){
      const prefix=url.searchParams.get("prefix")||"";
      const versions=[...objects].filter(key=>key.startsWith(prefix)).map(key=>`<Version><Key>${key}</Key><VersionId>test-version-1</VersionId><IsLatest>true</IsLatest><Size>${EXCLUSIVE_CHUNK+4}</Size></Version>`).join('');
      return new Response(`<ListVersionsResult><IsTruncated>false</IsTruncated>${versions}</ListVersionsResult>`,{status:200});
    }
    if(method==="DELETE"){
      if(!url.searchParams.has("uploadId")){objects.delete(decodeURIComponent(url.pathname.split('/').slice(2).join('/')));}
      return new Response(null,{status:204});
    }
    throw new Error(`Unexpected B2 ${method} ${url}`);
  };
}

test("el modo exclusivo bloquea por D1, limpia, renueva sesión y usa multipartes",async()=>{
  const db=new TestD1(schema);
  const env={DB:db,SESSION_SECRET:"secret-2026-very-long-test-secret-abcdef1234567890",B2_BUCKET_NAME:"hopper-test",B2_ENDPOINT:"https://s3.us-east-005.backblazeb2.com",B2_KEY_ID:"testkey",B2_APPLICATION_KEY:"test-application-key-not-a-real-key"};
  const originalFetch=globalThis.fetch;
  const objects=new Set(); globalThis.fetch=mockB2(objects);
  try{
    assert.equal(publicExclusiveStatus(await getExclusiveMode(env)).active,false);
    await assert.rejects(requireExclusiveActive(env),e=>e.status===423);
    const originalVersion=await getSessionVersion(db);
    const started=await activateExclusiveMode(env,60,client);
    assert.equal(started.status,"active");assert.equal(typeof started.token,"string");
    assert.equal(await getSessionVersion(db),originalVersion+1);
    await assert.rejects(activateExclusiveMode(env,60,client),e=>e.status===409);
    const upload=await initiateExclusiveUpload(env,{name:"prueba.bin",size:EXCLUSIVE_CHUNK+4,mimeType:"application/octet-stream"});
    assert.equal(upload.partCount,2);
    const part=await signExclusivePart(env,upload.id,2);
    assert.equal(new URL(part.url).searchParams.get("partNumber"),"2");
    await assert.rejects(signExclusivePart(env,upload.id,3),e=>e.status===400);
    const etag="a".repeat(32);
    await completeExclusiveUpload(env,upload.id,[{partNumber:1,etag},{partNumber:2,etag}]);
    const files=await listExclusiveFiles(env);
    assert.equal(files.length,1);assert.equal(files[0].status,"ready");
    const ended=await closeExclusiveMode(env);
    assert.equal(ended.active,false);
    assert.equal((await getExclusiveMode(env)),null);
    assert.equal((await listExclusiveFiles(env)).length,0);
    assert.equal(await getSessionVersion(db),originalVersion+2);
  }finally{globalThis.fetch=originalFetch;db.close();}
});

test("la reserva atómica limita a 10 GB entre todos los archivos",async()=>{
  const db=new TestD1(schema);
  const env={DB:db,SESSION_SECRET:"secret-2026-very-long-test-secret-abcdef1234567890",B2_BUCKET_NAME:"hopper-test",B2_ENDPOINT:"https://s3.us-east-005.backblazeb2.com",B2_KEY_ID:"testkey",B2_APPLICATION_KEY:"test-application-key-not-a-real-key"};
  const originalFetch=globalThis.fetch;globalThis.fetch=mockB2(new Set());
  try{
    await activateExclusiveMode(env,60,client);
    const u=await initiateExclusiveUpload(env,{name:"gigante.bin",size:EXCLUSIVE_LIMIT,mimeType:"application/octet-stream"});
    assert.ok(u.id);
    await assert.rejects(initiateExclusiveUpload(env,{name:"extra.bin",size:1,mimeType:"application/octet-stream"}),e=>e.status===409);
  }finally{globalThis.fetch=originalFetch;db.close();}
});

test("la duración puede actualizarse mientras el bloqueo permanece activo", async () => {
  const db = new TestD1(schema);
  const env = { DB: db, SESSION_SECRET: "secret-2026-very-long-test-secret-abcdef1234567890", B2_BUCKET_NAME: "hopper-test", B2_ENDPOINT: "https://s3.us-east-005.backblazeb2.com", B2_KEY_ID: "testkey", B2_APPLICATION_KEY: "test-application-key-not-a-real-key" };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockB2(new Set());
  try {
    const started = await activateExclusiveMode(env, 60, client);
    const previousExpiry = started.expiresAt;
    const longer = await extendExclusiveMode(env, 720);
    assert.equal(longer.status, "active");
    assert.ok(Date.parse(longer.expiresAt) > Date.parse(previousExpiry));
    assert.equal((await getExclusiveMode(env)).status, "active");
    await assert.rejects(extendExclusiveMode(env, 0), error => error.status === 400);
    await closeExclusiveMode(env);
    await assert.rejects(extendExclusiveMode(env, 60), error => error.status === 423);
  } finally { globalThis.fetch = oldFetch; db.close(); }
});

test("la descarga firmada obliga al navegador a descargar como adjunto", async () => {
  const db = new TestD1(schema);
  const env = { DB: db, SESSION_SECRET: "secret-2026-very-long-test-secret-abcdef1234567890", B2_BUCKET_NAME: "hopper-test", B2_ENDPOINT: "https://s3.us-east-005.backblazeb2.com", B2_KEY_ID: "testkey", B2_APPLICATION_KEY: "test-application-key-not-a-real-key" };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockB2(new Set());
  try {
    await activateExclusiveMode(env, 60, client);
    const upload = await initiateExclusiveUpload(env, { name: "informe 2026.pdf", size: EXCLUSIVE_CHUNK + 4, mimeType: "application/pdf" });
    const etag = "a".repeat(32);
    await completeExclusiveUpload(env, upload.id, [{ partNumber: 1, etag }, { partNumber: 2, etag }]);
    const { exclusiveDownload } = await import("../worker/src/services/exclusive.ts");
    const { url } = await exclusiveDownload(env, upload.id);
    const query = new URL(url).searchParams;
    assert.match(query.get("response-content-disposition") || "", /^attachment;/);
    assert.match(query.get("response-content-disposition") || "", /informe%202026.pdf/);
    assert.equal(query.get("response-content-type"), "application/octet-stream");
    assert.ok(query.get("X-Amz-Signature"));
  } finally { globalThis.fetch = oldFetch; db.close(); }
});

test("un fallo de B2 al vaciar conserva el bloqueo hasta una limpieza confirmada",async()=>{
  const db=new TestD1(schema);
  const env={DB:db,SESSION_SECRET:"secret-2026-very-long-test-secret-abcdef1234567890",B2_BUCKET_NAME:"hopper-test",B2_ENDPOINT:"https://s3.us-east-005.backblazeb2.com",B2_KEY_ID:"testkey",B2_APPLICATION_KEY:"test-application-key-not-a-real-key"};
  const oldFetch=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response("Storage temporarily unavailable",{status:503});
    await assert.rejects(activateExclusiveMode(env,60,client),e=>e.status===502);
    assert.equal((await getExclusiveMode(env)).status,"preparing");
    const failed=await closeExclusiveMode(env);
    assert.equal(failed.active,true);
    assert.equal((await getExclusiveMode(env)).status,"preparing");
    globalThis.fetch=mockB2(new Set());
    const ended=await closeExclusiveMode(env);
    assert.equal(ended.active,false);
    assert.equal(await getExclusiveMode(env),null);
  }finally {globalThis.fetch=oldFetch;db.close();}
});

test("si falla la eliminación final, el sistema no se reabre",async()=>{
  const db=new TestD1(schema);
  const env={DB:db,SESSION_SECRET:"secret-2026-very-long-test-secret-abcdef1234567890",B2_BUCKET_NAME:"hopper-test",B2_ENDPOINT:"https://s3.us-east-005.backblazeb2.com",B2_KEY_ID:"testkey",B2_APPLICATION_KEY:"test-application-key-not-a-real-key"};
  const oldFetch=globalThis.fetch;
  const objects=new Set();globalThis.fetch=mockB2(objects);
  try {
    await activateExclusiveMode(env,60,client);
    objects.add("drop/super/object-test");
    globalThis.fetch=async(input,init={})=>{
      if(init.method==="DELETE")return new Response("No",{status:503});
      return mockB2(objects)(input,init);
    };
    const failed=await closeExclusiveMode(env);
    assert.equal(failed.active,true);
    assert.equal((await getExclusiveMode(env)).status,"closing");
    globalThis.fetch=mockB2(objects);
    const ended=await closeExclusiveMode(env);
    assert.equal(ended.active,false);
    assert.equal(objects.size,0);
  }finally{globalThis.fetch=oldFetch;db.close();}
});


test("la API exclusiva responde con el esquema migrado sin borrar datos", async () => {
  const db = new TestD1(schema);
  const env = { DB: db, SESSION_SECRET: "secret-2026-very-long-test-secret-abcdef1234567890" };
  try {
    const publicResponse = await worker.fetch(new Request("https://hopper-api.test/api/exclusive/status"), env);
    assert.equal(publicResponse.status, 200);
    assert.equal((await publicResponse.json()).active, false);
    const token = await createSessionToken(env.SESSION_SECRET, await getSessionVersion(db));
    const adminResponse = await worker.fetch(new Request("https://hopper-api.test/api/admin/super/status", {
      headers: { Authorization: `Bearer ${token}`, "CF-Connecting-IP": "198.51.100.35" }
    }), env);
    assert.equal(adminResponse.status, 200);
    assert.deepEqual((await adminResponse.json()).files, []);
  } finally { db.close(); }
});

test("la cuota real comprende todos los archivos aunque la lista tenga 200 filas", async () => {
  const db = new TestD1(schema);
  try {
    const env = { DB: db };
    for (let i = 0; i < 201; i += 1) {
      await db.prepare(`INSERT INTO exclusive_uploads (id,name,size,mime_type,storage_key,status,created_at)
        VALUES (?1,?2,?3,'application/octet-stream',?4,'ready',?5)`)
        .bind(crypto.randomUUID(), `archivo-${i}`, 1_000, `drop/super/test-${i}`, new Date(Date.now() + i).toISOString()).run();
    }
    const files = await listExclusiveFiles(env);
    const usage = await exclusiveUsage(env);
    assert.equal(files.length, 200);
    assert.deepEqual(usage, { fileCount: 201, usedBytes: 201_000 });
  } finally { db.close(); }
});
