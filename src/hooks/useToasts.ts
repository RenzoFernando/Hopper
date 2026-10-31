import { useCallback, useEffect, useRef, useState } from "react";

export type ToastKind = "" | "success" | "error" | "progress";
export type ToastEntry = { id: string; message: string; kind: ToastKind; placement?: "top" };
export type ToastController = {
  toasts: ToastEntry[];
  showToast: (message: string, kind?: ToastKind) => void;
  startToast: (message: string) => string;
  updateToast: (id: string, message: string, kind?: ToastKind) => void;
};

export function useToasts(timeoutMs = 3600): ToastController {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timers = useRef(new Map<string, number>());

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  const scheduleDismiss = useCallback((id: string, delay: number) => {
    const previous = timers.current.get(id);
    if (previous !== undefined) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      timers.current.delete(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, delay);
    timers.current.set(id, timer);
  }, []);

  const showToast = useCallback((message: string, kind: ToastKind = "") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, kind }]);
    scheduleDismiss(id, timeoutMs);
  }, [scheduleDismiss, timeoutMs]);

  const startToast = useCallback((message: string) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, kind: "progress", placement: "top" }]);
    return id;
  }, []);

  const updateToast = useCallback((id: string, message: string, kind: ToastKind = "progress") => {
    setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, message, kind } : toast));
    if (kind !== "progress") scheduleDismiss(id, Math.max(timeoutMs, 6000));
  }, [scheduleDismiss, timeoutMs]);

  return { toasts, showToast, startToast, updateToast };
}
