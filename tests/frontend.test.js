import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("usa URLs directas de assets y conserva TTL predeterminado de 5 minutos", () => {
  const config = read("js/config.js");
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
    "js/transfer-controller.js",
    "js/config.js",
    "hopper-admin.ps1"
  ];

  for (const file of files) {
    assert.doesNotMatch(read(file), /\?[a-z]=20\d{6}-\d+/i, `${file} debe usar URLs directas de assets.`);
    assert.doesNotMatch(read(file), /20\d{6}-\d+/);
  }

  const serviceWorker = read("service-worker.js");
  assert.match(serviceWorker, /const CACHE_NAME = "hopper-shell";/);
  assert.doesNotMatch(serviceWorker, /hopper-shell-\d/);
  assert.match(serviceWorker, /fetch\(event\.request, \{ cache: "no-cache" \}\)/);
});

test("el generador PowerShell conserva toda la configuración moderna del frontend", () => {
  const script = read("hopper-admin.ps1");
  assert.doesNotMatch(script, /defaultTtlMinutes:\s*15/);
  assert.match(script, /publicAppUrl:\s*"\$\(\$script:PublicAppUrl\)"/);
  assert.match(script, /defaultTtlMinutes:\s*\$script:DefaultTtlMinutes/);
  assert.match(script, /roomDefaultTtlMinutes:\s*\$script:RoomDefaultTtlMinutes/);
  assert.match(script, /roomMaxFileBytes:\s*\$script:RoomMaxFileBytes/);
  assert.match(script, /uploadConcurrency:\s*\$script:UploadConcurrency/);
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
  assert.match(index, /<label for="pin-input">PIN ADMIN<\/label>/);
  assert.match(index, /id="public-room-code"[^>]*pattern="\[A-Za-z\]\{2\}-\[0-9\]\{4\}"[^>]*placeholder="XX-0000"/);
  assert.match(read("room.html"), /id="room-code-input"[^>]*placeholder="XX-0000"/);
  assert.match(index, /href="admin\.html">Administración<\/a>/);
  assert.match(index, /Código de la sala/);
  assert.match(index, /id="room-created-enter"[^>]*>Entrar a la sala/);
});


test("la instalación PWA permanece disponible en la portada móvil", () => {
  const index = read("index.html");
  const styles = read("css/styles.css");
  const app = read("js/app.js");
  assert.match(index, /id="install-button"/);
  assert.match(app, /beforeinstallprompt/);
  assert.doesNotMatch(styles, /\.public-nav #install-button,\s*\.public-nav #update-button\s*\{\s*display:\s*none !important;/);
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*?\.public-nav #update-button\s*\{\s*display:\s*none !important;/);
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

test("Share Target permite autenticarse directamente y fija 5 minutos en salas", () => {
  const html = read("share-target.html");
  const source = read("js/share-target.js");
  assert.match(html, /id="share-pin-form"/);
  assert.match(html, /id="share-room-form"/);
  assert.match(html, /id="share-room-code"[^>]*placeholder="XX-0000"/);
  assert.match(source, /hopperApi\.login\(pin\)/);
  assert.match(source, /hopperApi\.joinRoom\(code\)/);
  assert.match(source, /roomDestination \? \[5\] : \[5, 15, 30, 60, 360\]/);
  assert.match(source, /elements\.ttlField\.hidden = elements\.destination\.options\.length === 0 \|\| roomDestination/);
});

test("la cola no muestra cero por ciento antes de enviar y usa cancelación compacta", () => {
  const source = read("js/transfer-controller.js");
  assert.doesNotMatch(source, /0% · Listo para enviar/);
  assert.match(source, /label: "Listo para enviar"/);
  assert.match(source, /className = "remove-file-button is-cancel"/);
  assert.match(source, /progress\.hidden = !activeProgress/);
  assert.match(source, /composerCard\?\.classList\.toggle\("is-sending", sending\)/);
});

test("Administración observa salas y añade cambio de PIN y reinicio", () => {
  const admin = read("admin.html");
  const adminJs = read("js/admin.js");
  const api = read("js/api.js");
  assert.match(admin, /<h1>Administración<\/h1>/);
  assert.doesNotMatch(admin, /id="new-room-button"/);
  assert.doesNotMatch(admin, /id="room-ttl"/);
  assert.match(admin, /id="change-pin-button"/);
  assert.match(admin, /id="reset-system-button"/);
  assert.match(adminJs, /hopperApi\.adminOpenRoom\(room\.id\)/);
  assert.match(adminJs, /hopperApi\.adminChangePin\(pin, confirmation\)/);
  assert.match(adminJs, /hopperApi\.adminResetSystem\(\)/);
  assert.match(api, /async adminOpenRoom\(roomId\)/);
  assert.match(api, /async adminChangePin\(pin, confirmation\)/);
  assert.match(api, /async adminResetSystem\(\)/);
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
test("la portada usa reparto 70/30 real en escritorio y conserva el apilado responsive", () => {
  const index = read("index.html");
  const styles = read("css/styles.css");
  assert.match(index, /class="auth-divider"/);
  assert.match(styles, /\.auth-layout\s*\{[\s\S]*width:\s*100%;[\s\S]*grid-template-columns:\s*minmax\(0,\s*7fr\)\s+minmax\(0,\s*3fr\)/);
  assert.match(styles, /\.auth-divider\s*\{[\s\S]*left:\s*70%;[\s\S]*width:\s*2px/);
  assert.match(styles, /\.room-access-panel\s*\{[\s\S]*grid-column:\s*2;[\s\S]*width:\s*min\(100%,\s*320px\);[\s\S]*justify-self:\s*center/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.auth-layout\s*\{[\s\S]*grid-template-columns:\s*1fr/);
});

test("la iconografía conserva la base neutra y usa verde, azul y rojo como ayudas visuales", () => {
  const index = read("index.html");
  const admin = read("admin.html");
  const room = read("room.html");
  const styles = read("css/styles.css");
  const transfers = read("js/transfer-controller.js");

  assert.match(styles, /--accent:\s*#2f6f5e/);
  assert.match(styles, /--info:\s*#4f6f8f/);
  assert.match(styles, /--danger:\s*#a63a3a/);
  assert.match(styles, /--info-soft:\s*#edf3f8/);
  assert.match(index, /id="update-button"[^>]*aria-label="Actualizar Hopper"/);
  assert.match(room, /id="share-room-button"[^>]*aria-label="Compartir sala"/);
  assert.match(admin, /metric-icon is-info/);
  assert.match(admin, /metric-icon is-success/);
  assert.match(admin, /metric-icon is-danger/);
  assert.match(transfers, /function actionIcon\(action\)/);
  assert.match(transfers, /button\.setAttribute\("aria-label", label\)/);
  assert.match(transfers, /mark\.classList\.add\("is-text"\)/);
  assert.match(transfers, /mark\.classList\.add\("is-file"\)/);
});
