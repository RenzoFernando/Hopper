import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { appConfig } from "../../lib/config";
import { useForegroundPolling } from "../../hooks/useForegroundPolling";

type Mode = { active: boolean; status: string; expiresAt: string | null };

export function ExclusiveGate() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<Mode | null>(null);

  const refresh = useCallback(async () => {
    if (!appConfig.workerBaseUrl) return;
    try {
      const response = await fetch(`${appConfig.workerBaseUrl.replace(/\/$/, "")}/api/exclusive/status`, { cache: "no-store" });
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("active" in body) || typeof body.active !== "boolean") return;
      const mode = body as Mode;
      setState(mode);
    } catch {
      // Ante un fallo de red se conserva el último bloqueo conocido; no se levanta por error.
    }
  }, []);

  // El estado se actualiza al volver a la PWA, al recuperar conexión y periódicamente.
  useForegroundPolling(refresh, 4_000, Boolean(appConfig.workerBaseUrl));
  // El panel administrativo normal queda bloqueado; su ruta válida es Supercarga.
  useEffect(() => {
    if (state?.active && pathname === "/admin") navigate("/admin/super", { replace: true });
  }, [navigate, pathname, state?.active]);
  if (!state?.active || pathname.startsWith("/admin")) return null;

  return <div className="exclusive-lock-screen" role="alert" aria-live="polite">
    <div className="exclusive-lock-message">
      <strong>Hopper temporalmente deshabilitado</strong>
      <p>Administración está utilizando toda la capacidad de Hopper.</p>
      {state.expiresAt && <small>Hasta {new Date(state.expiresAt).toLocaleString("es-CO")}</small>}
      <Link className="secondary-button exclusive-admin-link" to="/admin/super">Acceso administrativo</Link>
    </div>
  </div>;
}
