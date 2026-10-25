import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("la bandeja anima solo al cambiar identificadores, nunca cada segundo", () => {
  const source = readFileSync("src/components/transfers/ItemList.tsx", "utf8");
  const styles = readFileSync("src/styles/transfers.css", "utf8");
  assert.match(source, /const itemIds = activeItems\.map/);
  assert.match(source, /\}, \[itemIds, props\.loading\]\);/);
  assert.doesNotMatch(styles, /hopper-item-arrive|is-arriving/);
});

test("Hopper conserva distribución 1:2 y copy mínimo", () => {
  const source = readFileSync("src/components/transfers/Composer.tsx", "utf8");
  const styles = readFileSync("src/styles/transfers.css", "utf8");
  assert.match(styles, /grid-template-columns: minmax\(275px, 1fr\) minmax\(0, 2fr\)/);
  assert.doesNotMatch(source, /Los archivos se mantienen ocultos hasta publicarlos/);
  assert.match(source, /Ctrl \+ Enter para enviar/);
});
