import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("congelamiento de estilos", () => {
  test("la copia moderna del CSS es byte a byte igual al CSS legado", async () => {
    const legacyCss = await readFile(resolve("css/styles.css"));
    const modernCss = await readFile(resolve("src/styles/styles.css"));

    expect(modernCss.equals(legacyCss)).toBe(true);
  });
});
