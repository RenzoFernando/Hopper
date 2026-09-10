import { MAX_FAILED_ATTEMPTS, SESSION_TTL_SECONDS } from "../lib/constants.ts";
import { HttpError, getClientInfo, jsonResponse, normalizeText } from "../lib/http.ts";
import {
  emptyBodySchema,
  loginBodySchema,
  parseJsonBody,
  recoveryResetBodySchema,
  recoveryVerifyBodySchema
} from "../schemas/requests.ts";
import {
  criticalJson,
  loginResponseSchema,
  recoveryResponseSchema,
  securityStatusResponseSchema
} from "../schemas/responses.ts";
import { issueRecovery, resetPinWithRecovery, verifyRecoveryToken } from "../services/recovery.ts";
import {
  createSessionToken,
  enforceRateLimit,
  ensureClientAllowed,
  getSecurityState,
  getSessionVersion,
  isValidPin,
  logSecurityEvent,
  registerFailedAttempt,
  registerSuccessfulPin,
  verifyConfiguredPin
} from "../services/security.ts";
import type { HopperApp, HopperContext } from "./common.ts";
import { responseOrigin } from "./common.ts";

export function registerAuthRoutes(app: HopperApp): void {
  app.get("/api/security/status", async (c: HopperContext) => {
    const client = getClientInfo(c.req.raw);
    await ensureClientAllowed(c.env.DB, client);
    await enforceRateLimit(c.env.DB, client, "security-status", 60, 60);
    const state = await getSecurityState(c.env.DB);

    return criticalJson(securityStatusResponseSchema, {
      ok: true,
      locked: state.locked,
      remainingAttempts: Math.max(MAX_FAILED_ATTEMPTS - state.failedAttempts, 0)
    }, 200, responseOrigin(c));
  });

  app.post("/api/auth/login", async (c: HopperContext) => {
    const client = getClientInfo(c.req.raw);
    await ensureClientAllowed(c.env.DB, client);
    await enforceRateLimit(c.env.DB, client, "auth-login", 12, 60);
    const body = await parseJsonBody(c.req.raw, loginBodySchema);
    const pin = normalizeText(body.pin);

    if (!isValidPin(pin)) {
      throw new HttpError(400, "invalid-pin-format", "El PIN debe tener exactamente 4 dígitos numéricos.");
    }

    const initialState = await getSecurityState(c.env.DB);

    if (initialState.locked) {
      await logSecurityEvent(c.env.DB, "pin-attempt-while-locked", client);
      return criticalJson(loginResponseSchema, {
        ok: false,
        status: "locked",
        remainingAttempts: 0
      }, 200, responseOrigin(c));
    }

    if (!(await verifyConfiguredPin(c.env, pin))) {
      const state = await registerFailedAttempt(c.env.DB, client);

      if (state.newlyLocked) {
        try {
          await issueRecovery(c.env, client, { enforceCooldown: false });
        } catch (error) {
          console.error("Hopper quedó bloqueado y no fue posible enviar la recuperación automática.", error);
        }
      }

      return criticalJson(loginResponseSchema, {
        ok: false,
        status: state.locked ? "locked" : "invalid-pin",
        remainingAttempts: state.remainingAttempts
      }, 200, responseOrigin(c));
    }

    const state = await registerSuccessfulPin(c.env.DB, client);

    if (state.locked) {
      return criticalJson(loginResponseSchema, {
        ok: false,
        status: "locked",
        remainingAttempts: 0
      }, 200, responseOrigin(c));
    }

    const sessionVersion = await getSessionVersion(c.env.DB);
    const token = await createSessionToken(c.env.SESSION_SECRET, sessionVersion);

    return criticalJson(loginResponseSchema, {
      ok: true,
      status: "authorized",
      remainingAttempts: MAX_FAILED_ATTEMPTS,
      token,
      expiresIn: SESSION_TTL_SECONDS
    }, 200, responseOrigin(c));
  });

  app.post("/api/recovery/request", async (c: HopperContext) => {
    const client = getClientInfo(c.req.raw);
    await ensureClientAllowed(c.env.DB, client);
    await enforceRateLimit(c.env.DB, client, "recovery-request", 4, 60 * 60);
    await parseJsonBody(c.req.raw, emptyBodySchema);
    const result = await issueRecovery(c.env, client);
    return criticalJson(recoveryResponseSchema, result, 200, responseOrigin(c));
  });

  app.post("/api/recovery/verify", async (c: HopperContext) => {
    const client = getClientInfo(c.req.raw);
    await ensureClientAllowed(c.env.DB, client);
    await enforceRateLimit(c.env.DB, client, "recovery-verify", 20, 60);
    const body = await parseJsonBody(c.req.raw, recoveryVerifyBodySchema);
    const result = await verifyRecoveryToken(c.env, body.token, client);
    return criticalJson(recoveryResponseSchema, result, 200, responseOrigin(c));
  });

  app.post("/api/recovery/reset", async (c: HopperContext) => {
    const client = getClientInfo(c.req.raw);
    await ensureClientAllowed(c.env.DB, client);
    await enforceRateLimit(c.env.DB, client, "recovery-reset", 10, 60);
    const body = await parseJsonBody(c.req.raw, recoveryResetBodySchema);
    const result = await resetPinWithRecovery(
      c.env,
      body.token,
      body.pin,
      body.confirmation,
      client
    );
    return criticalJson(recoveryResponseSchema, result, 200, responseOrigin(c));
  });
}
