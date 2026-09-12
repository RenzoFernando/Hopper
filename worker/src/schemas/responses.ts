import { z } from "zod";
import { jsonResponse } from "../lib/http.ts";

const roomSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  version: z.number(),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastActivityAt: z.string().optional(),
  closedAt: z.string().nullable().optional(),
  maxBytes: z.number(),
  maxFileBytes: z.number(),
  maxItems: z.number(),
  usedBytes: z.number(),
  itemCount: z.number()
}).passthrough();

const itemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "file"]),
  status: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  ttlMinutes: z.number(),
  content: z.string().optional(),
  name: z.string().optional(),
  size: z.number().optional(),
  mimeType: z.string().optional(),
  previewable: z.boolean().optional(),
  audio: z.boolean().optional()
}).passthrough();

const usagePeriodSchema = z.object({
  uploadsCount: z.number(),
  uploadBytes: z.number(),
  deletedBytes: z.number(),
  failedUploads: z.number(),
  cleanupFailures: z.number()
}).passthrough();

const healthItemSchema = z.object({ ok: z.boolean() }).passthrough();

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("hopper-api"),
  configured: z.object({
    d1: z.boolean(),
    b2Bucket: z.boolean(),
    b2Signing: z.boolean(),
    recoveryEmail: z.boolean()
  })
}).passthrough();

export const securityStatusResponseSchema = z.object({
  ok: z.boolean(),
  locked: z.boolean(),
  remainingAttempts: z.number()
}).passthrough();

export const loginResponseSchema = z.object({
  ok: z.boolean(),
  status: z.string(),
  remainingAttempts: z.number().optional(),
  token: z.string().optional(),
  expiresIn: z.number().optional()
}).passthrough();

export const recoveryResponseSchema = z.object({
  ok: z.boolean(),
  status: z.string()
}).passthrough();

export const itemsResponseSchema = z.object({
  ok: z.boolean(),
  items: z.array(itemSchema),
  serverTime: z.string().optional(),
  room: roomSchema.optional()
}).passthrough();

export const itemResponseSchema = z.object({
  ok: z.boolean(),
  item: itemSchema
}).passthrough();

export const uploadResponseSchema = z.object({
  ok: z.boolean(),
  upload: z.object({
    id: z.string().min(1),
    uploadUrl: z.string().url(),
    name: z.string().optional(),
    size: z.number().optional(),
    mimeType: z.string().optional()
  }).passthrough()
}).passthrough();

export const fileUrlResponseSchema = z.object({
  ok: z.boolean(),
  url: z.string().url(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  expiresIn: z.number().optional()
}).passthrough();

export const roomSessionResponseSchema = z.object({
  ok: z.boolean(),
  room: roomSchema,
  token: z.string(),
  expiresIn: z.number(),
  code: z.string().optional()
}).passthrough();

export const roomStatusResponseSchema = z.object({
  ok: z.boolean(),
  room: roomSchema,
  serverTime: z.string().optional()
}).passthrough();

export const roomCapacityResponseSchema = z.object({
  ok: z.boolean(),
  active: z.number(),
  maximum: z.number(),
  available: z.number()
}).passthrough();

export const roomsResponseSchema = z.object({
  ok: z.boolean(),
  rooms: z.array(roomSchema)
}).passthrough();

export const adminUsageResponseSchema = z.object({
  ok: z.boolean(),
  storage: z.object({
    estimatedBytes: z.number(),
    activeBytes: z.number(),
    orphanBytes: z.number(),
    referenceBytes: z.number(),
    freeEstimatedBytes: z.number(),
    warningBytes: z.number(),
    internalLimitBytes: z.number(),
    warning: z.boolean(),
    blocked: z.boolean()
  }).passthrough(),
  today: usagePeriodSchema,
  last7Days: usagePeriodSchema,
  rooms: z.object({ active: z.number(), maximum: z.number() }).passthrough(),
  limits: z.object({
    maxFileBytes: z.number(),
    storageReferenceBytes: z.number(),
    storageWarningBytes: z.number(),
    storageInternalLimitBytes: z.number(),
    maxRooms: z.number(),
    roomMaxTtlMinutes: z.number(),
    roomLifetimeMinutes: z.number(),
    roomInactivityMinutes: z.number(),
    roomMaxFileBytes: z.number(),
    roomMaxBytes: z.number(),
    roomMaxItems: z.number(),
    activeItems: z.number(),
    pendingUploads: z.number(),
    cleanupFailures: z.number(),
    orphanItems: z.number(),
    missingItems: z.number()
  }).passthrough()
}).passthrough();

export const adminHealthResponseSchema = z.object({
  ok: z.boolean(),
  health: z.object({
    worker: healthItemSchema,
    d1: healthItemSchema,
    b2: healthItemSchema,
    b2Signing: healthItemSchema,
    resend: z.object({ ok: z.boolean(), configured: z.boolean() }).passthrough(),
    cleanup: z.object({ ok: z.boolean(), lastCleanupAt: z.string().nullable(), failures: z.number() }).passthrough(),
    reconcile: z.object({
      lastReconcileAt: z.string().nullable(),
      orphanCount: z.number(),
      orphanBytes: z.number(),
      missingCount: z.number()
    }).passthrough()
  }).passthrough()
}).passthrough();

export const operationResponseSchema = z.object({ ok: z.boolean() }).passthrough();
export const statusResponseSchema = z.object({ ok: z.boolean(), status: z.string().optional() }).passthrough();
export const passthroughResponseSchema = z.object({ ok: z.boolean() }).passthrough();

export function criticalJson(
  schema: z.ZodType,
  body: unknown,
  status: number,
  origin: string
): Response {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    console.error("Respuesta crítica inválida.", parsed.error.issues);
    throw new Error("El Worker generó una respuesta incompatible con su contrato.");
  }

  return jsonResponse(parsed.data, status, origin);
}
