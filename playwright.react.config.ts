import { defineConfig, devices } from "@playwright/test";

const config = {
  testDir: "./tests/e2e",
  testIgnore: [/(?:^|[\\/])visual-regression\.spec\.ts$/, /(?:^|[\\/])phase-three-pwa\.spec\.ts$/],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list" as const,
  snapshotPathTemplate: "{testDir}/visual/baselines/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled" as const,
      caret: "hide" as const,
      maxDiffPixelRatio: 0.015,
      threshold: 0.2
    }
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4175",
    serviceWorkers: "block" as const
  },
  webServer: {
    command: "node scripts/serve-dist.mjs",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  }
};

export default defineConfig({ ...config, ...(process.env.CI ? { workers: 2 } : {}) });
