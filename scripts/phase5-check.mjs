import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const production = JSON.parse((await readFile(resolve(root, "config/production.json"), "utf8")).replace(/^\uFEFF/, ""));
const required = [
  "index.html",
  "config/production.json",
  "public/_headers",
  "src/main.tsx",
  "src/sw.ts",
  "worker/wrangler.jsonc",
  "worker/migrations/0001_baseline.sql",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy-frontend.yml",
  ".github/workflows/deploy-worker.yml",
  ".github/workflows/legacy-github-pages-redirect.yml"
];

for (const relative of required) {
  await access(resolve(root, relative), constants.R_OK);
}

const index = await readFile(resolve(root, "index.html"), "utf8");
if (!index.includes('id="root"') || !index.includes('/src/main.tsx')) {
  throw new Error("index.html no es la entrada final de la SPA React.");
}

const vite = await readFile(resolve(root, "vite.config.ts"), "utf8");
if (vite.includes("js/config.js") || vite.includes("modern/index.html")) {
  throw new Error("vite.config.ts todavía depende de la estructura legacy.");
}

const workerConfig = await readFile(resolve(root, "worker/wrangler.jsonc"), "utf8");
if (!workerConfig.includes('"d1_databases"') || !workerConfig.includes('"migrations_dir"')) {
  throw new Error("worker/wrangler.jsonc no contiene el binding D1 formal.");
}

if (!production.pagesProjectName || !production.workerBaseUrl || !production.publicAppUrl) {
  throw new Error("config/production.json está incompleto.");
}

const transitionalObsolete = [
  "modern",
  "scripts/serve-legacy.mjs",
  ".github/workflows/preview-frontend.yml",
  "tests/e2e/phase-three-pwa.spec.ts",
  "tests/e2e/visual-regression.spec.ts",
  "tests/unit/layout-parity.test.tsx",
  "tests/unit/style-freeze.test.ts"
];

async function assertAbsent(paths, kind) {
  for (const relative of paths) {
    try {
      await access(resolve(root, relative), constants.F_OK);
      throw new Error(`Todavía existe un artefacto ${kind}: ${relative}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

await assertAbsent(transitionalObsolete, "transitorio");

if (process.argv.includes("--post-cleanup")) {
  await assertAbsent([
    "admin.html",
    "recover.html",
    "room.html",
    "share-target.html",
    "service-worker.js",
    "manifest.webmanifest",
    "css",
    "js",
    "public/assets"
  ], "legacy");
}

console.log("Fase 5: estructura final válida.");