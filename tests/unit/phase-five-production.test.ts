import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("configuración final de producción", () => {
  test("la raíz de Vite es la SPA React", async () => {
    const html = await readFile(resolve("index.html"), "utf8");
    expect(html).toContain('id="root"');
    expect(html).toContain('src="/src/main.tsx"');
    expect(html).not.toContain("js/app.js");
  });

  test("la configuración no contiene secretos", async () => {
    const source = await readFile(resolve("config/production.json"), "utf8");
    expect(source).not.toMatch(/SESSION_SECRET|B2_APPLICATION_KEY|RESEND_API_KEY|CLOUDFLARE_API_TOKEN/);
  });

  test("los despliegues frontend y Worker son independientes", async () => {
    const frontend = await readFile(resolve(".github/workflows/deploy-frontend.yml"), "utf8");
    const worker = await readFile(resolve(".github/workflows/deploy-worker.yml"), "utf8");

    expect(frontend).toContain("pages deploy dist");
    expect(frontend).not.toContain("wrangler deploy --config wrangler.jsonc");
    expect(worker).toContain("deploy --config wrangler.jsonc");
    expect(worker).not.toContain("pages deploy dist");
  });

  test("el despliegue automático exige el corte de Fase 5", async () => {
    const frontend = await readFile(resolve(".github/workflows/deploy-frontend.yml"), "utf8");
    const worker = await readFile(resolve(".github/workflows/deploy-worker.yml"), "utf8");

    expect(frontend).toContain("cutoverComplete");
    expect(worker).toContain("cutoverComplete");
  });
});
