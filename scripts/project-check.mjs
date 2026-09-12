import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const production = JSON.parse((await readFile(resolve(root, "config/production.json"), "utf8")).replace(/^\uFEFF/, ""));
const required = [
  "index.html",
  "config/production.json",
  "public/_headers",
  "public/robots.txt",
  "public/sitemap.xml",
  "public/llms.txt",
  "public/seo.css",
  "public/seo-runtime.js",
  "assets/hopper-transferencia-archivos.svg",
  "scripts/seo-pages.mjs",
  "scripts/configure-pages-production.mjs",
  ".env.example",
  "src/main.tsx",
  "src/sw.ts",
  "src/styles/styles.css",
  "src/styles/foundation.css",
  "src/styles/auth.css",
  "src/styles/transfers.css",
  "src/styles/recovery.css",
  "src/styles/responsive-core.css",
  "src/styles/navigation.css",
  "src/styles/admin.css",
  "src/styles/share.css",
  "src/styles/responsive-pages.css",
  "src/styles/rooms.css",
  "worker/wrangler.jsonc",
  "worker/migrations/0001_baseline.sql",
  "worker/migrations/0002_product_tuning.sql",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy-frontend.yml",
  ".github/workflows/deploy-worker.yml"
];

for (const relative of required) {
  await access(resolve(root, relative), constants.R_OK);
}

const gitignore = await readFile(resolve(root, ".gitignore"), "utf8");
if (!/^!\.env\.example$/m.test(gitignore) || /^\.env\.example$/m.test(gitignore)) {
  throw new Error(".env.example debe quedar versionado: conserva .env.* pero añade !.env.example en .gitignore.");
}

const index = await readFile(resolve(root, "index.html"), "utf8");
if (!index.includes('id="root"') || !index.includes('/src/main.tsx')) {
  throw new Error("index.html no es la entrada final de la SPA React.");
}

const vite = await readFile(resolve(root, "vite.config.ts"), "utf8");
if (vite.includes("js/config.js") || vite.includes("modern/index.html")) {
  throw new Error("vite.config.ts depende de una estructura retirada.");
}

const robots = await readFile(resolve(root, "public/robots.txt"), "utf8");
if (!robots.includes("Disallow: /page/") || !robots.includes("Sitemap: https://hopper-transfer.pages.dev/sitemap.xml")) {
  throw new Error("robots.txt no contiene las reglas SEO requeridas.");
}

const sitemap = await readFile(resolve(root, "public/sitemap.xml"), "utf8");
for (const route of ["/transferir-archivos", "/compartir-texto", "/salas-temporales", "/seguridad"]) {
  if (!sitemap.includes(`https://hopper-transfer.pages.dev${route}`)) {
    throw new Error(`sitemap.xml no contiene la ruta pública ${route}.`);
  }
}

const seoPages = await readFile(resolve(root, "scripts/seo-pages.mjs"), "utf8");
if (!seoPages.includes('"@type": "FAQPage"') || seoPages.includes('"@type": "LocalBusiness"')) {
  throw new Error("La configuración SEO debe incluir FAQPage y evitar LocalBusiness no aplicable.");
}

const workerConfig = await readFile(resolve(root, "worker/wrangler.jsonc"), "utf8");
if (!workerConfig.includes('"d1_databases"') || !workerConfig.includes('"migrations_dir"')) {
  throw new Error("worker/wrangler.jsonc no contiene el binding D1 formal.");
}
if (workerConfig.includes("renzofernando.github.io") || workerConfig.includes("CLEAN_FRONTEND_URLS")) {
  throw new Error("worker/wrangler.jsonc todavía contiene compatibilidad del frontend retirado.");
}

if (production.pagesProjectName !== "hopper-transfer") {
  throw new Error("El proyecto de Cloudflare Pages debe ser hopper-transfer.");
}
if (production.productionBranch !== "master") {
  throw new Error("La rama de producción debe ser master.");
}
if (production.publicAppUrl !== "https://hopper-transfer.pages.dev/") {
  throw new Error("publicAppUrl debe apuntar al frontend actual de Cloudflare Pages.");
}

const obsolete = [
  "admin.html",
  "recover.html",
  "room.html",
  "share-target.html",
  "service-worker.js",
  "manifest.webmanifest",
  "css",
  "js",
  "modern",
  "public/assets",
  ".hopper-phase5-rollback.json",
  ".phase5-github-pages",
  "scripts/serve-legacy.mjs",
  "scripts/phase5-check.mjs",
  "scripts/build-legacy-redirect.mjs",
  ".github/workflows/preview-frontend.yml",
  ".github/workflows/legacy-github-pages-redirect.yml",
  "tests/e2e/phase-three-pwa.spec.ts",
  "tests/e2e/visual-regression.spec.ts",
  "tests/unit/layout-parity.test.tsx",
  "tests/unit/style-freeze.test.ts",
  "tests/unit/phase-five-production.test.ts",
  "tests/unit/phase-three-navigation.test.ts"
];

for (const relative of obsolete) {
  try {
    await access(resolve(root, relative), constants.F_OK);
    throw new Error(`Todavía existe un artefacto retirado: ${relative}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

try {
  const localConfigSource = await readFile(resolve(root, ".hopper-admin.json"), "utf8");
  const localConfig = JSON.parse(localConfigSource.replace(/^\uFEFF/, ""));
  for (const property of ["legacyPublicAppUrl", "cutoverComplete", "legacyRedirectVerified", "cleanFrontendUrls"]) {
    if (Object.hasOwn(localConfig, property)) {
      throw new Error(`.hopper-admin.json todavía contiene el campo retirado: ${property}`);
    }
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log("Estructura final de Hopper válida.");