import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TestD1 } from "./d1-test-helper.js";
import {
  initializeFileUpload,
  completeFileUpload,
  createItemDownloadUrl,
  isExpired,
  isPreviewableImage,
  normalizeTtlMinutes,
  sanitizeFilename
} from "../worker/src/services/items.ts";

test("normaliza únicamente los TTL disponibles", () => {
  assert.equal(normalizeTtlMinutes("5"), 5);
  assert.equal(normalizeTtlMinutes("15"), 15);
  assert.equal(normalizeTtlMinutes(30), 30);
  assert.equal(normalizeTtlMinutes(720), 720);
  assert.equal(normalizeTtlMinutes(1440), 1440);
  assert.equal(normalizeTtlMinutes(0), 0);
  assert.throws(() => normalizeTtlMinutes(10));
});

test("elimina rutas y caracteres de control del nombre", () => {
  assert.equal(sanitizeFilename("../carpeta\\reporte.zip"), "-carpeta-reporte.zip");
  assert.equal(sanitizeFilename("   informe   final.pdf   "), "informe final.pdf");
  assert.equal(sanitizeFilename("..."), "archivo");
});

test("detecta expiración con un reloj conocido", () => {
  const now = Date.UTC(2026, 8, 7, 20, 0, 0);
  assert.equal(isExpired({ expiresAt: new Date(now + 1000).toISOString() }, now), false);
  assert.equal(isExpired({ expiresAt: new Date(now).toISOString() }, now), true);
  assert.equal(isExpired({ expiresAt: "invalid" }, now), true);
  assert.equal(isExpired({ expiresAt: null, ttlMinutes: 0 }, now), false);
});


test("el límite personal de 512 MB no puede ampliarse desde configuración", async () => {
  await assert.rejects(
    () => initializeFileUpload(
      { MAX_FILE_BYTES: String(1024 * 1024 * 1024) },
      { name: "demasiado.bin", size: 512 * 1024 * 1024 + 1, mimeType: "application/octet-stream", ttlMinutes: 5 }
    ),
    (error) => error?.code === "file-too-large"
  );
});

test("solo permite vista previa de imágenes raster compatibles", () => {
  assert.equal(isPreviewableImage({ type: "file", mimeType: "image/png" }), true);
  assert.equal(isPreviewableImage({ type: "file", mimeType: "image/svg+xml" }), false);
  assert.equal(isPreviewableImage({ type: "file", mimeType: "application/pdf" }), false);
});

function metadataFixture() {
  const baseline = readFileSync(new URL("../worker/migrations/0001_baseline.sql", import.meta.url), "utf8");
  const tuning = readFileSync(new URL("../worker/migrations/0002_product_tuning.sql", import.meta.url), "utf8");
  const exclusive = readFileSync(new URL("../worker/migrations/0003_exclusive_transfer.sql", import.meta.url), "utf8");
  const db = new TestD1(`${baseline}\n${tuning}\n${exclusive}`);
  const env = {
    DB: db,
    B2_BUCKET_NAME: "hopper-test",
    B2_ENDPOINT: "https://s3.us-east-005.backblazeb2.com",
    B2_KEY_ID: "test-access-key",
    B2_APPLICATION_KEY: "test-secret-key",
    MAX_FILE_BYTES: String(512 * 1024 * 1024)
  };
  return { db, env };
}

function versionXml(key, size) {
  return `<?xml version="1.0"?><ListVersionsResult><IsTruncated>false</IsTruncated><Version><Key>${key}</Key><VersionId>version-ok</VersionId><IsLatest>true</IsLatest><ETag>&quot;etag-ok&quot;</ETag><Size>${size}</Size></Version></ListVersionsResult>`;
}

test("confirma una subida cuando HEAD falla y el listado de B2 verifica el tamaño", async () => {
  const { db, env } = metadataFixture();
  const originalFetch = globalThis.fetch;
  const methods = [];
  try {
    const upload = await initializeFileUpload(env, { name: "grabacion.m4a", size: 34700000, mimeType: "audio/mp4", ttlMinutes: 5 });
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      methods.push(options.method);
      if (options.method === "HEAD") return new Response(null, { status: 403 });
      if (options.method === "GET") return new Response(versionXml(parsed.searchParams.get("prefix"), 34700000));
      throw Error("Método B2 inesperado");
    };
    const ready = await completeFileUpload(env, upload.id);
    assert.equal(ready.status, "ready");
    assert.deepEqual(methods, ["HEAD", "GET"]);
    methods.length = 0;
    const download = await createItemDownloadUrl(env, upload.id);
    assert.equal(methods.length, 0, "El enlace de descarga no debe depender de HEAD");
    assert.ok(download.url.includes("X-Amz-Signature="));
  } finally { globalThis.fetch = originalFetch; db.close(); }
});

test("un tamaño contradictorio no elimina el archivo y permite reintentar", async () => {
  const { db, env } = metadataFixture();
  const originalFetch = globalThis.fetch;
  let listedSize = 100;
  const methods = [];
  try {
    const upload = await initializeFileUpload(env, { name: "video.mp4", size: 10000, mimeType: "video/mp4", ttlMinutes: 5 });
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      methods.push(options.method);
      if (options.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": "100" } });
      if (options.method === "GET") return new Response(versionXml(parsed.searchParams.get("prefix"), listedSize));
      throw Error("No se debe eliminar un archivo por un tamaño ambiguo");
    };
    await assert.rejects(() => completeFileUpload(env, upload.id), (error) => error.code === "upload-size-mismatch");
    assert.equal((await db.prepare("SELECT status FROM drop_items WHERE id = ?1").bind(upload.id).first()).status, "pending");
    assert.equal(methods.includes("DELETE"), false);
    listedSize = 10000;
    assert.equal((await completeFileUpload(env, upload.id)).status, "ready");
  } finally { globalThis.fetch = originalFetch; db.close(); }
});
