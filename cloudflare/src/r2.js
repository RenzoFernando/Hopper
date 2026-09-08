import { bytesToHex, rfc3986Encode, sha256Bytes } from "./crypto.js";

function encodeObjectKey(value) {
  return String(value)
    .split("/")
    .map((part) => rfc3986Encode(part))
    .join("/");
}

export function canonicalQueryString(parameters) {
  return Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [rfc3986Encode(key), rfc3986Encode(value)])
    .sort(([firstKey, firstValue], [secondKey, secondValue]) => {
      if (firstKey !== secondKey) {
        return firstKey < secondKey ? -1 : 1;
      }

      if (firstValue === secondValue) {
        return 0;
      }

      return firstValue < secondValue ? -1 : 1;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function awsTimestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function hmacSha256(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key instanceof Uint8Array ? key : new TextEncoder().encode(String(key)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(String(value)))
  );
}

async function signingKey(secret, date) {
  const dateKey = await hmacSha256(`AWS4${secret}`, date);
  const regionKey = await hmacSha256(dateKey, "auto");
  const serviceKey = await hmacSha256(regionKey, "s3");
  return hmacSha256(serviceKey, "aws4_request");
}

function signingConfig(env) {
  const accountId = String(env.R2_ACCOUNT_ID || "").trim().toLowerCase();
  const bucket = String(env.R2_BUCKET_NAME || "").trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || "").trim();

  if (!/^[0-9a-f]{32}$/.test(accountId)) {
    throw new Error("R2_ACCOUNT_ID no está configurado correctamente.");
  }

  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("R2_BUCKET_NAME no está configurado correctamente.");
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Las credenciales de firma de R2 no están configuradas.");
  }

  return { accountId, bucket, accessKeyId, secretAccessKey };
}

export async function createSignedR2Url(env, {
  method,
  objectName,
  expiresSeconds,
  contentType = "",
  responseDisposition = "",
  now = new Date()
}) {
  const { accountId, bucket, accessKeyId, secretAccessKey } = signingConfig(env);
  const verb = String(method || "GET").toUpperCase();
  const key = encodeObjectKey(objectName);
  const host = `${bucket}.${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${key}`;
  const timestamp = awsTimestamp(now);
  const date = timestamp.slice(0, 8);
  const credentialScope = `${date}/auto/s3/aws4_request`;
  const ttl = Math.max(1, Math.min(604800, Math.floor(Number(expiresSeconds) || 1)));
  const normalizedContentType = String(contentType || "").trim().toLowerCase();
  const signedHeaders = verb === "PUT" && normalizedContentType
    ? "content-type;host"
    : "host";
  const query = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": String(ttl),
    "X-Amz-SignedHeaders": signedHeaders,
    ...(responseDisposition ? { "response-content-disposition": responseDisposition } : {})
  };
  const canonicalQuery = canonicalQueryString(query);
  const canonicalHeaders = signedHeaders === "content-type;host"
    ? `content-type:${normalizedContentType}\nhost:${host}\n`
    : `host:${host}\n`;
  const canonicalRequest = [
    verb,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const requestHash = bytesToHex(await sha256Bytes(canonicalRequest));
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    requestHash
  ].join("\n");
  const keyBytes = await signingKey(secretAccessKey, date);
  const signature = bytesToHex(await hmacSha256(keyBytes, stringToSign));

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function requireR2Binding(env) {
  if (!env.FILES || typeof env.FILES.head !== "function" || typeof env.FILES.delete !== "function") {
    throw new Error("El binding FILES de R2 no está configurado.");
  }

  return env.FILES;
}

export async function getR2ObjectMetadata(env, objectName) {
  return requireR2Binding(env).head(String(objectName));
}

export async function deleteR2Object(env, objectName) {
  await requireR2Binding(env).delete(String(objectName));
}
