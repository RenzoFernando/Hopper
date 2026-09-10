import { z } from "zod";

export const itemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "file"]),
  status: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  ttlMinutes: z.number(),
  content: z.string().optional(),
  name: z.string().optional(),
  size: z.number().optional(),
  mimeType: z.string().optional(),
  previewable: z.boolean().optional(),
  audio: z.boolean().optional()
}).passthrough();

export const itemsResponseSchema = z.object({
  ok: z.boolean(),
  items: z.array(itemSchema),
  serverTime: z.string().optional()
}).passthrough();

export const itemResponseSchema = z.object({
  ok: z.boolean(),
  item: itemSchema
}).passthrough();

export const uploadSchema = z.object({
  id: z.string().min(1),
  uploadUrl: z.string().url(),
  name: z.string().optional(),
  size: z.number().optional(),
  mimeType: z.string().optional()
}).passthrough();

export const uploadResponseSchema = z.object({
  ok: z.boolean(),
  upload: uploadSchema
}).passthrough();

export const fileUrlResponseSchema = z.object({
  ok: z.boolean(),
  url: z.string().url(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  expiresIn: z.number().optional()
}).passthrough();

export type HopperItem = z.infer<typeof itemSchema>;
export type ItemsResponse = z.infer<typeof itemsResponseSchema>;
export type ItemResponse = z.infer<typeof itemResponseSchema>;
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type FileUrlResponse = z.infer<typeof fileUrlResponseSchema>;
