import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const distDir = resolve("dist");
const modernDir = resolve(distDir, "modern");

for (const page of ["index.html", "room.html", "admin.html", "recover.html"]) {
  await cp(resolve(modernDir, page), resolve(distDir, page));
}

for (const directory of ["assets", "css", "js"]) {
  await mkdir(resolve(distDir, directory), { recursive: true });
  await cp(resolve(directory), resolve(distDir, directory), { recursive: true, force: true });
}

for (const file of ["manifest.webmanifest", "service-worker.js", "share-target.html"]) {
  await cp(resolve(file), resolve(distDir, file));
}

const configSource = await readFile(resolve("js", "config.js"), "utf8");
const workerMatch = configSource.match(/workerBaseUrl\s*:\s*"([^"]*)"/);
const workerUrl = workerMatch?.[1]?.trim() || "";
const workerOrigin = workerUrl ? new URL(workerUrl).origin : "";
const headersPath = resolve(distDir, "_headers");
let headers = await readFile(headersPath, "utf8");
if (workerOrigin) headers = headers.replace("connect-src 'self'", `connect-src 'self' ${workerOrigin}`);
await writeFile(headersPath, headers, "utf8");

await rm(modernDir, { recursive: true, force: true });
