import type { AdminHealth as Health } from "../../schemas/admin";

function Row({ label, value, variant = "" }: { label: string; value: string; variant?: string }) { return <div className="status-row"><span>{label}</span><strong className={variant ? `is-${variant}` : ""}>{value}</strong></div>; }

export function AdminHealth({ health }: { health: Health | undefined }) {
  return <section className="admin-panel" aria-labelledby="health-title"><div className="panel-heading"><h2 id="health-title">Salud</h2></div><div className="status-list" id="health-list">{!health ? <p className="admin-empty">Consultando servicios…</p> : <>
    <Row label="Worker" value={health.worker.ok ? "OK" : "Error"} variant={health.worker.ok ? "ok" : "error"} />
    <Row label="D1" value={health.d1.ok ? "OK" : "Error"} variant={health.d1.ok ? "ok" : "error"} />
    <Row label="B2" value={health.b2.ok ? "OK" : "Error"} variant={health.b2.ok ? "ok" : "error"} />
    <Row label="Firma B2" value={health.b2Signing.ok ? "OK" : "Error"} variant={health.b2Signing.ok ? "ok" : "error"} />
    <Row label="Resend" value={health.resend.configured ? "Configurado" : "No configurado"} variant={health.resend.ok ? "ok" : "error"} />
    <Row label="Cleanup" value={health.cleanup.ok ? "OK" : "Revisar"} variant={health.cleanup.ok ? "ok" : "error"} />
    <Row label="Última limpieza" value={health.cleanup.lastCleanupAt ? new Date(health.cleanup.lastCleanupAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Sin ejecución"} variant={health.cleanup.lastCleanupAt ? "info" : "error"} />
    <Row label="Reconciliación" value={health.reconcile.lastReconcileAt ? "Ejecutada" : "Pendiente"} variant={health.reconcile.lastReconcileAt ? "info" : "error"} />
  </>}</div></section>;
}
