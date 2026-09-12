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

test("el Service Worker conserva rutas limpias y activa builds nuevos sin quedar esperando", () => {
  const sw = read("src/sw.ts");
  assert.match(sw, /url\.pathname === "\/share"/);
  assert.match(sw, /event\.request\.mode === "navigate"/);
  assert.match(sw, /hopper-share-target-v1/);
  assert.match(sw, /\/manifest\.webmanifest/);
  assert.match(sw, /hopper-shell-v6/);
  assert.match(sw, /self\.skipWaiting\(\)/);

  const pwa = read("src/hooks/usePwa.tsx");
  assert.match(pwa, /next\.update\(\)/);
  assert.match(pwa, /activateWaitingWorker/);
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
  assert.match(frontend, /pages deployment list --project-name hopper-transfer --environment production --json/);
  assert.match(frontend, /pages deploy dist --project-name=hopper-transfer --branch=\$\{\{ steps\.pages-production\.outputs\.branch \}\}/);
  assert.match(frontend, /pages-environment/);
  assert.match(frontend, /node scripts\/verify-production\.mjs/);
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

test("Pages publica y verifica exactamente el mismo build antes de aprobar producción", () => {
  const prepare = read("scripts/prepare-pages-preview.mjs");
  const verify = read("scripts/verify-production.mjs");
  const headers = read("public/_headers");
  const admin = read("hopper-admin.ps1");

  assert.match(prepare, /createHash\("sha256"\)/);
  assert.match(prepare, /version\.json/);
  assert.match(verify, /localVersion\.buildId/);
  assert.match(verify, /HOPPER_DEPLOYMENT_URL/);
  assert.match(verify, /version\.json devolvió HTML/);
  assert.match(verify, /Build de producción/);
  assert.match(verify, /hopper-shell-v6/);
  assert.match(headers, /\/version\.json[\s\S]*no-store/);
  assert.match(headers, /\/sw\.js[\s\S]*no-store/);
  assert.match(admin, /Invoke-FullValidation[\s\S]*Build final de Pages/);
  assert.match(admin, /pages deployment list/);
  assert.match(admin, /--environment production/);
  assert.match(admin, /"--branch", \$script:PagesProductionBranch/);
  assert.match(admin, /Verify-Production -DeploymentUrl/);
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

test("PowerShell mantiene UTF-8 en la consola y en la salida de procesos nativos", () => {
  const path = resolve(root, "hopper-admin.ps1");
  const bytes = readFileSync(path);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);

  const admin = bytes.toString("utf8");
  assert.match(admin, /function Initialize-TerminalEncoding/);
  assert.match(admin, /\[Console\]::InputEncoding = \$utf8/);
  assert.match(admin, /\[Console\]::OutputEncoding = \$utf8/);
  assert.match(admin, /\$script:OutputEncoding = \$utf8/);
  assert.match(admin, /Get-Content \$configPath -Raw -Encoding UTF8/);
  assert.match(admin, /Get-Content \$productionConfigPath -Raw -Encoding UTF8/);
  assert.match(admin, /Get-Content \$readmePath -Raw -Encoding UTF8/);
});

test("los límites visibles y del Worker comparten la configuración actual del producto", () => {
  const constants = read("worker/src/lib/constants.ts");
  const wrangler = readJson("worker/wrangler.jsonc");
  const vite = read("vite.config.ts");
  const admin = read("src/components/admin/AdminRooms.tsx");

  assert.match(constants, /MAX_ACTIVE_ROOMS = 3/);
  assert.match(constants, /ROOM_LIFETIME_MINUTES = 10/);
  assert.match(constants, /ROOM_INACTIVITY_SECONDS = 5 \* 60/);
  assert.match(constants, /DEFAULT_ROOM_MAX_FILE_BYTES = 256 \* 1024 \* 1024/);
  assert.equal(wrangler.vars?.ROOM_MAX_FILE_BYTES, String(256 * 1024 * 1024));
  assert.equal(wrangler.vars?.ROOM_MAX_BYTES, String(512 * 1024 * 1024));
  assert.match(vite, /roomDefaultTtlMinutes:\s*10/);
  assert.match(vite, /roomMaxFileBytes:\s*268435456/);
  assert.doesNotMatch(admin, /\?\?\s*2|\/\s*2/);

  const administrator = read("hopper-admin.ps1");
  assert.match(administrator, /RoomMaxFileBytes = \[long\]\(256MB\)/);
  assert.match(administrator, /maxMb -gt 512/);
  assert.doesNotMatch(administrator, /maxMb -gt 5120/);
});

test("la capa SEO pública tiene metadatos, contenido semántico, FAQ, sitemap, robots y llms", async () => {
  const { SEO_PAGES, renderLlms, renderRobots, renderSeoPage, renderSitemap } = await import("../scripts/seo-pages.mjs");
  assert.equal(SEO_PAGES.length, 4);
  assert.equal(new Set(SEO_PAGES.map((page) => page.intent)).size, SEO_PAGES.length);
  assert.equal(new Set(SEO_PAGES.map((page) => page.title)).size, SEO_PAGES.length);
  assert.equal(new Set(SEO_PAGES.map((page) => page.description)).size, SEO_PAGES.length);

  for (const page of SEO_PAGES) {
    assert.ok(page.intent.length >= 20);
    assert.match(page.path, /^\/[a-z-]+$/);
    assert.doesNotMatch(page.path, /\d|(?:^|-)y(?:-|$)/);
    assert.notEqual(page.title, page.h1);
    assert.ok(page.title.length >= 30 && page.title.length <= 65, page.title);
    assert.ok(page.description.length >= 100 && page.description.length <= 170, page.description);

    const html = renderSeoPage(page);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, page.path);
    assert.match(html, /<h2\b/);
    assert.match(html, /<h3\b/);
    assert.match(html, /<table>/);
    assert.match(html, /<ul>/);
    assert.match(html, /data-share/);
    assert.match(html, /seo-mobile-cta/);
    assert.match(html, /FAQPage/);
    assert.match(html, /BreadcrumbList/);
    assert.match(html, /alt="Icono de Hopper para transferencia temporal de archivos y texto"/);
    assert.doesNotMatch(html, /LocalBusiness/);
    assert.ok(html.indexOf("seo-intro") < html.indexOf("seo-actions"), `${page.path}: CTA después del primer párrafo`);
  }

  const index = read("index.html");
  assert.match(index, /<link rel="canonical" href="https:\/\/hopper-transfer\.pages\.dev\/">/);
  assert.match(index, /<meta property="og:title"/);
  assert.match(index, /WebApplication/);
  assert.match(index, /Person/);
  assert.doesNotMatch(index, /LocalBusiness/);

  const robots = renderRobots();
  assert.match(robots, /Disallow: \/page\//);
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Sitemap: https:\/\/hopper-transfer\.pages\.dev\/sitemap\.xml/);

  const sitemap = renderSitemap();
  for (const page of SEO_PAGES) assert.match(sitemap, new RegExp(page.path.replaceAll("-", "\\-")));

  const llms = renderLlms();
  assert.match(llms, /^# Hopper/m);
  assert.match(llms, /Hopper no se presenta como cifrado de extremo a extremo/);

  const headers = read("public/_headers");
  assert.match(headers, /https:\/\/www\.googletagmanager\.com/);
  assert.match(headers, /https:\/\/www\.google-analytics\.com/);

  const workflow = read(".github/workflows/deploy-frontend.yml");
  assert.match(workflow, /VITE_GA_MEASUREMENT_ID/);
  assert.match(workflow, /VITE_GSC_VERIFICATION/);

  const envExample = read(".env.example");
  assert.match(envExample, /VITE_GA_MEASUREMENT_ID=/);
  assert.match(envExample, /VITE_GSC_VERIFICATION=/);
});

test("las rutas privadas declaran noindex y la portada conserva indexación", () => {
  const router = read("src/app/router.tsx");
  const notFound = read("src/pages/NotFoundPage.tsx");
  assert.match(router, /PRIVATE_ROBOTS = "noindex,nofollow"/);
  assert.match(router, /INDEX_ROBOTS = "index,follow/);
  assert.match(router, /path="\/"[\s\S]*indexable canonicalPath="\/"/);
  assert.match(router, /canonical\?\.remove\(\)/);
  assert.doesNotMatch(notFound, /meta\[name="robots"\]|useLayoutEffect/);
});