import { AppFooter } from "../components/layout/AppFooter";
import { AppHeader } from "../components/layout/AppHeader";
import { RoomCodeInput } from "../components/rooms/RoomCodeInput";
import { useShareTarget } from "../features/share-target/useShareTarget";
import { ttlLabel } from "../lib/format";
import { isVisualTestRuntime } from "../lib/runtime";
import type { ShareDestination } from "../lib/share-target-storage";

export function ShareTargetPage() {
  const visual = isVisualTestRuntime();
  const share = useShareTarget(!visual);
  const showAuth = visual || (!share.directSending && !(share.hasPersonal && share.hasRoom));
  const showPin = visual || !share.hasPersonal;
  const showRoom = visual || !share.hasRoom;
  const showDivider = visual || (!share.hasPersonal && !share.hasRoom);
  const showDestination = visual || (!share.directSending && share.hasDestination);
  const showTtl = visual || (!share.directSending && share.hasDestination && share.destination !== "room");

  return <>
    <div className="document-shell">
      <AppHeader variant="simple" />
      <main className="share-main">
        <section className="share-card" aria-labelledby="share-title">
          <p className="eyebrow">COMPARTIR</p><h1 id="share-title">Enviar a</h1>
          <div className="share-summary" id="share-summary">{share.summary.map((item, index) => <div className="share-item" key={`${item}-${index}`}>{item}</div>)}</div>
          <div className="share-auth" id="share-auth" hidden={!showAuth}>
            <p className="share-auth-copy" id="share-auth-copy">{share.hasDestination ? "Puedes añadir otro destino antes de enviar." : "Accede a Mi espacio o entra a una sala para elegir el destino."}</p>
            <form className="share-auth-form" id="share-pin-form" noValidate hidden={!showPin} onSubmit={(event) => { event.preventDefault(); void share.submitPin(); }}>
              <label htmlFor="share-pin">PIN ADMIN</label>
              <div className="share-auth-row"><input id="share-pin" type="password" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" autoComplete="current-password" enterKeyHint="go" aria-label="PIN de Mi espacio" placeholder="••••" value={share.pin} disabled={share.authBusy || share.sendBusy} onChange={(event) => share.setPin(event.target.value)} /><button className="secondary-button" id="share-pin-submit" type="submit" disabled={share.authBusy || share.sendBusy}>Entrar</button></div>
              <p className={`share-auth-message ${share.pinKind ? `is-${share.pinKind}` : ""}`.trim()} id="share-pin-message" aria-live="polite" hidden={!share.pinMessage}>{share.pinMessage}</p>
            </form>
            <div className="share-auth-divider" id="share-auth-divider" aria-hidden="true" hidden={!showDivider}><span>o</span></div>
            <form className="share-auth-form" id="share-room-form" noValidate hidden={!showRoom} onSubmit={(event) => { event.preventDefault(); void share.submitRoom(); }}>
              <label htmlFor="share-room-code">Código de sala</label>
              <div className="share-auth-row"><RoomCodeInput id="share-room-code" value={share.roomCode} ariaLabel="Código de sala" disabled={share.authBusy || share.sendBusy} onChange={share.setRoomCode} /><button className="secondary-button" id="share-room-submit" type="submit" disabled={share.authBusy || share.sendBusy}>Entrar</button></div>
              <p className={`share-auth-message ${share.roomKind ? `is-${share.roomKind}` : ""}`.trim()} id="share-room-message" aria-live="polite" hidden={!share.roomMessage}>{share.roomMessage}</p>
            </form>
          </div>
          <label className="field-label" id="share-destination-field" htmlFor="share-destination" hidden={!showDestination}>Destino<select id="share-destination" value={share.destination} onChange={(event) => share.setDestination(event.target.value as ShareDestination)}>{share.destinations.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="field-label" id="share-ttl-field" htmlFor="share-ttl" hidden={!showTtl}>Expira en<select id="share-ttl" value={share.ttlMinutes} onChange={(event) => share.setTtlMinutes(Number(event.target.value))}>{share.ttlOptions.map((value) => <option key={value} value={value}>{ttlLabel(value)}</option>)}</select></label>
          <p className="share-progress" id="share-progress" aria-live="polite">{share.progress}</p><p className={`form-message ${share.messageKind ? `is-${share.messageKind}` : ""}`.trim()} id="share-message" aria-live="polite">{share.message}</p>
          <div className="share-actions"><button className="secondary-button" id="share-discard" type="button" disabled={share.sendBusy} onClick={() => { void share.discard(); }}>Descartar</button><button className="primary-button" id="share-send" type="button" disabled={!visual && (share.sendBusy || !share.hasDestination || !share.hasContent)} onClick={() => { void share.send(); }}>{share.sendBusy ? "Enviando…" : share.messageKind === "success" ? "Enviado" : "Enviar"}</button></div>
        </section>
      </main>
    </div>
    <AppFooter />
  </>;
}
