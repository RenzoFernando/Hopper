import test from "node:test";
import assert from "node:assert/strict";
import { rfc3986Encode } from "../cloudflare/src/crypto.js";
import { canonicalQueryString, createSignedR2Url } from "../cloudflare/src/r2.js";

test("codifica componentes RFC3986 usados por R2", () => {
  assert.equal(rfc3986Encode("a b/c"), "a%20b%2Fc");
  assert.equal(rfc3986Encode("!'()*"), "%21%27%28%29%2A");
});

test("ordena y codifica parámetros canónicos", () => {
  const value = canonicalQueryString({ z: "último", a: "uno dos", b: "x/y" });
  assert.equal(value, "a=uno%20dos&b=x%2Fy&z=%C3%BAltimo");
});

test("firma una URL PUT de R2 con Content-Type", async () => {
  const env = {
    R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    R2_BUCKET_NAME: "hopper-files",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key"
  };
  const url = new URL(await createSignedR2Url(env, {
    method: "PUT",
    objectName: "drop/123/reporte final.zip",
    expiresSeconds: 900,
    contentType: "application/zip",
    now: new Date("2026-09-07T20:00:00.000Z")
  }));

  assert.equal(url.hostname, "hopper-files.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
  assert.equal(url.pathname, "/drop/123/reporte%20final.zip");
  assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.equal(url.searchParams.get("X-Amz-Date"), "20260907T200000Z");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
  assert.equal(url.searchParams.get("X-Amz-Signature"), "6b5cf919126a84c26a7f0de26dba492a874b282dd28a8d61ad4dd161970517be");
});
