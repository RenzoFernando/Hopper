import test from "node:test";
import assert from "node:assert/strict";
import { buildRecoveryUrl } from "../worker/src/services/recovery.ts";
import {
  createSessionToken,
  ipv4MatchesCidr,
  isValidPin,
  verifySessionToken
} from "../worker/src/services/security.ts";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";

test("acepta únicamente PIN numérico de cuatro dígitos", () => {
  assert.equal(isValidPin("1234"), true);
  assert.equal(isValidPin(" 1234 "), true);
  assert.equal(isValidPin("123"), false);
  assert.equal(isValidPin("12a4"), false);
  assert.equal(isValidPin("12345"), false);
});

test("crea y verifica una sesión firmada", async () => {
  const now = Date.UTC(2026, 8, 7, 20, 0, 0);
  const token = await createSessionToken(SECRET, 7, now);
  const session = await verifySessionToken(token, SECRET, now + 1000);

  assert.equal(session.ver, 7);
  assert.ok(session.exp > session.iat);
});

test("rechaza una sesión alterada o expirada", async () => {
  const now = Date.UTC(2026, 8, 7, 20, 0, 0);
  const token = await createSessionToken(SECRET, 1, now);
  const [body, signature] = token.split(".");
  const tamperedSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  const tampered = `${body}.${tamperedSignature}`;

  assert.equal(await verifySessionToken(tampered, SECRET, now + 1000), null);
  assert.equal(await verifySessionToken(token, SECRET, now + 31 * 60 * 1000), null);
});

test("evalúa redes IPv4 CIDR", () => {
  assert.equal(ipv4MatchesCidr("192.168.1.42", "192.168.1.0/24"), true);
  assert.equal(ipv4MatchesCidr("192.168.2.42", "192.168.1.0/24"), false);
  assert.equal(ipv4MatchesCidr("203.0.113.8", "0.0.0.0/0"), true);
  assert.equal(ipv4MatchesCidr("invalid", "192.168.1.0/24"), false);
});


test("genera enlaces de recuperación con la ruta limpia actual", () => {
  const token = "A".repeat(43);
  const base = { PUBLIC_APP_URL: "https://hopper.example/" };
  expectRecoveryUrl(buildRecoveryUrl(base, token), `https://hopper.example/recover#${token}`);
});

function expectRecoveryUrl(actual, expected) {
  assert.equal(actual, expected);
}