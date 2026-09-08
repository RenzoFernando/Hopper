import { bytesToHex, rfc3986Encode, sha256Bytes } from "./crypto.js";
import { HttpError } from "./http.js";

function encodePathSegment(value) {
  return rfc3986Encode(String(value));
}

function encodeObjectKey(value) {
  return String(value)
    .split("/")
    .map(encodePathSegment)
    .join("/");
}

export function canonicalQueryString(parameters) {
  return Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null)
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

async function signingKey(secret, date, region) {
  const dateKey = await hmacSha256(`AWS4${secret}`, date);
  const regionKey = await hmacSha256(dateKey, region);
  const serviceKey = await hmacSha256(regionKey, "s3");
  return hmacSha256(serviceKey, "aws4_request");
}

export function parseB2Endpoint(value) {
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

function validBucketName(value) {
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

function signingConfig(env) {
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

export async function createSignedB2Url(env, {
  method,
  objectName = "",
  expiresSeconds,
  contentType = "",
  queryParameters = {},
  now = new Date()
}) {
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

function xmlDecode(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function tagValue(block, tag) {
  const match = String(block).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? xmlDecode(match[1]) : "";
}

export function parseB2VersionList(xml) {
  const source = String(xml || "");
  const entries = [];
  const blockPattern = /<(Version|DeleteMarker)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = blockPattern.exec(source)) !== null) {
    const key = tagValue(match[2], "Key");
    const versionId = tagValue(match[2], "VersionId");

    if (key && versionId) {
      entries.push({
        key,
        versionId,
        deleteMarker: match[1].toLowerCase() === "deletemarker"
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

async function requireB2Ok(response, message, code = "b2-error") {
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

export async function getB2ObjectMetadata(env, objectName) {
  const url = await createSignedB2Url(env, {
    method: "HEAD",
    objectName,
    expiresSeconds: 60
  });
  const response = await fetch(url, { method: "HEAD" });

  if (response.status === 404) {
    return null;
  }

  await requireB2Ok(response, "Backblaze B2 no pudo verificar el archivo.", "storage-error");
  const size = Number(response.headers.get("Content-Length") || 0);

  return {
    size: Number.isFinite(size) ? size : 0,
    contentType: response.headers.get("Content-Type") || "",
    versionId: response.headers.get("x-amz-version-id") || ""
  };
}

async function listB2ObjectVersions(env, objectName) {
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

async function deleteB2Version(env, objectName, versionId) {
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

export async function deleteB2Object(env, objectName) {
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

export async function checkB2Access(env) {
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
      await deleteB2Object(env, objectName).catch((cleanupError) => {
        console.error("No fue posible retirar el archivo temporal de comprobación de B2.", cleanupError);
      });
    }

    throw error;
  }
}
