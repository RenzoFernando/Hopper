import { loginResponseSchema, operationResponseSchema, securityStatusSchema } from "../schemas/auth";
import { recoveryResponseSchema } from "../schemas/recovery";
import { request, sessionStore } from "./client";

export const authApi = {
  securityStatus: () => request("/api/security/status", securityStatusSchema),
  async login(pin: string) {
    const result = await request("/api/auth/login", loginResponseSchema, { method: "POST", body: { pin } });
    if (result.ok && result.token && result.expiresIn) sessionStore.setPersonal(result.token, result.expiresIn);
    return result;
  },
  requestRecovery: () => request("/api/recovery/request", recoveryResponseSchema, { method: "POST", body: {} }),
  logout() {
    sessionStore.clearPersonal();
    return Promise.resolve(operationResponseSchema.parse({ ok: true }));
  }
};
