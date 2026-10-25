import { useEffect, useRef } from "react";

/** Un solo refresco en curso; sincroniza al recuperar foco/red sin consultar en segundo plano. */
export function useForegroundPolling(refresh: () => Promise<unknown>, intervalMs: number, enabled = true) {
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let inFlight = false;
    let pending = false;
    let timer: number | undefined;

    const schedule = () => {
      window.clearTimeout(timer);
      if (!disposed && document.visibilityState === "visible" && navigator.onLine) {
        timer = window.setTimeout(() => { void run(); }, intervalMs);
      }
    };

    const run = async () => {
      if (disposed || document.visibilityState !== "visible" || !navigator.onLine) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      window.clearTimeout(timer);
      try {
        await latestRefresh.current();
      } catch {
        // Los errores de red se gestionan en el consumidor.
      } finally {
        inFlight = false;
        if (pending && !disposed) {
          pending = false;
          void run();
        } else {
          schedule();
        }
      }
    };

    const onResume = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void run();
      else window.clearTimeout(timer);
    };

    void run();
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onResume);
    window.addEventListener("offline", onResume);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("online", onResume);
      window.removeEventListener("offline", onResume);
    };
  }, [enabled, intervalMs]);
}
