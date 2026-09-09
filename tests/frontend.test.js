import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("mantiene una única versión interna de assets y TTL predeterminado de 5 minutos", () => {
  const config = read("js/config.js");
  const version = config.match(/assetVersion:\s*"([^"]+)"/)?.[1];
  assert.equal(version, "20260908-5");
  assert.match(config, /defaultTtlMinutes:\s*5/);
  assert.match(config, /roomDefaultTtlMinutes:\s*5/);

  const files = [
    "index.html",
    "room.html",
    "admin.html",
    "recover.html",
    "share-target.html",
    "service-worker.js",
    "js/admin.js",
    "js/api.js",
    "js/app.js",
    "js/recover.js",
    "js/room.js",
    "js/share-target.js",
    "js/transfer-controller.js"
  ];

  for (const file of files) {
    const content = read(file);
    const versions = [...content.matchAll(/\?v=(\d{8}-\d+)/g)].map((match) => match[1]);
    assert.ok(versions.length > 0, `${file} debe usar cache-busting interno.`);
    assert.deepEqual([...new Set(versions)], [version], `${file} debe usar la versión ${version}.`);
  }

  assert.match(read("service-worker.js"), new RegExp(`hopper-shell-${version}`));
});

test("el generador PowerShell conserva toda la configuración moderna del frontend", () => {
  const script = read("hopper-admin.ps1");
  assert.doesNotMatch(script, /defaultTtlMinutes:\s*15/);
  assert.match(script, /publicAppUrl:\s*"\$\(\$script:PublicAppUrl\)"/);
  assert.match(script, /defaultTtlMinutes:\s*\$script:DefaultTtlMinutes/);
  assert.match(script, /roomDefaultTtlMinutes:\s*\$script:RoomDefaultTtlMinutes/);
  assert.match(script, /roomMaxFileBytes:\s*\$script:RoomMaxFileBytes/);
  assert.match(script, /uploadConcurrency:\s*\$script:UploadConcurrency/);
  assert.match(script, /assetVersion:\s*"\$script:AssetVersion"/);
});

test("el manifest PWA y el shell solo referencian recursos locales existentes", () => {
  const manifestPath = resolve(root, "manifest.webmanifest");
  assert.equal(existsSync(manifestPath), true);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.lang, "es");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.share_target?.method, "POST");
  assert.equal(manifest.share_target?.enctype, "multipart/form-data");

  for (const icon of manifest.icons || []) {
    assert.equal(existsSync(resolve(root, icon.src)), true, `Falta ${icon.src}.`);
  }

  const shell = read("service-worker.js").match(/const SHELL = \[(.*?)\];/s)?.[1] || "";
  const entries = [...shell.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  for (const entry of entries) {
    if (entry === "./") {
      continue;
    }

    const relative = entry.replace(/^\.\//, "").split("?")[0];
    assert.equal(existsSync(resolve(root, relative)), true, `Falta ${relative} en el shell PWA.`);
  }
});

test("la portada separa el PIN privado de las salas públicas", () => {
  const index = read("index.html");
  assert.doesNotMatch(index, /<nav[^>]*>[\s\S]*href="room\.html">Entrar a una sala<\/a>/);
  assert.doesNotMatch(index, /Todo desaparece automáticamente/);
  assert.match(index, /id="room-capacity">— \/ 2/);
  assert.match(index, /id="public-create-room"/);
  assert.match(index, /id="public-room-form"/);
  assert.match(index, /href="admin\.html">Administración<\/a>/);
  assert.match(index, /Código de la sala/);
  assert.match(index, /id="room-created-enter"[^>]*>Entrar a la sala/);
});

test("las salas públicas usan TTL fijo y no muestran controles para cambiarlo", () => {
  const roomHtml = read("room.html");
  const roomJs = read("js/room.js");
  const constants = read("cloudflare/src/constants.js");
  assert.doesNotMatch(roomHtml, /id="ttl-select"/);
  assert.match(roomJs, /defaultTtlMinutes:\s*5/);
  assert.match(roomJs, /ttlOptions:\s*\[5\]/);
  assert.match(roomJs, /allowTtlReset:\s*false/);
  assert.match(constants, /ROOM_TTL_OPTIONS = Object\.freeze\(\[5\]\)/);
  assert.match(constants, /ROOM_INACTIVITY_SECONDS = 5 \* 60/);
});

test("Share Target fija 5 minutos cuando el destino es una sala", () => {
  const source = read("js/share-target.js");
  assert.match(source, /roomDestination \? \[5\] : \[5, 15, 30, 60, 360\]/);
  assert.match(source, /elements\.ttlField\.hidden = roomDestination/);
});

test("la cola no muestra cero por ciento antes de enviar y usa cancelación compacta", () => {
  const source = read("js/transfer-controller.js");
  assert.doesNotMatch(source, /0% · Listo para enviar/);
  assert.match(source, /label: "Listo para enviar"/);
  assert.match(source, /className = "remove-file-button is-cancel"/);
  assert.match(source, /progress\.hidden = !activeProgress/);
  assert.match(source, /composerCard\?\.classList\.toggle\("is-sending", sending\)/);
});

test("Administración observa y abre salas pero no las crea", () => {
  const admin = read("admin.html");
  const adminJs = read("js/admin.js");
  const api = read("js/api.js");
  assert.match(admin, /<h1>Administración<\/h1>/);
  assert.doesNotMatch(admin, /id="new-room-button"/);
  assert.doesNotMatch(admin, /id="room-ttl"/);
  assert.match(adminJs, /hopperApi\.adminOpenRoom\(room\.id\)/);
  assert.match(api, /async adminOpenRoom\(roomId\)/);
});

test("la sesión de sala respeta el código del enlace y la inactividad vuelve a inicio", () => {
  const room = read("js/room.js");
  assert.match(room, /storedRoomSession && storedRoomCode && storedRoomCode !== normalizedHash[\s\S]*?hopperApi\.clearRoomSession\(\)/);
  assert.match(room, /async function markRoomActivity/);
  assert.match(room, /hopperApi\.roomActivity\(\)/);
  assert.match(room, /function leaveToHome\(\)[\s\S]*?window\.location\.replace\("\.\/"\)/);
});

test("no conserva el módulo UI antiguo sin referencias", () => {
  assert.equal(existsSync(resolve(root, "js/ui.js")), false);
});
