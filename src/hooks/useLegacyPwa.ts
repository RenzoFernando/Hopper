import { useCallback, useEffect, useState } from "react";
import { isVisualTestRuntime } from "../lib/runtime";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<unknown>;
};

export function useLegacyPwa() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateVisible, setUpdateVisible] = useState(false);

  useEffect(() => {
    if (isVisualTestRuntime() || !("serviceWorker" in navigator)) return;
    let alive = true;
    navigator.serviceWorker.register("./service-worker.js", { scope: "./", updateViaCache: "none" })
      .then((next) => {
        if (!alive) return;
        setRegistration(next);
        if (next.waiting) setUpdateVisible(true);
        next.addEventListener("updatefound", () => {
          const worker = next.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateVisible(true);
          });
        });
      })
      .catch(() => setInstallPrompt(null));
    const controllerChange = () => window.location.reload();
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

  return { installVisible: Boolean(installPrompt), updateVisible, install, update };
}
