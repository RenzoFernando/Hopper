import type { ToastEntry } from "../../hooks/useToasts";

export function ToastRegion({ toasts }: { toasts: ToastEntry[] }) {
  const downloads = toasts.filter((toast) => toast.placement === "top");
  const others = toasts.filter((toast) => toast.placement !== "top");
  const renderToast = (toast: ToastEntry) => (
    <div className={`toast ${toast.kind ? `is-${toast.kind}` : ""}`.trim()} key={toast.id}>{toast.message}</div>
  );
  return <>
    <div className="download-toast-region" aria-live="polite" aria-atomic="true" role="status">
      {downloads.map(renderToast)}
    </div>
    <div className="toast-region" id="toast-region" aria-live="polite" aria-atomic="true">
      {others.map(renderToast)}
    </div>
  </>;
}
