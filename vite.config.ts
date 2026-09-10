import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

type ProductionConfig = {
  workerBaseUrl: string;
  publicAppUrl: string;
  b2Endpoint: string;
};

function readProductionConfig(): ProductionConfig {
  const path = resolve(import.meta.dirname, "config/production.json");
  const source = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as Partial<ProductionConfig>;

  if (!source.workerBaseUrl || !source.publicAppUrl || !source.b2Endpoint) {
    throw new Error("config/production.json no contiene la configuración mínima de Hopper.");
  }

  return {
    workerBaseUrl: String(source.workerBaseUrl),
    publicAppUrl: String(source.publicAppUrl),
    b2Endpoint: String(source.b2Endpoint)
  };
}

const productionConfig = readProductionConfig();

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: null,
      registerType: "prompt",
      manifestFilename: "manifest.webmanifest",
      manifest: {
        id: "/",
        name: "Hopper",
        short_name: "Hopper",
        description: "Transferencia temporal de texto, archivos y audio.",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#202123",
        theme_color: "#202123",
        icons: [
          { src: "/assets/icons/hopper-192.png", sizes: "192x192", type: "image/png" },
          { src: "/assets/icons/hopper-512.png", sizes: "512x512", type: "image/png" },
          { src: "/assets/icons/hopper.svg", sizes: "any", type: "image/svg+xml" }
        ],
        share_target: {
          action: "/share",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            url: "url",
            files: [{ name: "files", accept: ["*/*"] }]
          }
        }
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,ico,png,webmanifest}"]
      },
      devOptions: {
        enabled: true,
        type: "module"
      }
    })
  ],
  define: {
    __HOPPER_APP_CONFIG__: JSON.stringify({
      workerBaseUrl: productionConfig.workerBaseUrl,
      publicAppUrl: productionConfig.publicAppUrl,
      defaultTtlMinutes: 5,
      roomDefaultTtlMinutes: 5,
      maxFileBytes: 536870912,
      roomMaxFileBytes: 104857600,
      pollIntervalMs: 3000,
      uploadConcurrency: 2
    })
  }
});