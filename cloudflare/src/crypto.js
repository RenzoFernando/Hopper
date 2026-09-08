export function base64UrlEncodeBytes(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

export function base64UrlEncodeText(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(String(value)));
}

export function base64UrlDecodeBytes(value) {
  const normalized = String(value).replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function sha256Bytes(value) {
  const source = value instanceof Uint8Array
    ? value
    : new TextEncoder().encode(String(value));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", source));
}

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function timingSafeEqualBytes(first, second) {
  let difference = first.length ^ second.length;
  const length = Math.min(first.length, second.length);

  for (let index = 0; index < length; index += 1) {
    difference |= first[index] ^ second[index];
  }

  return difference === 0;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function rfc3986Encode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}
