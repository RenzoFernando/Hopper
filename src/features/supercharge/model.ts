import type { ExclusiveStatus } from "../../api/exclusive";
import { formatBytes } from "../../lib/format";

export const SUPERCHARGE_DURATIONS = [
  { value: 60, label: "1 hora" },
  { value: 360, label: "6 horas" },
  { value: 720, label: "12 horas" },
  { value: 1440, label: "24 horas" }
] as const;

export function formatCapacity(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toLocaleString("es-CO", { maximumFractionDigits: 2 })} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;
  return formatBytes(bytes);
}

/** La cuota comprende archivos listos y reservas pendientes; nunca presupone más espacio físico. */
export function capacityFor(status: ExclusiveStatus | null) {
  const limit = Math.max(0, status?.limitBytes ?? 0);
  const visibleBytes = (status?.files ?? []).reduce((total, file) => total + Math.max(0, file.size), 0);
  const used = Math.max(0, status?.usedBytes ?? visibleBytes);
  const available = Math.max(0, limit - used);
  return { used, available, percentage: limit > 0 ? Math.min(100, used / limit * 100) : 0 };
}

export function statusLabel(status: string | null, available: boolean): string {
  if (!available) return "No disponible";
  switch (status) {
    case "active": return "Activa";
    case "preparing": return "Limpiando";
    case "closing": return "Cerrando";
    default: return "Inactiva";
  }
}
