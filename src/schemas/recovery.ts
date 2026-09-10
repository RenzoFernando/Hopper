import { z } from "zod";

export const recoveryResponseSchema = z.object({
  ok: z.boolean(),
  status: z.string()
}).passthrough();

export type RecoveryResponse = z.infer<typeof recoveryResponseSchema>;
