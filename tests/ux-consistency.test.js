import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("un mismo patrón de checkbox se utiliza en bandeja y supercarga", () => {
  const css = read("src/styles/controls.css");
  assert.match(css, /\.bulk-select-all input, \.item-select input, \.super-confirm input/);
  assert.match(css, /\.super-confirm input\[type="checkbox"\]:checked::before/);
  assert.match(read("src/styles/styles.css"), /@import "\.\/controls\.css"/);
});

test("las rutas internas del encabezado conservan la SPA", () => {
  const header = read("src/components/layout/AppHeader.tsx");
  assert.match(header, /<Link className="brand" to="\/"/);
  assert.match(header, /to="\/admin"/);
  assert.match(header, /to="\/space"/);
  assert.doesNotMatch(header, /href="\/admin"|href="\/space"/);
});

test("supercarga no duplica controles y refresca al volver al navegador", () => {
  const page = read("src/pages/SuperPage.tsx");
  const picker = read("src/components/admin/SuperFilePicker.tsx");
  const poll = read("src/hooks/useForegroundPolling.ts");
  assert.match(page, /<SuperFilePicker/);
  assert.match(page, /useForegroundPolling\(reload, 5_000\)/);
  assert.match(picker, /aria-label="Adjuntar archivo"/);
  assert.match(poll, /visibilitychange/);
  assert.match(poll, /online/);
  assert.doesNotMatch(page, /window\.setInterval/);
});

test("un cambio de PWA no recarga mientras hay una transferencia activa", () => {
  const pwa = read("src/hooks/usePwa.tsx");
  const activity = read("src/lib/transfer-activity.ts");
  assert.match(pwa, /if \(isTransferActive\(\)\)/);
  assert.match(pwa, /hopper:transfers-idle/);
  assert.match(activity, /activeTransfers > 0/);
});
