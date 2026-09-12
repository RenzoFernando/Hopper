import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { SEO_PAGES, renderLlms, renderRobots, renderSeoPage, renderSitemap } from "./seo-pages.mjs";

const rootDir = resolve(".");
const distDir = resolve("dist");
const productionConfigPath = resolve("config", "production.json");
const productionConfig = JSON.parse((await readFile(productionConfigPath, "utf8")).replace(/^\uFEFF/, ""));
async function readLocalEnv() {
  const values = {};
  for (const filename of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    const path = resolve(rootDir, filename);
    try {
      await access(path);
    } catch {
      continue;
    }
    const source = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
  }
  return values;
}

const buildEnv = await readLocalEnv();
const ga4MeasurementId = String(process.env.VITE_GA_MEASUREMENT_ID || buildEnv.VITE_GA_MEASUREMENT_ID || "").trim();
const gscVerification = String(process.env.VITE_GSC_VERIFICATION || buildEnv.VITE_GSC_VERIFICATION || "").trim();

function originOf(value, label) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    throw new Error(`${label} no contiene una URL válida.`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validGa4(value) {
  return !value || /^G-[A-Z0-9]+$/i.test(value);
}

function validGsc(value) {
  return !value || /^[A-Za-z0-9_-]+$/.test(value);
}

if (!validGa4(ga4MeasurementId)) {
  throw new Error("VITE_GA_MEASUREMENT_ID no tiene el formato esperado de GA4 (G-XXXXXXXXXX).");
}
if (!validGsc(gscVerification)) {
  throw new Error("VITE_GSC_VERIFICATION contiene caracteres no válidos.");
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

const indexPath = resolve(distDir, "index.html");
let indexHtml = await readFile(indexPath, "utf8");
indexHtml = indexHtml.replaceAll("__HOPPER_GA4_ID__", escapeHtml(ga4MeasurementId));
if (gscVerification) {
  indexHtml = indexHtml.replace(
    /(<meta name="robots"[^>]*>)/,
    `$1\n    <meta name="google-site-verification" content="${escapeHtml(gscVerification)}">`
  );
}
await writeFile(indexPath, indexHtml, "utf8");

for (const page of SEO_PAGES) {
  const filename = `${page.path.replace(/^\//, "")}.html`;
  await writeFile(resolve(distDir, filename), renderSeoPage(page, { ga4MeasurementId, gscVerification }), "utf8");
}

await writeFile(resolve(distDir, "robots.txt"), renderRobots(), "utf8");
await writeFile(resolve(distDir, "sitemap.xml"), renderSitemap(), "utf8");
await writeFile(resolve(distDir, "llms.txt"), renderLlms(), "utf8");

// Evita que residuos de builds antiguos terminen dentro del artefacto de Pages.
await rm(resolve(distDir, "modern"), { recursive: true, force: true });

async function listBuildFiles(directory) {
  const files = [];

  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (entry.isFile() && entry.name !== "version.json") files.push(absolute);
    }
  }

  await visit(directory);
  return files.sort((a, b) => a.localeCompare(b));
}

async function writeBuildVersion() {
  const hash = createHash("sha256");
  const files = await listBuildFiles(distDir);

  for (const file of files) {
    const name = relative(distDir, file).replaceAll("\\", "/");
    hash.update(name);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }

  const buildId = hash.digest("hex").slice(0, 24);
  await writeFile(
    resolve(distDir, "version.json"),
    `${JSON.stringify({ app: "Hopper", buildId }, null, 2)}\n`,
    "utf8"
  );
}

await writeBuildVersion();
