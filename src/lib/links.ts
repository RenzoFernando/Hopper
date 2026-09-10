const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,!?;:]+$/;

function cleanCandidate(value: string) {
  return value.replace(TRAILING_PUNCTUATION, "");
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractHttpUrls(value: string) {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const match of String(value || "").matchAll(new RegExp(HTTP_URL_PATTERN.source, "gi"))) {
    const candidate = cleanCandidate(match[0] || "");
    if (!candidate || !validHttpUrl(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    urls.push(candidate);
  }

  return urls;
}

export type HttpTextPart = {
  text: string;
  href?: string;
};

export function splitHttpText(value: string): HttpTextPart[] {
  const source = String(value || "");
  const parts: HttpTextPart[] = [];
  let cursor = 0;

  for (const match of source.matchAll(new RegExp(HTTP_URL_PATTERN.source, "gi"))) {
    const index = match.index ?? 0;
    const raw = match[0] || "";
    const candidate = cleanCandidate(raw);
    if (!candidate || !validHttpUrl(candidate)) continue;

    if (index > cursor) parts.push({ text: source.slice(cursor, index) });
    parts.push({ text: candidate, href: candidate });
    if (candidate.length < raw.length) parts.push({ text: raw.slice(candidate.length) });
    cursor = index + raw.length;
  }

  if (cursor < source.length) parts.push({ text: source.slice(cursor) });
  return parts.length > 0 ? parts : [{ text: source }];
}
