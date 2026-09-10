import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sessionStore } from "../api/client";
import { itemsApi } from "../api/items";
import { AppFooter } from "../components/layout/AppFooter";
import { AppHeader } from "../components/layout/AppHeader";
import { TransferWorkspace } from "../components/transfers/TransferWorkspace";
import { usePwa } from "../hooks/usePwa";
import { appConfig } from "../lib/config";
import { isVisualTestRuntime } from "../lib/runtime";

type SyncVariant = "" | "busy" | "offline" | "ok";

export function SpacePage() {
  const navigate = useNavigate();
  const visual = isVisualTestRuntime();
  const pwa = usePwa();
  const [sync, setSync] = useState<{ label: string; variant: SyncVariant }>({ label: "Sincronizado", variant: "" });
  const hasSession = visual || sessionStore.hasPersonal();

  const goHome = useCallback(() => {
    sessionStore.clearPersonal();
    navigate("/", { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!hasSession) navigate("/", { replace: true });
  }, [hasSession, navigate]);

  useEffect(() => {
    const expired = () => goHome();
    window.addEventListener("hopper:session-expired", expired);
    return () => window.removeEventListener("hopper:session-expired", expired);
  }, [goHome]);

  return <>
    <div className="app-shell">
      <AppHeader variant="home" authenticated={hasSession} syncLabel={sync.label} syncVariant={sync.variant} installVisible={pwa.installVisible} updateVisible={pwa.updateVisible} onInstall={() => { void pwa.install(); }} onUpdate={pwa.update} onLogout={goHome} />
      <main className="app-main" id="app-main">
        <section className="workspace-screen screen" id="workspace-screen" hidden={!hasSession} aria-labelledby="workspace-title"><TransferWorkspace api={itemsApi} queryKey="personal" enabled={hasSession && !visual} maxFileBytes={appConfig.maxFileBytes} defaultTtlMinutes={appConfig.defaultTtlMinutes} ttlOptions={[5, 15, 30, 60, 360]} pollIntervalMs={appConfig.pollIntervalMs} uploadConcurrency={appConfig.uploadConcurrency} onUnauthorized={goHome} onSyncChange={(label, variant) => setSync({ label, variant })} emptyTitle="La bandeja está vacía" emptyCopy="Envía texto o archivos y aparecerán aquí en los demás dispositivos." /></section>
      </main>
    </div>
    <AppFooter />
  </>;
}
