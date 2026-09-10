import { useEffect, useRef, useState, type FormEvent } from "react";
import { recoveryApi } from "../api/recovery";
import { AppFooter } from "../components/layout/AppFooter";
import { AppHeader } from "../components/layout/AppHeader";
import { isVisualTestRuntime } from "../lib/runtime";

function resultForStatus(status: string | undefined) {
  if (status === "expired") return ["Enlace expirado", "Este enlace de recuperación ya venció. Solicita uno nuevo desde Hopper."] as const;
  if (status === "used") return ["Enlace ya utilizado", "Este enlace de recuperación ya fue consumido y no puede volver a utilizarse."] as const;
  return ["Enlace no válido", "No fue posible validar este enlace de recuperación."] as const;
}

export function RecoverPage() {
  const visual = isVisualTestRuntime();
  const tokenRef = useRef("");
  const [state, setState] = useState<"loading" | "form" | "result">("loading");
  const [result, setResult] = useState({ title: "Enlace no disponible", copy: "" });
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"" | "success" | "error">("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const initialized = useRef(false);
  const newPinRef = useRef<HTMLInputElement>(null);

  const showResult = (title: string, copy: string) => { setResult({ title, copy }); setState("result"); };

  useEffect(() => {
    if (visual || initialized.current) return;
    initialized.current = true;
    const verify = async () => {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const token = params.get("token") || "";
      tokenRef.current = token;
      if (token) history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      if (!token) { showResult("Enlace no válido", "El enlace no contiene un token de recuperación."); return; }
      try {
        const response = await recoveryApi.verify(token);
        if (!response.ok || response.status !== "valid") {
          const [title, copy] = resultForStatus(response.status);
          showResult(title, copy);
          return;
        }
        setState("form");
      } catch (error) {
        showResult("No fue posible verificar", error instanceof Error ? error.message : "Hopper no pudo validar el enlace.");
      }
    };
    void verify();
  }, [visual]);

  useEffect(() => {
    if (state === "form") requestAnimationFrame(() => newPinRef.current?.focus());
  }, [state]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!/^\d{4}$/.test(pin)) { setMessage("El nuevo PIN debe tener 4 dígitos."); setKind("error"); return; }
    if (pin !== confirmation) { setMessage("Los PIN no coinciden."); setKind("error"); return; }
    submittingRef.current = true;
    setSubmitting(true); setMessage("Actualizando acceso…"); setKind("");
    try {
      const response = await recoveryApi.resetPin(tokenRef.current, pin, confirmation);
      if (!response.ok || response.status !== "updated") {
        const [title, copy] = resultForStatus(response.status);
        showResult(title, copy);
        return;
      }
      tokenRef.current = "";
      showResult("PIN actualizado", "Hopper quedó desbloqueado. Ya puedes volver e ingresar con el nuevo PIN.");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible actualizar el PIN."); setKind("error");
    } finally { submittingRef.current = false; setSubmitting(false); }
  };

  return <>
    <div className="document-shell recovery-shell">
      <AppHeader variant="simple" />
      <main className="recovery-main"><section className="recovery-card" aria-labelledby="recovery-title">
        <p className="eyebrow">RECUPERACIÓN</p><h1 id="recovery-title">Restablecer PIN</h1><p className="auth-copy">El enlace es temporal y solo puede utilizarse una vez.</p>
        <div className="loading-state recovery-loading" id="recovery-loading" hidden={state !== "loading"}><span className="spinner" aria-hidden="true" /><span>Verificando enlace…</span></div>
        <form className="recovery-form" id="recovery-form" hidden={state !== "form"} noValidate onSubmit={(event) => { void submit(event); }}><label htmlFor="new-pin">Nuevo PIN</label><input ref={newPinRef} id="new-pin" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" placeholder="••••" value={pin} disabled={submitting} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} /><label htmlFor="confirm-pin">Confirmar PIN</label><input id="confirm-pin" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" placeholder="••••" value={confirmation} disabled={submitting} onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, "").slice(0, 4))} /><button className="primary-button" id="recovery-submit" type="submit" disabled={submitting}>{submitting ? "Guardando…" : "Guardar nuevo PIN"}</button></form>
        <div className="recovery-result" id="recovery-result" hidden={state !== "result"}><h2 id="recovery-result-title">{result.title}</h2><p id="recovery-result-copy">{result.copy}</p><a className="secondary-link" href="./">Volver a Hopper</a></div>
        <p className={`form-message ${kind ? `is-${kind}` : ""}`.trim()} id="recovery-message" aria-live="polite">{message}</p>
      </section></main>
    </div>
    <AppFooter />
  </>;
}
