import { z } from "zod";
import { roomSchema } from "./room";

const usagePeriodSchema = z.object({
  uploadsCount: z.number(),
  uploadBytes: z.number(),
  deletedBytes: z.number(),
  failedUploads: z.number(),
  cleanupFailures: z.number()
}).passthrough();

export const adminUsageSchema = z.object({
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
    roomMaxTtlMinutes: z.number().optional(),
    roomLifetimeMinutes: z.number().optional(),
    roomInactivityMinutes: z.number().optional(),
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

const healthItemSchema = z.object({ ok: z.boolean() }).passthrough();

export const adminHealthSchema = z.object({
  ok: z.boolean(),
  health: z.object({
    worker: healthItemSchema,
    d1: healthItemSchema,
    b2: healthItemSchema,
    b2Signing: healthItemSchema,
    resend: z.object({ ok: z.boolean(), configured: z.boolean() }).passthrough(),
    cleanup: z.object({ ok: z.boolean(), lastCleanupAt: z.string().nullable(), failures: z.number() }).passthrough(),
    reconcile: z.object({ lastReconcileAt: z.string().nullable(), orphanCount: z.number(), orphanBytes: z.number(), missingCount: z.number() }).passthrough()
  }).passthrough()
}).passthrough();

export const adminRoomsSchema = z.object({ ok: z.boolean(), rooms: z.array(roomSchema) }).passthrough();
export const adminCleanupSchema = z.object({
  ok: z.boolean(),
  items: z.object({ deleted: z.number().optional() }).passthrough().optional()
}).passthrough();
export const adminReconcileSchema = z.object({ ok: z.boolean(), orphanDeleted: z.number().optional() }).passthrough();
export const adminStatusSchema = z.object({ ok: z.boolean(), status: z.string().optional() }).passthrough();

export type AdminUsage = z.infer<typeof adminUsageSchema>;
export type AdminHealth = z.infer<typeof adminHealthSchema>["health"];
