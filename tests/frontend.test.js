import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path).replace(/^\uFEFF/, ""));

test("la entrada raíz es la SPA React definitiva", () => {
  const html = read("index.html");
  assert.match(html, /id="root"/);
  assert.match(html, /src="\/src\/main\.tsx"/);
  assert.doesNotMatch(html, /js\/app\.js|css\/styles\.css/);
});

test("Vite depende únicamente de la configuración de producción actual", () => {
  const vite = read("vite.config.ts");
  assert.match(vite, /config\/production\.json/);
  assert.doesNotMatch(vite, /js\/config\.js|modern\/index\.html/);
  assert.match(vite, /action:\s*"\/share"/);
});

test("la configuración pública apunta solo a Cloudflare Pages actual", () => {
  const config = readJson("config/production.json");
  assert.equal(config.pagesProjectName, "hopper-transfer");
  assert.equal(config.productionBranch, "master");
  assert.equal(config.publicAppUrl, "https://hopper-transfer.pages.dev/");
  assert.match(config.workerBaseUrl, /^https:\/\/.+\.workers\.dev$/);
  assert.equal("legacyPublicAppUrl" in config, false);
  assert.equal("cutoverComplete" in config, false);
  assert.equal("legacyRedirectVerified" in config, false);
});

test("Cloudflare Pages recibe headers endurecidos con orígenes explícitos", () => {
  const headers = read("public/_headers");
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Referrer-Policy: no-referrer/);
  assert.match(headers, /Permissions-Policy:/);
  assert.match(headers, /__HOPPER_WORKER_ORIGIN__/);
  assert.match(headers, /__HOPPER_B2_ORIGIN__/);
  assert.doesNotMatch(headers, /connect-src[^\r\n]*\*/);
});

test("el Service Worker conserva rutas limpias, Share Target y fallback offline", () => {
  const sw = read("src/sw.ts");
  assert.match(sw, /url\.pathname === "\/share"/);
  assert.match(sw, /event\.request\.mode === "navigate"/);
  assert.match(sw, /hopper-share-target-v1/);
  assert.match(sw, /\/manifest\.webmanifest/);
});

test("el router expone solo las rutas actuales", () => {
  const router = read("src/app/router.tsx");
  for (const route of ["/", "/space", "/admin", "/room/:code", "/recover", "/share"]) {
    assert.match(router, new RegExp(`path=${JSON.stringify(route).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  assert.doesNotMatch(router, /admin\.html|room\.html|recover\.html|share-target\.html|Legacy/);
});

test("Wrangler usa únicamente el origen actual de Pages", () => {
  const wrangler = readJson("worker/wrangler.jsonc");
  assert.equal(wrangler.main, "src/index.ts");
  assert.equal(wrangler.d1_databases?.[0]?.binding, "DB");
  assert.equal(wrangler.d1_databases?.[0]?.migrations_dir, "migrations");
  assert.equal(wrangler.vars?.ALLOW_LOCALHOST, "false");
  assert.equal(wrangler.vars?.ALLOWED_ORIGINS, "https://hopper-transfer.pages.dev");
  assert.equal("CLEAN_FRONTEND_URLS" in (wrangler.vars || {}), false);
});

test("CI y CD están separados y despliegan desde master", () => {
  const ci = read(".github/workflows/ci.yml");
  const frontend = read(".github/workflows/deploy-frontend.yml");
  const worker = read(".github/workflows/deploy-worker.yml");

  assert.match(ci, /npm --prefix worker run typecheck/);
  assert.match(ci, /npm run test:e2e/);
  assert.match(frontend, /branches:[\s\S]*- master/);
  assert.match(frontend, /pages deploy dist --project-name=hopper-transfer --branch=master/);
  assert.match(worker, /branches:[\s\S]*- master/);
  assert.match(worker, /d1 migrations apply hopper-db --remote/);
  assert.match(worker, /workingDirectory: worker/);
});

test("el administrador contiene solo operaciones actuales", () => {
  const script = read("hopper-admin.ps1");
  for (const action of ["validate", "pages", "deploy", "verify", "github", "status", "cors"]) {
    assert.match(script, new RegExp(`"${action}"`));
  }
  assert.doesNotMatch(script, /Invoke-Phase5|LegacyPublicAppUrl|cleanup-refactor|"cutover"|"finalize"|"rollback"|GitHub Pages quedó/);
});

test("los scripts operativos actuales existen y no incluyen secretos", () => {
  for (const path of [
    "scripts/project-check.mjs",
    "scripts/verify-production.mjs",
    "scripts/prepare-pages-preview.mjs",
    "scripts/serve-dist.mjs"
  ]) {
    assert.equal(existsSync(resolve(root, path)), true, path);
  }

  const production = read("config/production.json");
  assert.doesNotMatch(production, /B2_APPLICATION_KEY|B2_KEY_ID|RESEND_API_KEY|SESSION_SECRET|CLOUDFLARE_API_TOKEN/);
});

test("el CSS grande quedó dividido sin alterar su orden de cascada", () => {
  const entry = read("src/styles/styles.css");
  const imports = [
    "foundation.css",
    "auth.css",
    "transfers.css",
    "recovery.css",
    "responsive-core.css",
    "navigation.css",
    "admin.css",
    "share.css",
    "responsive-pages.css",
    "rooms.css"
  ];

  let previous = -1;
  for (const file of imports) {
    assert.equal(existsSync(resolve(root, "src/styles", file)), true, file);
    const position = entry.indexOf(`@import "./${file}";`);
    assert.ok(position > previous, file);
    previous = position;
  }
});

test("el administrador evita el shim npx.ps1 en operaciones Wrangler", () => {
  const script = read("hopper-admin.ps1");
  assert.match(script, /function Resolve-NpxCliPath/);
  assert.match(script, /npx\.cmd/);
  assert.doesNotMatch(script, /&\s+npx(?:\s|$)/);
  assert.match(script, /function Invoke-WranglerProcess/);
});

test("PowerShell escribe JSON UTF-8 sin BOM", () => {
  const admin = read("hopper-admin.ps1");
  assert.match(admin, /function Write-Utf8NoBom/);
  assert.match(admin, /UTF8Encoding\]::new\(\$false\)/);
  assert.doesNotMatch(admin, /Set-Content\s+\$productionConfigPath\s+-Encoding\s+UTF8/);
  assert.doesNotMatch(admin, /Set-Content\s+\$workerConfigPath\s+-Encoding\s+UTF8/);
});
