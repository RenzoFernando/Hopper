import { createHash } from "node:crypto";

/**
 * Identifica el Service Worker generado por Vite. Se compara el archivo exacto
 * para detectar tanto una versión anterior como un script distinto con el
 * mismo nombre de caché.
 */
export function inspectServiceWorkerAsset(bytes) {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const source = content.toString("utf8");
  const names = [...new Set(source.match(/\bhopper-shell-v\d+\b/g) || [])];

  if (names.length !== 1) {
    throw new Error("El Service Worker no declara una versión de caché Hopper única.");
  }

  return {
    cacheName: names[0],
    sha256: createHash("sha256").update(content).digest("hex")
  };
}

export function compareServiceWorkerAssets(expected, received) {
  if (expected.cacheName !== received.cacheName) {
    return {
      matches: false,
      detail: `caché local ${expected.cacheName}; caché remota ${received.cacheName}`
    };
  }

  if (expected.sha256 !== received.sha256) {
    return {
      matches: false,
      detail: `contenido diferente para ${expected.cacheName} (SHA-256 local ${expected.sha256.slice(0, 12)}, remoto ${received.sha256.slice(0, 12)})`
    };
  }

  return { matches: true, detail: expected.cacheName };
}
