import { recoveryResponseSchema } from "../schemas/recovery";
import { request } from "./client";

export const recoveryApi = {
  verify: (token: string) => request("/api/recovery/verify", recoveryResponseSchema, { method: "POST", body: { token } }),
  resetPin: (token: string, pin: string, confirmation: string) => request("/api/recovery/reset", recoveryResponseSchema, {
    method: "POST",
    body: { token, pin, confirmation }
  })
};
