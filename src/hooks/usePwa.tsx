import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isVisualTestRuntime } from "../lib/runtime";
import { isTransferActive } from "../lib/transfer-activity";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<unknown>;
};

type PwaController = {
  installVisible: boolean;
  updateVisible: boolean;
  install: () => Promise<void>;
  update: () => void;
};

const PwaContext = createContext<PwaController | null>(null);

function serviceWorkerTarget() {
  if (import.meta.env.PROD) {
    return { url: "/sw.js", options: { scope: "/", updateViaCache: "none" as const } };
  }

  return {
    url: "/dev-sw.js?dev-sw",
    options: { scope: "/", type: "module" as const, updateViaCache: "none" as const }
  };
}

function usePwaController(): PwaController {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateVisible, setUpdateVisible] = useState(false);

  useEffect(() => {
    if (isVisualTestRuntime() || !("serviceWorker" in navigator)) return;
    let alive = true;
    let reloaded = false;
    let reloadPending = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    let lastUpdateCheck = 0;
    let activeRegistration: ServiceWorkerRegistration | null = null;
    const target = serviceWorkerTarget();

    const activateWaitingWorker = (worker: ServiceWorker | null) => {
      if (!worker) return;
      setUpdateVisible(true);
      worker.postMessage({ type: "SKIP_WAITING" });
    };

    navigator.serviceWorker.register(target.url, target.options)
      .then((next) => {
        if (!alive) return;
        activeRegistration = next;
        setRegistration(next);
        activateWaitingWorker(next.waiting);
        const checkNewVersion = () => {
          if (!alive || !navigator.onLine || document.visibilityState !== "visible") return;
          const now = Date.now();
          if (now - lastUpdateCheck < 60_000) return;
          lastUpdateCheck = now;
          void next.update().catch(() => undefined);
        };
        checkNewVersion();
        next.addEventListener("updatefound", () => {
          const worker = next.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              activateWaitingWorker(next.waiting || worker);
            }
          });
        });
      })
      .catch(() => setInstallPrompt(null));

    const reloadWhenSafe = () => {
      if (!hadController || reloaded) return;
      if (isTransferActive()) { reloadPending = true; return; }
      reloaded = true;
      window.location.reload();
    };
    const controllerChange = () => reloadWhenSafe();
    const onTransferIdle = () => { if (reloadPending) reloadWhenSafe(); };
    navigator.serviceWorker.addEventListener("controllerchange", controllerChange);
    window.addEventListener("hopper:transfers-idle", onTransferIdle);
    const checkOnResume = () => {
      if (!alive || !activeRegistration || !navigator.onLine || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastUpdateCheck < 60_000) return;
      lastUpdateCheck = now;
      void activeRegistration.update().catch(() => undefined);
    };
    const periodicCheck = window.setInterval(checkOnResume, 180_000);
    window.addEventListener("focus", checkOnResume);
    window.addEventListener("online", checkOnResume);
    document.addEventListener("visibilitychange", checkOnResume);
    return () => {
      alive = false;
      window.clearInterval(periodicCheck);
      window.removeEventListener("focus", checkOnResume);
      window.removeEventListener("online", checkOnResume);
      document.removeEventListener("visibilitychange", checkOnResume);
      navigator.serviceWorker.removeEventListener("controllerchange", controllerChange);
      window.removeEventListener("hopper:transfers-idle", onTransferIdle);
    };
  }, []);

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  }, [installPrompt]);

  const update = useCallback(() => {
    if (!registration?.waiting) return;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }, [registration]);

  return useMemo(() => ({ installVisible: Boolean(installPrompt), updateVisible, install, update }), [install, installPrompt, update, updateVisible]);
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const controller = usePwaController();
  return <PwaContext.Provider value={controller}>{children}</PwaContext.Provider>;
}

export function usePwa() {
  const value = useContext(PwaContext);
  if (!value) throw new Error("usePwa debe utilizarse dentro de PwaProvider.");
  return value;
}
