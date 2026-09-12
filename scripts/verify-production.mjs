import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const config = JSON.parse((await readFile(resolve("config", "production.json"), "utf8")).replace(/^\uFEFF/, ""));
const appUrl = String(process.env.HOPPER_PUBLIC_APP_URL || config.publicAppUrl || "").replace(/\/+$/, "");
const workerUrl = String(process.env.HOPPER_WORKER_URL || config.workerBaseUrl || "").replace(/\/+$/, "");
const deploymentUrl = String(process.env.HOPPER_DEPLOYMENT_URL || "").replace(/\/+$/, "");

if (!/^https:\/\//.test(appUrl) || !/^https:\/\//.test(workerUrl)) {
  throw new Error("Las URLs de producción deben usar HTTPS.");
}
if (deploymentUrl && !/^https:\/\//.test(deploymentUrl)) {
  throw new Error("La URL del despliegue de Pages debe usar HTTPS.");
}

let localVersion;
try {
  localVersion = JSON.parse(await readFile(resolve("dist", "version.json"), "utf8"));
} catch {
  throw new Error("Falta dist/version.json. Ejecuta 'npm run build' antes de verificar producción.");
}

if (localVersion?.app !== "Hopper" || !/^[a-f0-9]{24}$/.test(String(localVersion?.buildId || ""))) {
  throw new Error("dist/version.json no contiene un identificador de build válido.");
}

async function request(url, init = {}) {
  return fetch(url, {
    redirect: "manual",
    cache: "no-store",
    ...init,
    headers: {
      "User-Agent": "Hopper-Production-Verification/3.0",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...(init.headers || {})
    }
  });
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function remoteBuildState(baseUrl, expected, attempt) {
  const response = await request(`${baseUrl}/version.json?build=${encodeURIComponent(expected)}&attempt=${attempt}`);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const body = await response.text();

  if (!response.ok) {
    return { matches: false, detail: `HTTP ${response.status}` };
  }

  if (!contentType.includes("application/json")) {
    if (contentType.includes("text/html") || /^\s*<!doctype html/i.test(body)) {
      return {
        matches: false,
        detail: "version.json devolvió HTML; ese dominio todavía apunta a un despliegue que no contiene el identificador del build"
      };
    }
    return { matches: false, detail: `version.json devolvió ${contentType || "un tipo de contenido desconocido"}` };
  }

  let version;
  try {
    version = JSON.parse(body);
  } catch {
    return { matches: false, detail: "version.json no contiene JSON válido" };
  }

  const remote = String(version?.buildId || "sin identificador");
  return {
    matches: version?.app === "Hopper" && remote === expected,
    detail: `build remoto ${remote}`
  };
}

async function verifyBuildAt(baseUrl, label, attempts) {
  const expected = String(localVersion.buildId);
  let detail = "sin respuesta";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const state = await remoteBuildState(baseUrl, expected, attempt);
      detail = state.detail;
      if (state.matches) {
        console.log(`${label} confirmado: ${expected}`);
        return;
      }
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) await wait(2_000);
  }

  throw new Error(`${label} no sirve el build esperado. Local: ${expected}. Remoto: ${detail}.`);
}

if (deploymentUrl) {
  await verifyBuildAt(deploymentUrl, "Despliegue inmutable de Pages", 3);
}

await verifyBuildAt(appUrl, "Build de producción", 15);

for (const path of ["/", "/space", "/admin", "/room/AB-1234", "/recover", "/share"]) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await request(`${appUrl}${path}${separator}build=${localVersion.buildId}`, { headers: { Accept: "text/html" } });
  if (response.status !== 200) throw new Error(`${path} respondió HTTP ${response.status}.`);
  const html = await response.text();
  if (!html.includes('id="root"')) throw new Error(`${path} no recibió el shell React.`);
}

const manifest = await request(`${appUrl}/manifest.webmanifest?build=${localVersion.buildId}`);
if (!manifest.ok) throw new Error(`manifest.webmanifest respondió HTTP ${manifest.status}.`);
const manifestJson = await manifest.json();
if (manifestJson?.share_target?.action !== "/share") {
  throw new Error("El manifest de producción no publica /share como Share Target.");
}

const serviceWorker = await request(`${appUrl}/sw.js?build=${localVersion.buildId}`);
if (!serviceWorker.ok) throw new Error(`sw.js respondió HTTP ${serviceWorker.status}.`);
const serviceWorkerSource = await serviceWorker.text();
if (!serviceWorkerSource.includes("hopper-shell-v6")) {
  throw new Error("Producción todavía no sirve el Service Worker v6 esperado.");
}

const page = await request(`${appUrl}/?build=${localVersion.buildId}`);
const csp = page.headers.get("content-security-policy") || "";
if (!csp.includes("frame-ancestors 'none'")) throw new Error("Cloudflare Pages no devolvió la CSP esperada.");
if ((page.headers.get("x-content-type-options") || "").toLowerCase() !== "nosniff") {
  throw new Error("Falta X-Content-Type-Options en Cloudflare Pages.");
}

const health = await request(`${workerUrl}/health`, {
  headers: { Origin: new URL(appUrl).origin }
});
if (!health.ok) throw new Error(`Worker /health respondió HTTP ${health.status}.`);
const healthJson = await health.json();
if (healthJson?.ok !== true) throw new Error("Worker /health no confirmó estado OK.");

const deniedCors = await request(`${workerUrl}/api/security/status`, {
  headers: { Origin: "https://origen-no-autorizado.invalid" }
});
if (deniedCors.status !== 403) {
  throw new Error(`CORS no autorizado esperaba 403 y recibió ${deniedCors.status}.`);
}

console.log(`Frontend: ${appUrl}`);
console.log(`Worker: ${workerUrl}`);
console.log(`Build: ${localVersion.buildId}`);
console.log("Verificación HTTP de producción aprobada.");
