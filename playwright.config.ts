import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: "list",
  snapshotPathTemplate: "{testDir}/visual/baselines/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.015,
      threshold: 0.2
    }
  },
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium"
  },
  webServer: {
    command: "node scripts/serve-legacy.mjs",
    url: "http://127.0.0.1:4174/index.html",
    reuseExistingServer: !process.env.CI
  }
});
