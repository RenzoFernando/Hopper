import type { FormEvent } from "react";
import { RoomCodeInput } from "./RoomCodeInput";

type Props = {
  available: number | null;
  maximum: number;
  code: string;
  submitting: boolean;
  message: string;
  messageKind: "" | "success" | "error";
  onCodeChange: (code: string) => void;
  onCreate: () => void;
  onJoin: () => void;
};

export function RoomAccess(props: Props) {
  const handleJoin = (event: FormEvent) => { event.preventDefault(); props.onJoin(); };
  const canCreate = props.available !== null && props.available > 0 && !props.submitting;
  return <aside className="room-access-panel" aria-label="Salas de Hopper">
    <div className="room-access-heading"><span>Salas disponibles</span><strong id="room-capacity">{props.available === null ? "—" : props.available} / {props.maximum}</strong></div>
    <button className="room-access-card room-create-card" id="public-create-room" type="button" disabled={!canCreate} onClick={props.onCreate}><span className="room-access-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></span><span><strong>Crear sala</strong></span></button>
    <form className="room-access-card room-join-card" id="public-room-form" noValidate onSubmit={handleJoin}>
      <div className="room-access-title"><span className="room-access-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Zm2.5 7h5M13.5 9l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span><strong>Entrar a una sala</strong></div>
      <div className="room-inline-form"><RoomCodeInput id="public-room-code" value={props.code} onChange={props.onCodeChange} disabled={props.submitting} ariaLabel="Código de sala" /><button className="primary-button" id="public-room-join" type="submit" disabled={props.submitting}>Entrar</button></div>
      <p className={`room-access-message ${props.messageKind ? `is-${props.messageKind}` : ""}`.trim()} id="public-room-message" aria-live="polite" hidden={!props.message}>{props.message}</p>
    </form>
  </aside>;
}
