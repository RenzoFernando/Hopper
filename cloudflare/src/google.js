import {
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_URL
} from "./constants.js";
import {
  base64UrlEncodeBytes,
  base64UrlEncodeText,
  bytesToHex,
  pemToArrayBuffer,
  rfc3986Encode,
  sha256Bytes
} from "./crypto.js";
import { HttpError } from "./http.js";

let accessTokenCache = {
  projectId: "",
  clientEmail: "",
  token: "",
  expiresAt: 0
};

export function parseServiceAccount(env) {
  let serviceAccount;

  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON no contiene un JSON válido.");
  }

  if (
    !serviceAccount
    || typeof serviceAccount.client_email !== "string"
    || typeof serviceAccount.private_key !== "string"
    || typeof serviceAccount.project_id !== "string"
  ) {
    throw new Error("La cuenta de servicio de Firebase está incompleta.");
  }

  if (serviceAccount.project_id !== env.FIREBASE_PROJECT_ID) {
    throw new Error("La cuenta de servicio no pertenece al proyecto Firebase configurado.");
  }

  return serviceAccount;
}

async function importServiceAccountKey(privateKey) {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function createGoogleAssertion(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeText(JSON.stringify({
    alg: "RS256",
    typ: "JWT",
    ...(serviceAccount.private_key_id ? { kid: serviceAccount.private_key_id } : {})
  }));
  const claims = base64UrlEncodeText(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: GOOGLE_SCOPES,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const unsignedToken = `${header}.${claims}`;
  const key = await importServiceAccountKey(serviceAccount.private_key);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(unsignedToken)
    )
  );

  return `${unsignedToken}.${base64UrlEncodeBytes(signature)}`;
}

export async function getGoogleAccessToken(env, forceRefresh = false) {
  const now = Math.floor(Date.now() / 1000);
  const serviceAccount = parseServiceAccount(env);

  if (
    !forceRefresh
    && accessTokenCache.projectId === env.FIREBASE_PROJECT_ID
    && accessTokenCache.clientEmail === serviceAccount.client_email
    && accessTokenCache.token
    && accessTokenCache.expiresAt > now + 60
  ) {
    return accessTokenCache.token;
  }

  const assertion = await createGoogleAssertion(serviceAccount);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    throw new Error(`Google OAuth rechazó la cuenta de servicio (${response.status}).`);
  }

  const result = await response.json();

  if (!result?.access_token) {
    throw new Error("Google OAuth no devolvió un token de acceso.");
  }

  accessTokenCache = {
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: serviceAccount.client_email,
    token: result.access_token,
    expiresAt: now + Number(result.expires_in || 3600)
  };

  return result.access_token;
}

export function firestoreRoot(env) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents`;
}

export async function firestoreRequest(env, path, options = {}, retry = true) {
  const token = await getGoogleAccessToken(env);
  const response = await fetch(`${firestoreRoot(env)}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  if (response.status === 401 && retry) {
    await getGoogleAccessToken(env, true);
    return firestoreRequest(env, path, options, false);
  }

  return response;
}

export async function requireGoogleOk(response, message, code = "firebase-error") {
  if (response.ok) {
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  let details = "";

  try {
    const payload = await response.json();
    details = payload?.error?.message || "";
  } catch {
    try {
      details = await response.text();
    } catch {
      details = "";
    }
  }

  console.error(message, response.status, details.slice(0, 500));
  throw new HttpError(502, code, message);
}

export function canonicalQueryString(parameters) {
  return Object.entries(parameters)
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

function storageCanonicalUri(bucket, objectName) {
  const encodedObject = String(objectName)
    .split("/")
    .map((part) => rfc3986Encode(part))
    .join("/");
  return `/${rfc3986Encode(bucket)}/${encodedObject}`;
}

function googleTimestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export async function createSignedStorageUrl(env, {
  method,
  objectName,
  expiresSeconds,
  responseDisposition = ""
}) {
  const serviceAccount = parseServiceAccount(env);
  const bucket = String(env.FIREBASE_STORAGE_BUCKET || "").trim();

  if (!bucket) {
    throw new Error("FIREBASE_STORAGE_BUCKET no está configurado.");
  }

  const now = new Date();
  const timestamp = googleTimestamp(now);
  const date = timestamp.slice(0, 8);
  const credentialScope = `${date}/auto/storage/goog4_request`;
  const canonicalUri = storageCanonicalUri(bucket, objectName);
  const query = {
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": `${serviceAccount.client_email}/${credentialScope}`,
    "X-Goog-Date": timestamp,
    "X-Goog-Expires": String(expiresSeconds),
    "X-Goog-SignedHeaders": "host"
  };

  if (responseDisposition) {
    query["response-content-disposition"] = responseDisposition;
  }

  const canonicalQuery = canonicalQueryString(query);
  const canonicalHeaders = "host:storage.googleapis.com\n";
  const canonicalRequest = [
    String(method).toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    "host",
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const requestHash = bytesToHex(await sha256Bytes(canonicalRequest));
  const stringToSign = [
    "GOOG4-RSA-SHA256",
    timestamp,
    credentialScope,
    requestHash
  ].join("\n");
  const key = await importServiceAccountKey(serviceAccount.private_key);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(stringToSign)
    )
  );
  const signedQuery = `${canonicalQuery}&X-Goog-Signature=${bytesToHex(signature)}`;

  // La carga viaja directo entre el navegador y Storage; el Worker solo firma la operación.
  return `https://storage.googleapis.com${canonicalUri}?${signedQuery}`;
}

function storageObjectApiUrl(env, objectName = "") {
  const bucket = encodeURIComponent(String(env.FIREBASE_STORAGE_BUCKET || "").trim());
  const suffix = objectName ? `/o/${encodeURIComponent(objectName)}` : "";
  return `https://storage.googleapis.com/storage/v1/b/${bucket}${suffix}`;
}

async function storageRequest(env, url, options = {}, retry = true) {
  const token = await getGoogleAccessToken(env);
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  if (response.status === 401 && retry) {
    await getGoogleAccessToken(env, true);
    return storageRequest(env, url, options, false);
  }

  return response;
}

export async function getStorageObjectMetadata(env, objectName) {
  const response = await storageRequest(env, storageObjectApiUrl(env, objectName), { method: "GET" });

  if (response.status === 404) {
    return null;
  }

  return requireGoogleOk(response, "Firebase Storage no pudo verificar el archivo.", "storage-error");
}

export async function deleteStorageObject(env, objectName) {
  const response = await storageRequest(env, storageObjectApiUrl(env, objectName), { method: "DELETE" });

  if (response.status === 404 || response.status === 204) {
    return;
  }

  await requireGoogleOk(response, "Firebase Storage no pudo eliminar el archivo.", "storage-error");
}

export async function updateStorageCors(env, origins) {
  const normalizedOrigins = Array.from(new Set(
    (Array.isArray(origins) ? origins : [])
      .map((value) => String(value || "").trim())
      .filter((value) => /^https?:\/\//.test(value))
  ));

  if (normalizedOrigins.length === 0) {
    throw new HttpError(400, "invalid-cors-origins", "Debes indicar al menos un origen CORS válido.");
  }

  const url = `${storageObjectApiUrl(env)}?fields=cors`;
  const response = await storageRequest(env, url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cors: [{
        origin: normalizedOrigins,
        method: ["GET", "HEAD", "PUT"],
        responseHeader: ["Content-Type", "ETag", "Content-Length"],
        maxAgeSeconds: 3600
      }]
    })
  });

  return requireGoogleOk(response, "No fue posible configurar CORS en Firebase Storage.", "storage-cors-error");
}
