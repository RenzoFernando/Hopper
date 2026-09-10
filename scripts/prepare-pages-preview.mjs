import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const distDir = resolve("dist");
const productionConfigPath = resolve("config", "production.json");
const productionConfig = JSON.parse((await readFile(productionConfigPath, "utf8")).replace(/^\uFEFF/, ""));

function originOf(value, label) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    throw new Error(`${label} no contiene una URL válida.`);
  }
}

const workerOrigin = originOf(productionConfig.workerBaseUrl, "workerBaseUrl");
const b2Origin = originOf(productionConfig.b2Endpoint, "b2Endpoint");

await mkdir(resolve(distDir, "assets"), { recursive: true });
await cp(resolve("assets"), resolve(distDir, "assets"), { recursive: true, force: true });

const headersPath = resolve(distDir, "_headers");
let headers = await readFile(headersPath, "utf8");
headers = headers
  .replaceAll("__HOPPER_WORKER_ORIGIN__", workerOrigin)
  .replaceAll("__HOPPER_B2_ORIGIN__", b2Origin);
await writeFile(headersPath, headers, "utf8");

// Elimina residuos de builds de la estructura temporal usada durante Fase 3.
await rm(resolve(distDir, "modern"), { recursive: true, force: true });