import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const config = JSON.parse((await readFile(resolve("config", "production.json"), "utf8")).replace(/^\uFEFF/, ""));
const appUrl = String(process.env.HOPPER_PUBLIC_APP_URL || config.publicAppUrl || "").replace(/\/+$/, "");
const workerUrl = String(process.env.HOPPER_WORKER_URL || config.workerBaseUrl || "").replace(/\/+$/, "");

if (!/^https:\/\//.test(appUrl) || !/^https:\/\//.test(workerUrl)) {
  throw new Error("Las URLs de producción deben usar HTTPS.");
}

async function request(url, init = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    ...init,
    headers: {
      "User-Agent": "Hopper-Phase5-Verification/1.0",
      ...(init.headers || {})
    }
  });

  return response;
}

for (const path of ["/", "/space", "/admin", "/room/AB-1234", "/recover", "/share"]) {
  const response = await request(`${appUrl}${path}`, { headers: { Accept: "text/html" } });
  if (response.status !== 200) throw new Error(`${path} respondió HTTP ${response.status}.`);
  const html = await response.text();
  if (!html.includes('id="root"')) throw new Error(`${path} no recibió el shell React.`);
}

const manifest = await request(`${appUrl}/manifest.webmanifest`);
if (!manifest.ok) throw new Error(`manifest.webmanifest respondió HTTP ${manifest.status}.`);
const manifestJson = await manifest.json();
if (manifestJson?.share_target?.action !== "/share") {
  throw new Error("El manifest de producción no publica /share como Share Target.");
}

const serviceWorker = await request(`${appUrl}/sw.js`);
if (!serviceWorker.ok) throw new Error(`sw.js respondió HTTP ${serviceWorker.status}.`);

const page = await request(`${appUrl}/`);
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
  headers: { Origin: "https://fase5-origen-no-autorizado.invalid" }
});
if (deniedCors.status !== 403) {
  throw new Error(`CORS no autorizado esperaba 403 y recibió ${deniedCors.status}.`);
}

console.log(`Frontend: ${appUrl}`);
console.log(`Worker: ${workerUrl}`);
console.log("Fase 5: verificación HTTP de producción aprobada.");