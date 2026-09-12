import { roomItemsApi } from "../../api/items";
import type { ToastController } from "../../hooks/useToasts";
import { appConfig } from "../../lib/config";
import { ROOM_TTL_MINUTES } from "../../lib/retention";
import type { Room } from "../../schemas/room";
import { TransferWorkspace } from "../transfers/TransferWorkspace";

export function RoomWorkspace({ room, active, onUnauthorized, onActivity, toastController }: { room: Room | null; active: boolean; onUnauthorized: () => void; onActivity: () => void; toastController: ToastController }) {
  return <section className="workspace-screen screen" id="workspace-screen" hidden={!active} aria-labelledby="workspace-title"><TransferWorkspace api={roomItemsApi} queryKey={room ? `room:${room.id}` : "room"} enabled={active && Boolean(room)} maxFileBytes={Number(room?.maxFileBytes) || appConfig.roomMaxFileBytes} defaultTtlMinutes={ROOM_TTL_MINUTES} ttlOptions={[ROOM_TTL_MINUTES]} allowTtlReset={false} pollIntervalMs={appConfig.pollIntervalMs} uploadConcurrency={appConfig.uploadConcurrency} maxSelectedFiles={Math.min(20, Number(room?.maxItems) || 20)} onActivity={onActivity} onUnauthorized={onUnauthorized} emptyTitle="La sala está vacía" emptyCopy="Envía texto o archivos y aparecerán aquí." roomMode showRoomSync toastController={toastController} /></section>;
}
