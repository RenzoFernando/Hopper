import test from "node:test";
import assert from "node:assert/strict";
import {
  initializeFileUpload,
  isExpired,
  isPreviewableImage,
  normalizeTtlMinutes,
  sanitizeFilename
} from "../worker/src/services/items.ts";

test("normaliza únicamente los TTL disponibles", () => {
  assert.equal(normalizeTtlMinutes("5"), 5);
  assert.equal(normalizeTtlMinutes("15"), 15);
  assert.equal(normalizeTtlMinutes(30), 30);
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
