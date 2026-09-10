import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";

const root = resolve("dist");
const port = Number(process.argv[2] || process.env.PORT || 4175);
const types = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"], [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".png", "image/png"],
  [".svg", "image/svg+xml"], [".webmanifest", "application/manifest+json; charset=utf-8"]
]);

function filePath(pathname) {
  const relative = normalize(pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  const path = resolve(root, relative);
  if (path !== root && !path.startsWith(`${root}${sep}`)) return null;
  return existsSync(path) && statSync(path).isFile() ? path : null;
}

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  let path = filePath(pathname);
  if (!path && request.method === "GET" && String(request.headers.accept || "").includes("text/html")) path = filePath("/index.html");
  if (!path) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": types.get(extname(path).toLowerCase()) || "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(path).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`Hopper dist: http://127.0.0.1:${port}`));
