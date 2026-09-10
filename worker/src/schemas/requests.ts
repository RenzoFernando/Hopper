import { z } from "zod";
import { MAX_TEXT_CHARACTERS } from "../lib/constants.ts";
import { HttpError, readJson } from "../lib/http.ts";

const pinSchema = z.string();
const recoveryTokenSchema = z.string();
const uuidSchema = z.string().regex(/^[0-9a-f-]{36}$/i);

export const emptyBodySchema = z.object({}).strip();

export const loginBodySchema = z.object({
  pin: pinSchema
}).strip();

export const recoveryVerifyBodySchema = z.object({
  token: recoveryTokenSchema
}).strip();

export const recoveryResetBodySchema = z.object({
  token: recoveryTokenSchema,
  pin: pinSchema,
  confirmation: pinSchema
}).strip();

export const textItemBodySchema = z.object({
  content: z.string().max(MAX_TEXT_CHARACTERS),
  ttlMinutes: z.union([z.number(), z.string()])
}).strip();

export const fileUploadBodySchema = z.object({
  name: z.string().min(1).max(240),
  size: z.coerce.number().int().min(0),
  mimeType: z.string().max(200).optional().default("application/octet-stream"),
  ttlMinutes: z.union([z.number(), z.string()])
}).strip();

export const ttlBodySchema = z.object({
  ttlMinutes: z.union([z.number(), z.string()])
}).strip();

export const roomCreateBodySchema = z.object({
  ttlMinutes: z.union([z.number(), z.string()]).optional()
}).strip();

export const roomJoinBodySchema = z.object({
  code: z.string()
}).strip();

export const webPinChangeBodySchema = z.object({
  currentPin: pinSchema,
  pin: pinSchema,
  confirmation: pinSchema
}).strip();

export const cliPinChangeBodySchema = z.object({
  pin: pinSchema,
  confirmation: pinSchema
}).strip();

export const deleteStatisticsBodySchema = z.object({
  currentPin: pinSchema,
  confirmation: z.literal("DELETE_STATISTICS")
}).strip();

export const resetSystemBodySchema = z.object({
  currentPin: pinSchema,
  confirmation: z.literal("RESET_SYSTEM")
}).strip();

export const idParamSchema = z.object({
  id: uuidSchema
}).strip();

export const roomIdParamSchema = z.object({
  roomId: uuidSchema
}).strip();

export async function parseJsonBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const body = await readJson(request);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new HttpError(400, "invalid-request", "La solicitud contiene datos no válidos.");
  }

  return parsed.data;
}

export function parseParams<S extends z.ZodType>(value: unknown, schema: S): z.infer<S> {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new HttpError(400, "invalid-request", "La solicitud contiene datos no válidos.");
  }

  return parsed.data;
}
