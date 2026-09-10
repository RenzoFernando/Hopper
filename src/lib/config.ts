type HopperAppConfig = {
  workerBaseUrl: string;
  publicAppUrl: string;
  defaultTtlMinutes: number;
  roomDefaultTtlMinutes: number;
  maxFileBytes: number;
  roomMaxFileBytes: number;
  pollIntervalMs: number;
  uploadConcurrency: number;
};

declare const __HOPPER_APP_CONFIG__: HopperAppConfig;

export const appConfig = Object.freeze(__HOPPER_APP_CONFIG__);
