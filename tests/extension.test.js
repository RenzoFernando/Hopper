import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const extension = resolve("extension/hopper");
const manifest = JSON.parse(readFileSync(resolve(extension, "manifest.json"), "utf8"));

test("extensión restringida al origen de Hopper, sin acceso general a páginas", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://hopper-transfer.pages.dev/*"]);
  assert.deepEqual(manifest.host_permissions, ["https://hopper-transfer.pages.dev/*"]);
  assert.ok(!manifest.permissions.includes("<all_urls>"));
});

test("puente de extensión: precarga invisible, envío de texto y publicación explícita", async () => {
  const calls = [];
  let handler;
  class XHR {
    status = 200;
    upload = { addEventListener() {} };
    handlers = new Map();
    open(method, url) { assert.equal(method, "PUT"); assert.match(url, /^https:\/\/storage\.test/); }
    setRequestHeader() {}
    addEventListener(name, cb) { this.handlers.set(name, cb); }
    send(blob) {
      assert.equal(blob.size, 5);
      this.handlers.get("load")();
    }
    abort() { this.handlers.get("abort")?.(); }
  }
  const chrome = {
    runtime: {
      onMessage: { addListener(fn) { handler = fn; } },
      sendMessage(_payload, cb) { cb(); },
      get lastError() { return null; }
    }
  };
  const responses = {
    "/api/uploads/init": { ok: true, upload: { id: "upload-1", uploadUrl: "https://storage.test/u", mimeType: "text/plain" } },
    "/api/uploads/upload-1/complete": { ok: true, item: { id: "upload-1" } },
    "/api/items/text": { ok: true, item: { id: "text-1" } }
  };
  const context = {
    chrome, XMLHttpRequest: XHR,
    Blob, Uint8Array, atob,
    localStorage: { getItem() { return JSON.stringify({ token: "valid-token", expiresAt: Date.now() + 60000 }); } },
    window: { setInterval() {} }, Date,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => responses[path] || { ok: true } };
    }
  };
  vm.runInNewContext(readFileSync(resolve(extension, "bridge.js"), "utf8"), context);
  async function message(action, payload) {
    return new Promise((resolve) => handler({ type: "hopper-extension", action, payload }, {}, resolve));
  }
  assert.equal((await message("status", {})).authorized, true);
  assert.equal((await message("send-text", { content: "HOLA", ttlMinutes: 5 })).sent, true);
  assert.equal((await message("start-file", { key: "key-1", name: "test.txt", size: 5, mimeType: "text/plain", ttlMinutes: 5 })).started, true);
  assert.equal((await message("file-chunk", { key: "key-1", chunk: "aGVsbG8=" })).received, 5);
  assert.equal((await message("upload-file", { key: "key-1" })).uploaded, true);
  assert.ok(!calls.some((call) => call.path.includes("/complete")), "no publica durante la subida");
  assert.equal((await message("publish", { ttlMinutes: 5 })).published.length, 1);
  assert.equal(calls.filter((call) => call.path.endsWith("/complete")).length, 1);
  assert.equal(calls.find((call) => call.path.endsWith("/complete")).body.ttlMinutes, 5);
});


test("límite de 128 MiB compartido por popup y puente", () => {
  for (const file of ["popup.js", "bridge.js"]) {
    const code = readFileSync(resolve(extension, file), "utf8");
    assert.match(code, /MAX_FILE_BYTES = 128 \* 1024 \* 1024/);
  }
});

test("el popup evita instrucciones técnicas y admite pegar con alternativa", () => {
  const html = readFileSync(resolve(extension, "popup.html"), "utf8");
  const code = readFileSync(resolve(extension, "popup.js"), "utf8");
  assert.doesNotMatch(html, /se publican al enviar|se mantienen ocultos/i);
  assert.match(code, /navigator\.clipboard\?\.readText/);
  assert.match(code, /document\.execCommand\("paste"\)/);
});
