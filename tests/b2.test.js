import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalQueryString,
  createSignedB2Url,
  parseB2Endpoint,
  parseB2VersionList
} from "../cloudflare/src/b2.js";

test("valida y extrae la región del endpoint S3 de Backblaze B2", () => {
  assert.deepEqual(
    parseB2Endpoint("https://s3.us-west-004.backblazeb2.com"),
    {
      endpoint: "https://s3.us-west-004.backblazeb2.com",
      host: "s3.us-west-004.backblazeb2.com",
      region: "us-west-004"
    }
  );
  assert.throws(() => parseB2Endpoint("https://example.com"));
});

test("conserva subrecursos vacíos y codifica la consulta SigV4", () => {
  const value = canonicalQueryString({
    versions: "",
    prefix: "drop/a b/",
    "max-keys": "1000"
  });

  assert.equal(value, "max-keys=1000&prefix=drop%2Fa%20b%2F&versions=");
});

test("firma de forma determinista una URL PUT de Backblaze B2", async () => {
  const env = {
    B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    B2_BUCKET_NAME: "hopper-files-test",
    B2_KEY_ID: "test-access-key",
    B2_APPLICATION_KEY: "test-secret-key"
  };
  const url = await createSignedB2Url(env, {
    method: "PUT",
    objectName: "drop/abc/reporte final.zip",
    expiresSeconds: 900,
    contentType: "application/zip",
    now: new Date("2026-09-07T20:00:00.000Z")
  });

  assert.equal(
    url,
    "https://s3.us-west-004.backblazeb2.com/hopper-files-test/drop/abc/reporte%20final.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test-access-key%2F20260907%2Fus-west-004%2Fs3%2Faws4_request&X-Amz-Date=20260907T200000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=693546ae60e0c3cb4342e5d56137acd58d2e1680dd5fa4720293373696104266"
  );
});

test("interpreta versiones y marcadores de borrado de Backblaze B2", () => {
  const parsed = parseB2VersionList(`<?xml version="1.0" encoding="UTF-8"?>
<ListVersionsResult>
  <IsTruncated>true</IsTruncated>
  <NextKeyMarker>drop/a&amp;b.txt</NextKeyMarker>
  <NextVersionIdMarker>v-next</NextVersionIdMarker>
  <Version>
    <Key>drop/a&amp;b.txt</Key>
    <VersionId>v-1</VersionId>
  </Version>
  <DeleteMarker>
    <Key>drop/a&amp;b.txt</Key>
    <VersionId>v-2</VersionId>
  </DeleteMarker>
</ListVersionsResult>`);

  assert.deepEqual(parsed, {
    entries: [
      { key: "drop/a&b.txt", versionId: "v-1", deleteMarker: false },
      { key: "drop/a&b.txt", versionId: "v-2", deleteMarker: true }
    ],
    truncated: true,
    nextKeyMarker: "drop/a&b.txt",
    nextVersionIdMarker: "v-next"
  });
});
