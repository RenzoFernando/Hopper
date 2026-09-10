import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
  plugins: [react()],
  define: {
    __HOPPER_APP_CONFIG__: JSON.stringify(readAppConfig())
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "modern/index.html"),
        room: resolve(import.meta.dirname, "modern/room.html"),
        admin: resolve(import.meta.dirname, "modern/admin.html"),
        recover: resolve(import.meta.dirname, "modern/recover.html")
      }
    }
  }
});
