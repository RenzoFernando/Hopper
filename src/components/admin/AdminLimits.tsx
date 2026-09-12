import { formatBytes } from "../../lib/format";
import { ROOM_INACTIVITY_MINUTES, ROOM_TTL_MINUTES } from "../../lib/retention";
import type { AdminUsage } from "../../schemas/admin";

function Row({ label, value, variant = "" }: { label: string; value: string; variant?: string }) {
  return <div className="status-row"><span>{label}</span><strong className={variant ? `is-${variant}` : ""}>{value}</strong></div>;
}

export function AdminLimits({ usage }: { usage: AdminUsage | undefined }) {
  const maximumRooms = usage
    ? Math.max(usage.rooms.active, usage.rooms.maximum, usage.limits.maxRooms)
    : null;
  const roomLifetimeMinutes = usage?.limits.roomLifetimeMinutes
    ?? usage?.limits.roomMaxTtlMinutes
    ?? ROOM_TTL_MINUTES;
  const roomInactivityMinutes = usage?.limits.roomInactivityMinutes
    ?? ROOM_INACTIVITY_MINUTES;

  return <section className="admin-panel" aria-labelledby="limits-title"><div className="panel-heading"><h2 id="limits-title">Límites</h2></div><div className="status-list" id="limits-list">{!usage ? <p className="admin-empty">Consultando límites…</p> : <>
    <Row label="Máximo por archivo" value={formatBytes(usage.limits.maxFileBytes)} />
    <Row label="Límite interno" value={formatBytes(usage.limits.storageInternalLimitBytes)} />
    <Row label="Advertencia" value={formatBytes(usage.limits.storageWarningBytes)} variant="info" />
    <Row label="Salas activas" value={`${usage.rooms.active} / ${maximumRooms ?? "—"}`} />
    <Row label="Archivo por sala" value={formatBytes(usage.limits.roomMaxFileBytes)} />
    <Row label="Almacenamiento por sala" value={formatBytes(usage.limits.roomMaxBytes)} />
    <Row label="Elementos por sala" value={String(usage.limits.roomMaxItems)} />
    <Row label="Duración máxima de sala" value={`${roomLifetimeMinutes} min`} />
    <Row label="Inactividad de sala" value={`${roomInactivityMinutes} min`} />
    <Row label="Elementos activos" value={String(usage.limits.activeItems)} />
    <Row label="Uploads pendientes" value={String(usage.limits.pendingUploads)} variant={usage.limits.pendingUploads > 0 ? "info" : ""} />
    <Row label="Huérfanos" value={String(usage.limits.orphanItems)} variant={usage.limits.orphanItems === 0 ? "ok" : "error"} />
    <Row label="Fallos cleanup" value={String(usage.limits.cleanupFailures)} variant={usage.limits.cleanupFailures === 0 ? "ok" : "error"} />
  </>}</div></section>;
}
