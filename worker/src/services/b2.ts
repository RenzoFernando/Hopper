import type { Env } from "../types/env.ts";
import { bytesToHex, rfc3986Encode, sha256Bytes, toArrayBuffer } from "../lib/crypto.ts";
import { HttpError } from "../lib/http.ts";

export interface B2VersionEntry {
  key: string;
  versionId: string;
  deleteMarker: boolean;
  isLatest: boolean;
  size: number;
  lastModified: string | null;
  etag: string | null;
}

type QueryParameterValue = string | number | boolean | null | undefined;
type QueryParameters = Record<string, QueryParameterValue>;

interface SignedB2UrlOptions {
  method: string;
  objectName?: string;
  expiresSeconds: number;
  contentType?: string;
  queryParameters?: QueryParameters;
  now?: Date;
}

function encodePathSegment(value: unknown): string {
  return rfc3986Encode(String(value));
}

function encodeObjectKey(value: string): string {
  return String(value)
    .split("/")
    .map(encodePathSegment)
    .join("/");
}

export function canonicalQueryString(parameters: QueryParameters): string {
  return Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [rfc3986Encode(key), rfc3986Encode(value)] as const)
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

function awsTimestamp(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function hmacSha256(key: Uint8Array | string, value: string): Promise<Uint8Array> {
  const keyBytes = key instanceof Uint8Array ? key : new TextEncoder().encode(String(key));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(String(value)))
  );
}

async function signingKey(secret: string, date: string, region: string): Promise<Uint8Array> {
  const dateKey = await hmacSha256(`AWS4${secret}`, date);
  const regionKey = await hmacSha256(dateKey, region);
  const serviceKey = await hmacSha256(regionKey, "s3");
  return hmacSha256(serviceKey, "aws4_request");
}

export function parseB2Endpoint(value: unknown) {
  let url;

  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("B2_ENDPOINT no contiene una URL válida.");
  }

  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("B2_ENDPOINT debe ser el endpoint HTTPS base de Backblaze B2.");
  }

  const match = url.hostname.toLowerCase().match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/);

  if (!match) {
    throw new Error("B2_ENDPOINT no corresponde a un endpoint S3 de Backblaze B2.");
  }

  return {
    endpoint: `https://${url.hostname.toLowerCase()}`,
    host: url.hostname.toLowerCase(),
    region: match[1]
  };
}

function validBucketName(value: unknown): string {
  const bucket = String(value || "").trim();

  if (
    bucket.length < 6
    || bucket.length > 63
    || !/^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$/.test(bucket)
    || bucket.toLowerCase().startsWith("b2-")
    || bucket.includes("..")
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucket)
  ) {
    return "";
  }

  return bucket;
}

function signingConfig(env: Env) {
  const bucket = validBucketName(env.B2_BUCKET_NAME);
  const accessKeyId = String(env.B2_KEY_ID || "").trim();
  const secretAccessKey = String(env.B2_APPLICATION_KEY || "").trim();
  const endpoint = parseB2Endpoint(env.B2_ENDPOINT);

  if (!bucket) {
    throw new Error("B2_BUCKET_NAME no está configurado correctamente.");
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Las credenciales de Backblaze B2 no están configuradas.");
  }

  return {
    ...endpoint,
    bucket,
    accessKeyId,
    secretAccessKey
  };
}

export async function createSignedB2Url(env: Env, {
  method,
  objectName = "",
  expiresSeconds,
  contentType = "",
  queryParameters = {},
  now = new Date()
}: SignedB2UrlOptions): Promise<string> {
  const {
    endpoint,
    host,
    region,
    bucket,
    accessKeyId,
    secretAccessKey
  } = signingConfig(env);
  const verb = String(method || "GET").toUpperCase();
  const encodedBucket = encodePathSegment(bucket);
  const encodedObject = objectName ? `/${encodeObjectKey(objectName)}` : "";
  const canonicalUri = `/${encodedBucket}${encodedObject}`;
  const timestamp = awsTimestamp(now);
  const date = timestamp.slice(0, 8);
  const credentialScope = `${date}/${region}/s3/aws4_request`;
  const ttl = Math.max(1, Math.min(604800, Math.floor(Number(expiresSeconds) || 1)));
  const normalizedContentType = String(contentType || "").trim().toLowerCase();
  const signedHeaders = verb === "PUT" && normalizedContentType
    ? "content-type;host"
    : "host";
  const query = {
    ...queryParameters,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": String(ttl),
    "X-Amz-SignedHeaders": signedHeaders
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
  const keyBytes = await signingKey(secretAccessKey, date, region);
  const signature = bytesToHex(await hmacSha256(keyBytes, stringToSign));

  return `${endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function xmlDecode(value: string): string {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function tagValue(block: string, tag: string): string {
  const match = String(block).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? xmlDecode(match[1]) : "";
}

export function parseB2VersionList(xml: unknown) {
  const source = String(xml || "");
  const entries: B2VersionEntry[] = [];
  const blockPattern = /<(Version|DeleteMarker)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = blockPattern.exec(source)) !== null) {
    const key = tagValue(match[2], "Key");
    const versionId = tagValue(match[2], "VersionId");

    if (key && versionId) {
      const deleteMarker = match[1].toLowerCase() === "deletemarker";
      const size = Number(tagValue(match[2], "Size") || 0);

      entries.push({
        key,
        versionId,
        deleteMarker,
        isLatest: tagValue(match[2], "IsLatest").toLowerCase() === "true",
        size: deleteMarker || !Number.isFinite(size) ? 0 : size,
        lastModified: tagValue(match[2], "LastModified") || null,
        etag: tagValue(match[2], "ETag").replace(/^"|"$/g, "") || null
      });
    }
  }

  return {
    entries,
    truncated: tagValue(source, "IsTruncated").toLowerCase() === "true",
    nextKeyMarker: tagValue(source, "NextKeyMarker"),
    nextVersionIdMarker: tagValue(source, "NextVersionIdMarker")
  };
}

async function requireB2Ok(response: Response, message: string, code = "b2-error"): Promise<Response> {
  if (response.ok) {
    return response;
  }

  let details = "";

  try {
    details = (await response.text()).slice(0, 700);
  } catch {
    details = "";
  }

  console.error(message, response.status, details);
  throw new HttpError(502, code, message);
}

export async function getB2ObjectMetadata(env: Env, objectName: string) {
  const normalizedObjectName = String(objectName);
  const listed = await listB2ObjectVersions(env, normalizedObjectName);
  const exactEntries = listed.entries.filter((entry) => entry.key === normalizedObjectName);
  const latest = exactEntries.find((entry) => entry.isLatest) || exactEntries[0];

  if (!latest || latest.deleteMarker) {
    return null;
  }

  return {
    size: Number(latest.size || 0),
    contentType: "",
    versionId: latest.versionId,
    etag: latest.etag || null,
    lastModified: latest.lastModified || null
  };
}

async function listB2ObjectVersions(env: Env, objectName: string) {
  const url = await createSignedB2Url(env, {
    method: "GET",
    expiresSeconds: 60,
    queryParameters: {
      versions: "",
      prefix: objectName,
      "max-keys": "9"
    }
  });
  const response = await fetch(url, { method: "GET" });
  await requireB2Ok(response, "Backblaze B2 no pudo enumerar las versiones del archivo.", "storage-error");
  const parsed = parseB2VersionList(await response.text());

  return {
    entries: parsed.entries.filter((entry) => entry.key === objectName),
    truncated: parsed.truncated
  };
}

export async function deleteB2Version(env: Env, objectName: string, versionId: string): Promise<void> {
  const url = await createSignedB2Url(env, {
    method: "DELETE",
    objectName,
    expiresSeconds: 60,
    queryParameters: { versionId }
  });
  const response = await fetch(url, { method: "DELETE" });

  if (response.status === 404) {
    return;
  }

  await requireB2Ok(response, "Backblaze B2 no pudo eliminar una versión del archivo.", "storage-error");
}


export async function listB2VersionsByPrefix(env: Env, prefix = "drop/", maxPages = 20) {
  const entries: B2VersionEntry[] = [];
  let keyMarker = "";
  let versionIdMarker = "";
  let truncated = false;
  let pages = 0;

  do {
    const queryParameters: Record<string, string> = {
      versions: "",
      prefix: String(prefix || ""),
      "max-keys": "1000"
    };

    if (keyMarker) {
      queryParameters["key-marker"] = keyMarker;
    }

    if (versionIdMarker) {
      queryParameters["version-id-marker"] = versionIdMarker;
    }

    const url = await createSignedB2Url(env, {
      method: "GET",
      expiresSeconds: 60,
      queryParameters
    });
    const response = await fetch(url, { method: "GET" });
    await requireB2Ok(response, "Backblaze B2 no pudo enumerar el almacenamiento de Hopper.", "storage-error");
    const parsed = parseB2VersionList(await response.text());
    entries.push(...parsed.entries);
    truncated = parsed.truncated;
    keyMarker = parsed.nextKeyMarker;
    versionIdMarker = parsed.nextVersionIdMarker;
    pages += 1;
  } while (truncated && keyMarker && pages < Math.max(1, Math.floor(Number(maxPages) || 20)));

  return { entries, truncated, pages };
}

export async function deleteB2Object(env: Env, objectName: string): Promise<void> {
  const listed = await listB2ObjectVersions(env, String(objectName));
  const versions = listed.entries.slice(0, 8);

  for (const entry of versions) {
    await deleteB2Version(env, entry.key, entry.versionId);
  }

  if (listed.truncated || listed.entries.length > versions.length) {
    throw new HttpError(
      502,
      "storage-cleanup-incomplete",
      "El archivo tiene más versiones pendientes de limpieza. Hopper continuará en el siguiente ciclo."
    );
  }
}

export async function checkB2Access(env: Env) {
  const objectName = `drop/__hopper_storage_check__/${crypto.randomUUID()}.txt`;
  let uploaded = false;

  try {
    const uploadUrl = await createSignedB2Url(env, {
      method: "PUT",
      objectName,
      expiresSeconds: 60,
      contentType: "text/plain"
    });
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: "ok"
    });
    await requireB2Ok(uploadResponse, "Backblaze B2 rechazó la prueba de escritura.", "storage-check-failed");
    uploaded = true;

    const metadata = await getB2ObjectMetadata(env, objectName);

    if (!metadata || metadata.size !== 2) {
      throw new HttpError(502, "storage-check-failed", "Backblaze B2 no confirmó correctamente la prueba de lectura.");
    }

    await deleteB2Object(env, objectName);
    uploaded = false;

    return {
      bucket: signingConfig(env).bucket,
      endpoint: signingConfig(env).endpoint
    };
  } catch (error) {
    if (uploaded) {
      await deleteB2Object(env, objectName).catch((cleanupError: unknown) => {
        console.error("No fue posible retirar el archivo temporal de comprobación de B2.", cleanupError);
      });
    }

    throw error;
  }
}
