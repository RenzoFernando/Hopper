import { itemsApi } from "../api/items";
import { TransferWorkspace } from "../components/transfers/TransferWorkspace";
import { appConfig } from "../lib/config";

type Props = {
  active: boolean;
  onUnauthorized: () => void;
  onSyncChange: (label: string, variant: "" | "busy" | "offline" | "ok") => void;
};

export function SpacePage({ active, onUnauthorized, onSyncChange }: Props) {
  return <section className="workspace-screen screen" id="workspace-screen" hidden={!active} aria-labelledby="workspace-title"><TransferWorkspace api={itemsApi} queryKey="personal" enabled={active} maxFileBytes={appConfig.maxFileBytes} defaultTtlMinutes={appConfig.defaultTtlMinutes} ttlOptions={[5, 15, 30, 60, 360]} pollIntervalMs={appConfig.pollIntervalMs} uploadConcurrency={appConfig.uploadConcurrency} onUnauthorized={onUnauthorized} onSyncChange={onSyncChange} emptyTitle="La bandeja está vacía" emptyCopy="Envía texto o archivos y aparecerán aquí en los demás dispositivos." /></section>;
}
