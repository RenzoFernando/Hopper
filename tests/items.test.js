import test from "node:test";
import assert from "node:assert/strict";
import {
  isExpired,
  isPreviewableImage,
  normalizeTtlMinutes,
  sanitizeFilename
} from "../cloudflare/src/items.js";

test("normaliza únicamente los TTL disponibles", () => {
  assert.equal(normalizeTtlMinutes("15"), 15);
  assert.equal(normalizeTtlMinutes(30), 30);
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
});

test("solo permite vista previa de imágenes raster compatibles", () => {
  assert.equal(isPreviewableImage({ type: "file", mimeType: "image/png" }), true);
  assert.equal(isPreviewableImage({ type: "file", mimeType: "image/svg+xml" }), false);
  assert.equal(isPreviewableImage({ type: "file", mimeType: "application/pdf" }), false);
});
