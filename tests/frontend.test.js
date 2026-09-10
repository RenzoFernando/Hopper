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

test("Vite ya no depende de js/config.js ni de modern/index.html", () => {
  const vite = read("vite.config.ts");
  assert.match(vite, /config\/production\.json/);
  assert.doesNotMatch(vite, /js\/config\.js|modern\/index\.html/);
  assert.match(vite, /action:\s*"\/share"/);
});

test("la configuración pública separa Pages, Worker y URL legacy", () => {
  const config = readJson("config/production.json");
  assert.equal(config.pagesProjectName, "hopper-transfer");
  assert.equal(config.productionBranch, "main");
  assert.match(config.workerBaseUrl, /^https:\/\/.+\.workers\.dev$/);
  assert.match(config.publicAppUrl, /^https:\/\//);
  assert.match(config.legacyPublicAppUrl, /^https:\/\//);
  assert.equal(typeof config.cutoverComplete, "boolean");
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

test("React mantiene compatibilidad de entrada para enlaces históricos", () => {
  const router = read("src/app/router.tsx");
  for (const route of ["/admin.html", "/room.html", "/recover.html", "/share-target.html"]) {
    assert.match(router, new RegExp(route.replace(".", "\\.")));
  }
  assert.match(router, /Navigate replace/);
});

test("Wrangler versionado contiene D1 y migraciones formales", () => {
  const wrangler = readJson("worker/wrangler.jsonc");
  assert.equal(wrangler.main, "src/index.ts");
  assert.equal(wrangler.d1_databases?.[0]?.binding, "DB");
  assert.equal(wrangler.d1_databases?.[0]?.migrations_dir, "migrations");
  assert.equal(wrangler.vars?.ALLOW_LOCALHOST, "false");
});

test("CI y CD están separados entre calidad, Pages, Worker y redirect legacy", () => {
  const ci = read(".github/workflows/ci.yml");
  const frontend = read(".github/workflows/deploy-frontend.yml");
  const worker = read(".github/workflows/deploy-worker.yml");
  const redirect = read(".github/workflows/legacy-github-pages-redirect.yml");

  assert.match(ci, /npm --prefix worker run typecheck/);
  assert.match(ci, /npm run test:e2e/);
  assert.match(frontend, /pages deploy dist --project-name=hopper-transfer --branch=main/);
  assert.match(worker, /d1 migrations apply hopper-db --remote/);
  assert.match(worker, /workingDirectory: worker/);
  assert.match(redirect, /actions\/deploy-pages@v4/);
});

test("el administrador incluye corte, verificación, rollback y limpieza protegida", () => {
  const script = read("hopper-admin.ps1");
  assert.match(script, /"cutover"/);
  assert.match(script, /"finalize"/);
  assert.match(script, /"rollback"/);
  assert.match(script, /"cleanup-refactor"/);
  assert.match(script, /Invoke-Phase5Cutover/);
  assert.match(script, /Invoke-Phase5Finalize/);
  assert.match(script, /Save-Phase5Rollback/);
  assert.match(script, /ELIMINAR/);
  assert.doesNotMatch(script, /Phase3|pages-preview|js\\config\.js/);
});

test("los scripts operativos de Fase 5 existen y no incluyen secretos", () => {
  for (const path of [
    "scripts/phase5-check.mjs",
    "scripts/verify-production.mjs",
    "scripts/build-legacy-redirect.mjs"
  ]) {
    assert.equal(existsSync(resolve(root, path)), true, path);
  }

  const production = read("config/production.json");
  assert.doesNotMatch(production, /B2_APPLICATION_KEY|B2_KEY_ID|RESEND_API_KEY|SESSION_SECRET|CLOUDFLARE_API_TOKEN/);
});


test("el corte resuelve GitHub CLI sin depender del PATH y limpia solo artefactos transitorios", () => {
  const script = read("hopper-admin.ps1");
  assert.match(script, /function Resolve-GitHubCliPath/);
  assert.match(script, /GitHub CLI\\gh\.exe/);
  assert.match(script, /Remove-Phase5TransitionalArtifacts/);
  assert.doesNotMatch(script, /& gh(?:\s|$)/);

  const cleanupStart = script.indexOf("function Remove-RefactorLegacy");
  assert.notEqual(cleanupStart, -1);
  const cleanup = script.slice(cleanupStart);
  assert.doesNotMatch(cleanup, /change-pin\.png/);
  assert.doesNotMatch(cleanup, /\"playwright\.config\.ts\"/);
});

test("el administrador evita el shim npx.ps1 en todas las operaciones Wrangler", () => {
  const script = read("hopper-admin.ps1");
  assert.match(script, /function Resolve-NpxCliPath/);
  assert.match(script, /npx\.cmd/);
  assert.doesNotMatch(script, /&\s+npx(?:\s|$)/);
  assert.match(script, /Resolve-NpxCliPath\) --yes wrangler pages project list/);
  assert.match(script, /Resolve-NpxCliPath\) --yes wrangler versions list/);
  assert.match(script, /function Invoke-WranglerProcess/);
});

test("warnings nativos de Wrangler no abortan el corte y Pages declara workspace dirty", () => {
  const script = read("hopper-admin.ps1");
  assert.match(script, /function Invoke-WranglerProcess/);
  assert.match(script, /\$ErrorActionPreference = "Continue"/);
  assert.match(script, /\$processExitCode = \$LASTEXITCODE/);
  assert.match(script, /--commit-dirty=true/);
  assert.doesNotMatch(script, /pages deploy[^\n]*2>&1/);
  assert.doesNotMatch(script, /wrangler deploy --config wrangler\.jsonc 2>&1/);
});

test("el snapshot de rollback se conserva entre reintentos de un corte no aprobado", () => {
  const script = read("hopper-admin.ps1");
  const start = script.indexOf("function Save-Phase5Rollback");
  const end = script.indexOf("function Deploy-Pages", start);
  const rollback = script.slice(start, end);
  assert.match(rollback, /Snapshot de rollback existente conservado/);
  assert.match(rollback, /legacyPublicAppUrl/);
  assert.match(rollback, /cleanFrontendUrls = \$false/);
  assert.match(rollback, /cutoverComplete = \$false/);
});

test("Pages exige el hostname exacto del proyecto y rechaza sufijos aleatorios", () => {
  const script = read("hopper-admin.ps1");
  assert.match(script, /\$script:PagesProjectName = "hopper-transfer"/);
  assert.match(script, /function Assert-PagesPublicUrlMatchesProject/);
  assert.match(script, /\$expectedHost = \("\$\(\$script:PagesProjectName\)\.pages\.dev"\)/);
  assert.match(script, /\$actualPagesHost -ne \$expectedHost/);
  assert.match(script, /sufijo aleatorio/);
  assert.match(script, /Assert-PagesPublicUrlMatchesProject -PagesUrl \$pagesUrl/);
});

test("Pages resuelve el dominio estable aunque Wrangler no exponga subdomain", () => {
  const script = read("hopper-admin.ps1");
  assert.match(script, /function ConvertTo-PagesStableUrl/);
  assert.match(script, /Project Domains/);
  assert.match(script, /project_domains/);
  assert.match(script, /function Get-PagesStableUrlFromDeployments/);
  assert.match(script, /pages deployment list --project-name \$script:PagesProjectName --environment production --json/);
  assert.doesNotMatch(
    script,
    /function Get-PagesPublicUrl[\s\S]{0,500}throw "Cloudflare Pages no devolvió el subdominio estable del proyecto\."/,
  );
  assert.doesNotMatch(script, /\$host\s*=/i);
  assert.doesNotMatch(script, /\$matches\s*=/i);
  assert.match(script, /\$candidateHost\s*=\s*\$match\.Groups\[1\]/);
});

test("JSON de producción es tolerante a BOM y PowerShell escribe UTF-8 sin BOM", () => {
  const vite = read("vite.config.ts");
  const prepare = read("scripts/prepare-pages-preview.mjs");
  const verify = read("scripts/verify-production.mjs");
  const redirect = read("scripts/build-legacy-redirect.mjs");
  const phase5 = read("scripts/phase5-check.mjs");
  const admin = read("hopper-admin.ps1");

  for (const source of [vite, prepare, verify, redirect, phase5]) {
    assert.match(source, /replace\(\/\^\\uFEFF\//);
  }

  assert.match(admin, /function Write-Utf8NoBom/);
  assert.match(admin, /UTF8Encoding\]::new\(\$false\)/);
  assert.doesNotMatch(admin, /Set-Content\s+\$productionConfigPath\s+-Encoding\s+UTF8/);
  assert.doesNotMatch(admin, /Set-Content\s+\$workerConfigPath\s+-Encoding\s+UTF8/);
});
