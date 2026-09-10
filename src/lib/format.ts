export function formatBytes(bytes: number) {
  const value = Math.max(0, Number(bytes) || 0);

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"] as const;
  let amount = value;
  let unitIndex = -1;

  do {
    amount /= 1024;
    unitIndex += 1;
  } while (amount >= 1024 && unitIndex < units.length - 1);

  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${units[unitIndex] ?? "TB"}`;
}

export function formatCountdown(expiresAt: string, now = Date.now()) {
  const remaining = Math.max(0, Date.parse(expiresAt || "") - now);
  const totalSeconds = Math.ceil(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ttlLabel(minutes: number) {
  if (minutes === 60) return "1 hora";
  if (minutes === 360) return "6 horas";
  return `${minutes} min`;
}

export function textPreview(content: string) {
  return String(content || "").replace(/\s+/g, " ").trim().slice(0, 150) || "Texto vacío";
}

export function fileTypeLabel(name: string, mimeType: string) {
  const parts = String(name || "").split(".");
  const extension = parts.at(-1) ?? "";

  if (extension && extension !== name && extension.length <= 8) {
    return extension.toUpperCase();
  }

  const category = String(mimeType || "").split("/")[0] ?? "";
  return category ? category.toUpperCase() : "ARCHIVO";
}
