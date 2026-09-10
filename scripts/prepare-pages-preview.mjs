import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const distDir = resolve("dist");
const modernDir = resolve(distDir, "modern");

await cp(resolve(modernDir, "index.html"), resolve(distDir, "index.html"));
await mkdir(resolve(distDir, "assets"), { recursive: true });
await cp(resolve("assets"), resolve(distDir, "assets"), { recursive: true, force: true });

const configSource = await readFile(resolve("js", "config.js"), "utf8");
const workerMatch = configSource.match(/workerBaseUrl\s*:\s*"([^"]*)"/);
const workerUrl = workerMatch?.[1]?.trim() || "";
const workerOrigin = workerUrl ? new URL(workerUrl).origin : "";
const headersPath = resolve(distDir, "_headers");
let headers = await readFile(headersPath, "utf8");
if (workerOrigin) headers = headers.replace("connect-src 'self'", `connect-src 'self' ${workerOrigin}`);
await writeFile(headersPath, headers, "utf8");

await rm(modernDir, { recursive: true, force: true });
