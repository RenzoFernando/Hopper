import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const distDir = resolve("dist");
const previewPath = resolve(distDir, "preview.html");
const indexPath = resolve(distDir, "index.html");
const sourceAsset = resolve("assets", "favicon.svg");
const targetAsset = resolve(distDir, "assets", "favicon.svg");

const previewHtml = await readFile(previewPath, "utf8");
await writeFile(indexPath, previewHtml, "utf8");
await mkdir(resolve(distDir, "assets"), { recursive: true });
await copyFile(sourceAsset, targetAsset);
