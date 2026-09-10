import { formatBytes, formatCountdown } from "../../lib/format";
import type { Room } from "../../schemas/room";

export function AdminRooms({ rooms, now, busyRoom, onOpen, onClose }: { rooms: Room[]; now: number; busyRoom: string; onOpen: (room: Room) => void; onClose: (room: Room) => void }) {
  return <section className="admin-panel" id="rooms" aria-labelledby="rooms-title">
    <div className="panel-heading"><div><h2 id="rooms-title">Salas activas</h2><span className="panel-count" id="admin-room-count">{rooms.length} / 2</span></div></div>
    <div className="admin-room-list" id="admin-room-list">
      {rooms.length === 0 ? <p className="admin-empty">No hay salas activas.</p> : rooms.map((room, index) => <article className="admin-room" data-room-id={room.id} data-expires-at={room.expiresAt} key={room.id}>
        <div className="admin-room-info"><strong>Sala {index + 1}</strong><span><span data-room-countdown>{formatCountdown(room.expiresAt, now)}</span> · {formatBytes(room.usedBytes)} · {room.itemCount} elemento{room.itemCount === 1 ? "" : "s"}</span></div>
        <div className="admin-room-actions">
          <button type="button" className="admin-room-action is-info" data-action="open" data-room-id={room.id} aria-label="Abrir sala" title="Abrir sala" disabled={busyRoom === room.id} onClick={() => onOpen(room)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Zm2.5 7h5M13.5 9l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          <button type="button" className="admin-room-action is-danger" data-action="close" data-room-id={room.id} aria-label="Cerrar sala" title="Cerrar sala" disabled={busyRoom === room.id} onClick={() => onClose(room)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
        </div>
      </article>)}
    </div>
  </section>;
}
