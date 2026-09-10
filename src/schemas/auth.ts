import { z } from "zod";

export const securityStatusSchema = z.object({
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

export const operationResponseSchema = z.object({ ok: z.boolean() }).passthrough();

export type SecurityStatus = z.infer<typeof securityStatusSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
