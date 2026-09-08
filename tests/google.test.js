import test from "node:test";
import assert from "node:assert/strict";
import { rfc3986Encode } from "../cloudflare/src/crypto.js";
import { canonicalQueryString } from "../cloudflare/src/google.js";

test("codifica componentes RFC3986 usados por Storage", () => {
  assert.equal(rfc3986Encode("a b/c"), "a%20b%2Fc");
  assert.equal(rfc3986Encode("!'()*"), "%21%27%28%29%2A");
});

test("ordena y codifica parámetros canónicos", () => {
  const value = canonicalQueryString({ z: "último", a: "uno dos", b: "x/y" });
  assert.equal(value, "a=uno%20dos&b=x%2Fy&z=%C3%BAltimo");
});
