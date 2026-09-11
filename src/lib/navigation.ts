import { isCompleteRoomCode, normalizeRoomCode } from "./room-code";

export function roomPath(code: string) {
  const normalized = normalizeRoomCode(code);
  return isCompleteRoomCode(normalized) ? `/room/${normalized}` : "/room";
}

export function roomUrl(code: string, origin = window.location.origin) {
  return new URL(roomPath(code), origin).toString();
}

export function recoveryTokenFromHash(hash: string) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw) return "";

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
