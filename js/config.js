const appConfig = Object.freeze({
  workerBaseUrl: "https://hopper-api.renzofernando.workers.dev",
  publicAppUrl: "https://renzofernando.github.io/Hopper/",
  defaultTtlMinutes: 5,
  roomDefaultTtlMinutes: 5,
  maxFileBytes: 536870912,
  roomMaxFileBytes: 104857600,
  pollIntervalMs: 3000,
  uploadConcurrency: 2,
  assetVersion: "20260908-4"
});

export { appConfig };
