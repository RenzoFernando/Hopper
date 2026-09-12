import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isVisualTestRuntime } from "../lib/runtime";

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
    const hadController = Boolean(navigator.serviceWorker.controller);
    const target = serviceWorkerTarget();

    const activateWaitingWorker = (worker: ServiceWorker | null) => {
      if (!worker) return;
      setUpdateVisible(true);
      worker.postMessage({ type: "SKIP_WAITING" });
    };

    navigator.serviceWorker.register(target.url, target.options)
      .then((next) => {
        if (!alive) return;
        setRegistration(next);
        activateWaitingWorker(next.waiting);
        void next.update().catch(() => undefined);
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

    const controllerChange = () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", controllerChange);
    return () => {
      alive = false;
      navigator.serviceWorker.removeEventListener("controllerchange", controllerChange);
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