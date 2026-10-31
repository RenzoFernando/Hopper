import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { downloadBlobWithBrowser } from "../src/lib/download-directory.ts";

test("la descarga utiliza un blob local con nombre seguro y no lo revoca antes de guardar", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let link;
  let delay = 0;
  let cleanup;
  let clicked = false;
  let revoked = "";
  try {
    globalThis.document = {
      createElement: () => (link = { click: () => { clicked = true; }, remove: () => undefined }),
      body: { append: () => undefined }
    };
    globalThis.window = {
      setTimeout(callback, ms) { cleanup = callback; delay = ms; }
    };
    URL.createObjectURL = () => "blob:hopper-test";
    URL.revokeObjectURL = (url) => { revoked = url; };
    downloadBlobWithBrowser("grabación/cliente.m4a", new Blob(["voz"]));
    assert.equal(link.href, "blob:hopper-test");
    assert.equal(link.download, "grabación_cliente.m4a");
    assert.equal(clicked, true);
    assert.equal(delay, 60_000);
    assert.equal(revoked, "");
    cleanup();
    assert.equal(revoked, "blob:hopper-test");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("los archivos normales no dependen del atributo download en enlaces de B2", () => {
  const source = readFileSync(new URL("../src/features/transfers/useTransferWorkspace.ts", import.meta.url), "utf8");
  assert.match(source, /downloadBlobWithBrowser\(item\.name \|\| "archivo", blob\)/);
  assert.match(source, /fetchItemBlob\(item\)/);
  assert.doesNotMatch(source, /link\.href = result\.url/);
});

test("una PWA no descarta archivos preparados o compartidos al actualizarse", () => {
  const workspace = readFileSync(new URL("../src/features/transfers/useTransferWorkspace.ts", import.meta.url), "utf8");
  const share = readFileSync(new URL("../src/features/share-target/useShareTarget.ts", import.meta.url), "utf8");
  assert.match(workspace, /selectedFiles\.some\(\(entry\) => entry\.status !== "error"\)/);
  assert.match(share, /const releaseTransfer = beginTransfer\(\)/);
  assert.match(share, /releaseTransfer\(\)/);
  assert.match(share, /items\.items\.some\(\(item\) => item\.id === uploadId\)/);
});
