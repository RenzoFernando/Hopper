import { formatBytes } from "../../lib/format";
import type { AdminUsage } from "../../schemas/admin";

function MetricIcon({ kind }: { kind: "storage" | "ok" | "upload" | "delete" | "transfer" | "warning" | "trend" | "refresh" }) {
  const paths = {
    storage: <path d="M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3Zm0 0v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6m-14 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
    ok: <path d="M20 11a8 8 0 1 1-3-6.2M8.5 11.5l2.2 2.2L16 8.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
    upload: <path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
    delete: <path d="M8 8v10m4-10v10m4-10v10M5 6h14M9 6V4h6v2m3 0-1 15H7L6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
    transfer: <path d="M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
    warning: <path d="M12 8v5m0 3h.01M4.7 19h14.6a1.5 1.5 0 0 0 1.3-2.25L13.3 4.1a1.5 1.5 0 0 0-2.6 0L3.4 16.75A1.5 1.5 0 0 0 4.7 19Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
    trend: <path d="M4 17l5-5 3 3 7-8m0 0h-5m5 0v5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
    refresh: <path d="M19 7v5h-5M5 17v-5h5M7.1 8.2A6.5 6.5 0 0 1 18.4 10M16.9 15.8A6.5 6.5 0 0 1 5.6 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  };
  return <svg viewBox="0 0 24 24">{paths[kind]}</svg>;
}

export function AdminMetrics({ usage }: { usage: AdminUsage | undefined }) {
  const percent = usage ? Math.min(100, Math.max(0, usage.storage.estimatedBytes / usage.storage.referenceBytes * 100)) : 0;
  const storageState = !usage ? { label: "Consultando…", className: "usage-state" } : usage.storage.blocked ? { label: "Bloqueo preventivo activo", className: "usage-state is-error" } : usage.storage.warning ? { label: "Advertencia de almacenamiento", className: "usage-state is-warning" } : { label: "Dentro del margen interno", className: "usage-state is-ok" };
  return <section className="admin-grid" aria-label="Resumen de uso">
    <article className="metric-card metric-card-wide"><span className="metric-label"><span className="metric-icon is-info" aria-hidden="true"><MetricIcon kind="storage" /></span><span>Uso estimado de Hopper en B2</span></span><strong id="usage-storage">{usage ? `${formatBytes(usage.storage.estimatedBytes)} / ${formatBytes(usage.storage.referenceBytes)}` : "—"}</strong><div className="storage-track" aria-hidden="true"><span id="storage-meter" style={{ width: `${percent}%` }} /></div><small className={storageState.className} id="storage-state">{storageState.label}</small></article>
    <article className="metric-card"><span className="metric-label"><span className="metric-icon is-success" aria-hidden="true"><MetricIcon kind="ok" /></span><span>Libre estimado</span></span><strong id="usage-free">{usage ? formatBytes(usage.storage.freeEstimatedBytes) : "—"}</strong></article>
    <article className="metric-card"><span className="metric-label"><span className="metric-icon is-success" aria-hidden="true"><MetricIcon kind="upload" /></span><span>Hoy · subido</span></span><strong id="usage-today-uploads">{usage ? formatBytes(usage.today.uploadBytes) : "—"}</strong></article>
    <article className="metric-card"><span className="metric-label"><span className="metric-icon is-danger" aria-hidden="true"><MetricIcon kind="delete" /></span><span>Hoy · eliminado</span></span><strong id="usage-today-deleted">{usage ? formatBytes(usage.today.deletedBytes) : "—"}</strong></article>
    <article className="metric-card"><span className="metric-label"><span className="metric-icon is-info" aria-hidden="true"><MetricIcon kind="transfer" /></span><span>Hoy · transferencias</span></span><strong id="usage-today-transfers">{usage ? String(usage.today.uploadsCount) : "—"}</strong></article>
    <article className="metric-card"><span className="metric-label"><span className="metric-icon is-danger" aria-hidden="true"><MetricIcon kind="warning" /></span><span>Hoy · fallos</span></span><strong id="usage-today-failures">{usage ? String(usage.today.failedUploads + usage.today.cleanupFailures) : "—"}</strong></article>
    <article className="metric-card"><span className="metric-label"><span className="metric-icon is-info" aria-hidden="true"><MetricIcon kind="trend" /></span><span>7 días · movido</span></span><strong id="usage-week-uploads">{usage ? formatBytes(usage.last7Days.uploadBytes) : "—"}</strong></article>
    <article className="metric-card"><span className="metric-label"><span className="metric-icon is-info" aria-hidden="true"><MetricIcon kind="refresh" /></span><span>7 días · transferencias</span></span><strong id="usage-week-transfers">{usage ? String(usage.last7Days.uploadsCount) : "—"}</strong></article>
  </section>;
}
