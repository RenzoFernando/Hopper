import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Supercarga no abre about:blank ni utiliza diálogos nativos al descargar y finalizar", () => {
  const page = read("src/pages/SuperPage.tsx");
  assert.doesNotMatch(page, /window\.open\(|window\.confirm\(/);
  assert.match(page, /document\.createElement\("iframe"\)/);
  assert.match(page, /<dialog\s+ref=\{dialogRef\}/);
  const picker = read("src/components/admin/SuperFilePicker.tsx");
  assert.match(picker, /role="button"/);
  assert.match(picker, /aria-disabled=\{disabled\}/);
});

test("El PIN administrativo de cuatro dígitos inicia sesión sin un botón Entrar", () => {
  const page = read("src/pages/SuperPage.tsx");
  assert.match(page, /next\.length === 4\) void login\(next\)/);
  assert.doesNotMatch(page, />Entrar<\/button>/);
});

test("La capacidad es un límite total de 10 GB y no una cuota por cada archivo", () => {
  const service = read("worker/src/services/exclusive.ts");
  const ui = read("src/pages/SuperPage.tsx");
  assert.match(service, /EXCLUSIVE_LIMIT = 10_000_000_000/);
  assert.match(service, /SUM\(size\).*EXCLUSIVE_LIMIT/s);
  assert.match(ui, /10 GB en total/);
  assert.match(ui, /file\.size > available/);
  assert.doesNotMatch(ui, /por archivo, con subida directa/);
});

test("El cambio de duración permanece restringido a sesiones activas y tiempos finitos", () => {
  const route = read("worker/src/routes/exclusive.ts");
  const service = read("worker/src/services/exclusive.ts");
  assert.match(route, /\/api\/admin\/super\/extend/);
  assert.match(route, /authorizePersonal\(c,"super-extend"/);
  assert.match(service, /status='active' AND expires_at>\?2/);
  assert.match(service, /EXCLUSIVE_DURATIONS = \[60, 360, 720, 1440\]/);
});

test("La descarga de B2 firma Content-Disposition attachment", () => {
  const service = read("worker/src/services/exclusive.ts");
  assert.match(service, /response-content-disposition/);
  assert.match(service, /filename\*=UTF-8/);
  assert.match(service, /application\/octet-stream/);
});
