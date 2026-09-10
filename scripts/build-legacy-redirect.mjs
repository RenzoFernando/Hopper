import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

const config = JSON.parse((await readFile(resolve("config", "production.json"), "utf8")).replace(/^\uFEFF/, ""));
if (!config.cutoverComplete) {
  throw new Error("El redirect de GitHub Pages solo puede publicarse después del corte de Fase 5.");
}

const target = String(config.publicAppUrl || "").replace(/\/+$/, "");
if (!/^https:\/\//.test(target)) throw new Error("publicAppUrl no contiene la URL HTTPS final.");

const out = resolve(".phase5-github-pages");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

function html(kind) {
  const safeTarget = JSON.stringify(target);
  const safeKind = JSON.stringify(kind);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'">
  <title>Hopper se ha movido</title>
  <style>body{font-family:system-ui,sans-serif;background:#202123;color:#fff;display:grid;min-height:100vh;place-items:center;margin:0}main{max-width:36rem;padding:2rem;text-align:center}a{color:#fff}</style>
</head>
<body>
<main>
  <h1>Hopper se ha movido</h1>
  <p>Redirigiendo a la versión actual…</p>
  <p><a id="fallback" href="${target}/">Abrir Hopper</a></p>
</main>
<script>
(() => {
  const target = ${safeTarget};
  const kind = ${safeKind};
  let path = "/";
  let hash = location.hash || "";
  if (kind === "admin") path = "/admin";
  if (kind === "room") {
    const code = decodeURIComponent(hash.replace(/^#/, "")).trim().toUpperCase();
    path = /^[A-Z]{2}-\\d{4}$/.test(code) ? "/room/" + code : "/room";
    hash = "";
  }
  if (kind === "recover") {
    const raw = hash.replace(/^#/, "");
    const token = raw.startsWith("token=") ? new URLSearchParams(raw).get("token") || "" : decodeURIComponent(raw);
    path = "/recover";
    hash = token ? "#" + encodeURIComponent(token) : "";
  }
  if (kind === "share") {
    path = "/share";
    hash = "";
  }
  const destination = target + path + (location.search || "") + hash;
  document.getElementById("fallback").href = destination;
  location.replace(destination);
})();
</script>
</body>
</html>`;
}

const pages = new Map([
  ["index.html", "home"],
  ["404.html", "home"],
  ["admin.html", "admin"],
  ["room.html", "room"],
  ["recover.html", "recover"],
  ["share-target.html", "share"]
]);

for (const [name, kind] of pages) {
  await writeFile(resolve(out, name), html(kind), "utf8");
}

await writeFile(resolve(out, ".nojekyll"), "", "utf8");
console.log(out);