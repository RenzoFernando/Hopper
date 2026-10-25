import test from "node:test";
import assert from "node:assert/strict";
import { listTemporaryDownloads } from "../src/lib/download-directory.ts";

test("Ver carpeta enumera directamente archivos de la carpeta ya autorizada, sin selector adicional", async () => {
  const previous = globalThis.indexedDB;
  let pickerCalled = false;
  const previousWindow = globalThis.window;
  globalThis.window = {
    showDirectoryPicker() { pickerCalled = true; throw new Error("No debería solicitar otra carpeta."); }
  };
  globalThis.indexedDB = {
    open() {
      const request = { result: {
        transaction() { return { objectStore() { return { getAll() {
          const reading = { result: [
            { id: "tracked-1", name: "zip-hopper.zip", expiresAt: "2026-10-25T23:59:00Z", directory: { key: 1 } }
          ] };
          queueMicrotask(() => reading.onsuccess?.());
          return reading;
        } }; } }; },
        close() {}
      } };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  };
  const directory = {
    kind: "directory", name: "HOPPER",
    async isSameEntry(other) { return other.key === 1; },
    async *values() {
      yield { kind: "file", name: "zip-hopper.zip" };
      yield { kind: "file", name: "otro-archivo.txt" };
      yield { kind: "directory", name: "subcarpeta" };
    }
  };
  try {
    const listed = await listTemporaryDownloads(directory);
    assert.equal(listed.length, 2);
    assert.deepEqual(listed.map(x => ({ name: x.name, managed: x.managed })), [
      { name: "zip-hopper.zip", managed: true },
      { name: "otro-archivo.txt", managed: false }
    ]);
    assert.equal(pickerCalled, false);
  } finally {
    globalThis.indexedDB = previous;
    globalThis.window = previousWindow;
  }
});
