import { useEffect, useRef, useState, type FormEvent } from "react";

type ActionName = "cleanup" | "reconcile" | "delete-stats" | "reset";
type SensitiveAction = Extract<ActionName, "delete-stats" | "reset">;

type Props = {
  busyAction: ActionName | "";
  onAction: (action: ActionName, currentPin?: string) => void;
  onChangePin: (currentPin: string, pin: string, confirmation: string) => Promise<boolean>;
};

function pinDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

export function MaintenanceActions({ busyAction, onAction, onChangePin }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const currentPinRef = useRef<HTMLInputElement>(null);
  const sensitiveDialogRef = useRef<HTMLDialogElement>(null);
  const sensitivePinRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"" | "success" | "error">("");
  const [submitting, setSubmitting] = useState(false);
  const [sensitiveAction, setSensitiveAction] = useState<SensitiveAction | "">("");
  const [sensitivePin, setSensitivePin] = useState("");
  const [sensitiveMessage, setSensitiveMessage] = useState("");
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
      window.requestAnimationFrame(() => currentPinRef.current?.focus());
    } else if (!open && dialogRef.current?.open) {
      dialogRef.current.close();
    }
  }, [open]);

  useEffect(() => {
    if (sensitiveAction && !sensitiveDialogRef.current?.open) {
      sensitiveDialogRef.current?.showModal();
      window.requestAnimationFrame(() => sensitivePinRef.current?.focus());
    } else if (!sensitiveAction && sensitiveDialogRef.current?.open) {
      sensitiveDialogRef.current.close();
    }
  }, [sensitiveAction]);

  const startPin = () => {
    setCurrentPin("");
    setPin("");
    setConfirmation("");
    setMessage("");
    setKind("");
    setOpen(true);
  };

  const startSensitive = (action: SensitiveAction) => {
    setSensitivePin("");
    setSensitiveMessage("");
    setSensitiveAction(action);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;

    if (currentPin.length !== 4 || pin.length !== 4 || confirmation.length !== 4) {
      setMessage("Escribe cuatro dígitos en los tres campos.");
      setKind("error");
      return;
    }

    if (pin !== confirmation) {
      setMessage("Los PIN no coinciden.");
      setKind("error");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setMessage("Guardando…");
    setKind("");
    let completed = false;

    try {
      const ok = await onChangePin(currentPin, pin, confirmation);
      if (ok) {
        completed = true;
        setMessage("PIN actualizado. Volviendo al inicio…");
        setKind("success");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible cambiar el PIN.");
      setKind("error");
    } finally {
      if (!completed) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  const submitSensitive = (event: FormEvent) => {
    event.preventDefault();
    if (!sensitiveAction) return;

    if (sensitivePin.length !== 4) {
      setSensitiveMessage("Escribe tu PIN actual de cuatro dígitos.");
      return;
    }

    const action = sensitiveAction;
    const current = sensitivePin;
    setSensitiveAction("");
    onAction(action, current);
  };

  const sensitiveCopy = sensitiveAction === "reset"
    ? "Se eliminará todo el contenido temporal, se cerrarán las salas y se invalidarán las sesiones. El PIN, la configuración y las estadísticas se conservarán."
    : "Se borrarán las estadísticas agregadas de Hopper. El contenido temporal no se verá afectado.";

  const sensitiveTitle = sensitiveAction === "reset" ? "¿Reiniciar Hopper?" : "¿Borrar las estadísticas?";

  return <>
    <section className="admin-panel maintenance-panel" aria-labelledby="maintenance-title"><div className="panel-heading"><h2 id="maintenance-title">Mantenimiento</h2></div><div className="maintenance-actions">
      <button className="secondary-button utility-button is-success" id="cleanup-button" type="button" disabled={busyAction === "cleanup"} onClick={() => onAction("cleanup")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M7 18l1-7h8l1 7M9 11V7a3 3 0 0 1 6 0v4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Limpiar</span></button>
      <button className="secondary-button utility-button is-info" id="reconcile-button" type="button" disabled={busyAction === "reconcile"} onClick={() => onAction("reconcile")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7v5h-5M5 17v-5h5M7.1 8.2A6.5 6.5 0 0 1 18.4 10M16.9 15.8A6.5 6.5 0 0 1 5.6 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Reconciliar</span></button>
      <button className="secondary-button utility-button is-info" id="change-pin-button" type="button" onClick={startPin}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3M7 11h10a2 2 0 0 1 2 2v6H5v-6a2 2 0 0 1 2-2Zm5 3.5v2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Cambiar PIN</span></button>
      <button className="danger-outline-button utility-button is-danger" id="delete-stats-button" type="button" disabled={busyAction === "delete-stats"} onClick={() => startSensitive("delete-stats")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8v10m4-10v10m4-10v10M5 6h14M9 6V4h6v2m3 0-1 15H7L6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Borrar estadísticas</span></button>
      <button className="danger-outline-button utility-button is-danger" id="reset-system-button" type="button" disabled={busyAction === "reset"} onClick={() => startSensitive("reset")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a8 8 0 1 1-2.3-2.8M19 3v5h-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Reiniciar sistema</span></button>
    </div></section>

    <dialog className="confirm-dialog admin-pin-dialog" id="change-pin-dialog" aria-labelledby="change-pin-title" ref={dialogRef} onClick={(event) => { if (event.target === event.currentTarget && !submitting) setOpen(false); }} onClose={() => setOpen(false)}>
      <form className="recovery-form admin-pin-form" id="change-pin-form" noValidate onSubmit={(event) => { void submit(event); }}>
        <p className="eyebrow">SEGURIDAD</p><h2 id="change-pin-title">Cambiar PIN</h2>
        <label htmlFor="change-pin-current">PIN actual</label>
        <input ref={currentPinRef} id="change-pin-current" type="password" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" autoComplete="current-password" placeholder="••••" value={currentPin} disabled={submitting} onChange={(event) => { setCurrentPin(pinDigits(event.target.value)); setMessage(""); }} />
        <label htmlFor="change-pin-new">Nuevo PIN</label>
        <input id="change-pin-new" type="password" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" autoComplete="new-password" placeholder="••••" value={pin} disabled={submitting} onChange={(event) => { setPin(pinDigits(event.target.value)); setMessage(""); }} />
        <label htmlFor="change-pin-confirm">Confirmar PIN</label>
        <input id="change-pin-confirm" type="password" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" autoComplete="new-password" placeholder="••••" value={confirmation} disabled={submitting} onChange={(event) => { setConfirmation(pinDigits(event.target.value)); setMessage(""); }} />
        <p className={`form-message ${kind ? `is-${kind}` : ""}`.trim()} id="change-pin-message" aria-live="polite" hidden={!message}>{message}</p>
        <div className="dialog-actions"><button className="secondary-button" id="change-pin-cancel" type="button" disabled={submitting} onClick={() => setOpen(false)}>Cancelar</button><button className="primary-button" id="change-pin-submit" type="submit" disabled={submitting}>Guardar PIN</button></div>
      </form>
    </dialog>

    <dialog className="confirm-dialog admin-pin-dialog" id="admin-reauth-dialog" aria-labelledby="admin-reauth-title" ref={sensitiveDialogRef} onClick={(event) => { if (event.target === event.currentTarget) setSensitiveAction(""); }} onClose={() => setSensitiveAction("")}>
      <form className="recovery-form admin-pin-form" id="admin-reauth-form" noValidate onSubmit={submitSensitive}>
        <p className="eyebrow">CONFIRMACIÓN</p><h2 id="admin-reauth-title">{sensitiveTitle}</h2><p>{sensitiveCopy}</p>
        <label htmlFor="admin-reauth-pin">PIN actual</label>
        <input ref={sensitivePinRef} id="admin-reauth-pin" type="password" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" autoComplete="current-password" placeholder="••••" value={sensitivePin} onChange={(event) => { setSensitivePin(pinDigits(event.target.value)); setSensitiveMessage(""); }} />
        <p className="form-message is-error" id="admin-reauth-message" aria-live="polite" hidden={!sensitiveMessage}>{sensitiveMessage}</p>
        <div className="dialog-actions"><button className="secondary-button" id="admin-reauth-cancel" type="button" onClick={() => setSensitiveAction("")}>Cancelar</button><button className="danger-button" id="admin-reauth-submit" type="submit">{sensitiveAction === "reset" ? "Reiniciar" : "Borrar"}</button></div>
      </form>
    </dialog>
  </>;
}
