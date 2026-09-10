import type { ToastEntry } from "../../hooks/useToasts";

export function ToastRegion({ toasts }: { toasts: ToastEntry[] }) {
  return (
    <div className="toast-region" id="toast-region" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => <div className={`toast ${toast.kind ? `is-${toast.kind}` : ""}`.trim()} key={toast.id}>{toast.message}</div>)}
    </div>
  );
}
