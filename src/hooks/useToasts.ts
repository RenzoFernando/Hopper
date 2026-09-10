import { useCallback, useEffect, useRef, useState } from "react";

export type ToastKind = "" | "success" | "error";
export type ToastEntry = { id: string; message: string; kind: ToastKind };
export type ToastController = { toasts: ToastEntry[]; showToast: (message: string, kind?: ToastKind) => void };

export function useToasts(timeoutMs = 3600): ToastController {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timers = useRef(new Map<string, number>());

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  const showToast = useCallback((message: string, kind: ToastKind = "") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, kind }]);
    const timer = window.setTimeout(() => {
      timers.current.delete(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, timeoutMs);
    timers.current.set(id, timer);
  }, [timeoutMs]);

  return { toasts, showToast };
}
