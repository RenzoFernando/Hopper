export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: {
    changes?: number;
  };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null> | T | null;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>> | D1Result<T>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>> | D1Result<T>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = D1Result>(statements: D1PreparedStatement[]): Promise<T[]> | T[];
  exec(query: string): Promise<unknown> | unknown;
}

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  ALLOWED_ORIGINS?: string;
  ALLOW_LOCALHOST?: string;
  ADMIN_CLI_TOKEN?: string;
  B2_BUCKET_NAME?: string;
  B2_ENDPOINT?: string;
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
  B2_REGION?: string;
  MAX_FILE_BYTES?: string;
  ROOM_MAX_FILE_BYTES?: string;
  ROOM_MAX_BYTES?: string;
  ROOM_MAX_ITEMS?: string;
  PUBLIC_APP_URL?: string;
  RECOVERY_EMAIL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

export interface ClientInfo {
  ip: string;
  country: string;
  userAgent: string;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}