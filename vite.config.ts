import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function configuredValue(source: string, key: string) {
  const stringMatch = source.match(new RegExp(`${key}\\s*:\\s*"([^"]*)"`));
  if (stringMatch) return stringMatch[1] ?? "";
  const numberMatch = source.match(new RegExp(`${key}\\s*:\\s*(\\d+)`));
  return Number(numberMatch?.[1] ?? 0);
}

function readAppConfig() {
  const source = readFileSync(resolve(import.meta.dirname, "js/config.js"), "utf8");
  return {
    workerBaseUrl: String(configuredValue(source, "workerBaseUrl")),
    publicAppUrl: String(configuredValue(source, "publicAppUrl")),
    defaultTtlMinutes: Number(configuredValue(source, "defaultTtlMinutes")),
    roomDefaultTtlMinutes: Number(configuredValue(source, "roomDefaultTtlMinutes")),
    maxFileBytes: Number(configuredValue(source, "maxFileBytes")),
    roomMaxFileBytes: Number(configuredValue(source, "roomMaxFileBytes")),
    pollIntervalMs: Number(configuredValue(source, "pollIntervalMs")),
    uploadConcurrency: Number(configuredValue(source, "uploadConcurrency"))
  };
}

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
        globPatterns: ["**/*.{js,css,html,svg,ico,webmanifest}"]
      },
      devOptions: {
        enabled: true,
        type: "module"
      }
    })
  ],
  define: {
    __HOPPER_APP_CONFIG__: JSON.stringify(readAppConfig())
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "modern/index.html")
      }
    }
  }
});
