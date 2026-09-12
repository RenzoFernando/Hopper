import { z } from "zod";

export const roomSchema = z.object({
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

export const roomCapacitySchema = z.object({
  ok: z.boolean(),
  active: z.number(),
  maximum: z.number(),
  available: z.number()
}).passthrough();

export const roomsResponseSchema = z.object({
  ok: z.boolean(),
  rooms: z.array(roomSchema)
}).passthrough();

export const roomActivityResponseSchema = z.object({
  ok: z.boolean(),
  room: roomSchema
}).passthrough();

export type Room = z.infer<typeof roomSchema>;
export type RoomSessionResponse = z.infer<typeof roomSessionResponseSchema>;
export type RoomStatusResponse = z.infer<typeof roomStatusResponseSchema>;
export type RoomCapacity = z.infer<typeof roomCapacitySchema>;
