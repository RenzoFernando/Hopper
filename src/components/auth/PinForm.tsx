import type { FormEvent } from "react";

type Props = {
  pin: string;
  loading: boolean;
  locked: boolean;
  disabled?: boolean;
  message: string;
  messageKind: "" | "success" | "error";
  recoveryMessage: string;
  recoveryKind: "" | "success" | "error";
  recoveryLoading: boolean;
  onPinChange: (pin: string) => void;
  onSubmit: (pin?: string) => void;
  onRecovery: () => void;
};

export function PinForm(props: Props) {
  const handleSubmit = (event: FormEvent) => { event.preventDefault(); props.onSubmit(); };
  return <>
    <form className="pin-form" id="pin-form" hidden={props.locked} noValidate onSubmit={handleSubmit}>
      <label htmlFor="pin-input">PIN ADMIN</label>
      <div className="pin-field">
        <input id="pin-input" name="pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" aria-describedby="pin-message" placeholder="••••" autoFocus value={props.pin} disabled={props.loading || props.disabled} onChange={(event) => { const value = event.target.value.replace(/\D/g, "").slice(0, 4); props.onPinChange(value); if (value.length === 4 && !props.loading) window.setTimeout(() => props.onSubmit(value), 0); }} />
        <span className="pin-loader" id="pin-loader" hidden={!props.loading} aria-hidden="true" />
      </div>
    </form>
    <p className={`form-message ${props.messageKind ? `is-${props.messageKind}` : ""}`.trim()} id="pin-message" aria-live="polite" hidden={!props.message}>{props.message}</p>
    <div className="lock-panel" id="lock-panel" hidden={!props.locked}>
      <h2>Hopper está bloqueado</h2><p>Se alcanzó el límite de intentos.</p>
      <button className="secondary-button" id="recovery-request-button" type="button" disabled={props.recoveryLoading} onClick={props.onRecovery}>Reenviar recuperación</button>
      <p className={`form-message ${props.recoveryKind ? `is-${props.recoveryKind}` : ""}`.trim()} id="recovery-request-message" aria-live="polite">{props.recoveryMessage}</p>
    </div>
  </>;
}
