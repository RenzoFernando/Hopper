import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { exclusiveApi, multipartUpload } from "../api/exclusive";
import { sessionStore } from "../api/client";
import { authApi } from "../api/auth";
import { AppHeader } from "../components/layout/AppHeader";
import { AppFooter } from "../components/layout/AppFooter";
import { formatBytes } from "../lib/format";
import { SuperFilePicker } from "../components/admin/SuperFilePicker";
import { capacityFor, formatCapacity, statusLabel, SUPERCHARGE_DURATIONS } from "../features/supercharge/model";
import type { ExclusiveStatus } from "../api/exclusive";
import { useForegroundPolling } from "../hooks/useForegroundPolling";
import { beginTransfer } from "../lib/transfer-activity";

type Status = ExclusiveStatus;
type Confirmation = { action: "end" } | { action: "remove"; id: string; name: string };

export function SuperPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<Status | null>(null);
  const [serviceReady, setServiceReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(() => sessionStore.hasPersonal());
  const [pin, setPin] = useState("");
  const [duration, setDuration] = useState(60);
  const [extendDuration, setExtendDuration] = useState(360);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loginLock = useRef(false);
  const statusRequestId = useRef(0);
  const downloadFrameRef = useRef<HTMLIFrameElement | null>(null);

  const reload = useCallback(async () => {
    const requestId = ++statusRequestId.current;
    try {
      const result = await exclusiveApi.status();
      if (requestId !== statusRequestId.current) return;
      setData(result);
      setServiceReady(true);
      setMessage(current => current.startsWith("La API de supercarga") ? "" : current);
    } catch (error) {
      if (requestId !== statusRequestId.current) return;
      setServiceReady(false);
      setData(null);
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 0;
      if (status === 401) { sessionStore.clearPersonal(); setAuthenticated(false); }
      setMessage(status === 404 ? "La API de supercarga no está desplegada." : status === 500 ? "La API de supercarga no está preparada. Comprueba el Worker y D1." : error instanceof Error ? error.message : "No se pudo comprobar el estado.");
    }
  }, []);

  useForegroundPolling(reload, 5_000);

  useEffect(() => () => { statusRequestId.current += 1; }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmation && !dialog.open) dialog.showModal();
    else if (!confirmation && dialog.open) dialog.close();
  }, [confirmation]);

  useEffect(() => () => { downloadFrameRef.current?.remove(); }, []);

  const login = async (enteredPin: string) => {
    if (loginLock.current || !/^\d{4}$/.test(enteredPin)) return;
    loginLock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await authApi.login(enteredPin);
      if (!result.ok) throw new Error(result.status === "locked" ? "PIN bloqueado." : "PIN incorrecto.");
      setAuthenticated(true);
      setPin("");
      await reload();
    } catch (error) {
      setPin("");
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
    } finally {
      loginLock.current = false;
      setBusy(false);
    }
  };

  const act = async (kind: "start" | "retry" | "end") => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (!serviceReady || !data) throw new Error("No fue posible comprobar el estado de Hopper.");
      if (kind === "start" && !confirmed) throw new Error("Confirma el borrado antes de continuar.");
      if (!/^\d{4}$/.test(pin)) throw new Error("Escribe tu PIN de cuatro dígitos.");
      if (kind === "end") {
        const result = await exclusiveApi.end(pin) as { active?: boolean; failed?: number };
        if (result.active) throw new Error("No se completó la limpieza. Hopper permanece bloqueado.");
        sessionStore.clearPersonal();
        sessionStore.clearRoom();
        navigate("/", { replace: true });
        return;
      }
      const result = kind === "start" ? await exclusiveApi.start(pin, duration) : await exclusiveApi.retry(pin);
      sessionStore.setPersonal(result.token, result.expiresIn);
      sessionStore.clearRoom();
      setPin("");
      setConfirmed(false);
      await reload();
      setMessage("Supercarga activada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo completar la operación.");
      await reload();
    } finally { setBusy(false); }
  };

  const changeDuration = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await exclusiveApi.extend(extendDuration);
      await reload();
      setMessage("Duración actualizada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cambiar la duración.");
    } finally { setBusy(false); }
  };

  const { used, available, percentage } = capacityFor(data);

  const chooseFile = (candidate: File | null) => {
    if (!candidate) return;
    if (candidate.size === 0) { setMessage("El archivo está vacío."); return; }
    if (candidate.size > available) { setMessage("No hay espacio suficiente para este archivo."); return; }
    setFile(candidate);
    setMessage("");
  };
  const send = async () => {
    if (!file || busy) return;
    if (file.size > available) { setMessage("No hay espacio suficiente para este archivo."); return; }
    setBusy(true);
    setMessage("");
    setProgress(0);
    const releaseTransfer = beginTransfer();
    try {
      await multipartUpload(file, bytes => setProgress(Math.min(100, Math.floor(bytes / file.size * 100))));
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await reload();
      setMessage("Archivo disponible.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se completó la subida.");
      await reload();
    } finally { releaseTransfer(); setBusy(false); setProgress(null); }
  };

  const download = async (id: string) => {
    setMessage("");
    try {
      const item = await exclusiveApi.download(id);
      // El GET firmado impone Content-Disposition: attachment. Un iframe invisible
      // inicia la descarga normal sin pestañas about:blank ni cargar GB en memoria.
      downloadFrameRef.current?.remove();
      const frame = document.createElement("iframe");
      frame.style.display = "none";
      frame.setAttribute("aria-hidden", "true");
      frame.src = item.url;
      document.body.appendChild(frame);
      downloadFrameRef.current = frame;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar la descarga.");
    }
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try { await exclusiveApi.remove(id); await reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo eliminar el archivo."); }
    finally { setBusy(false); }
  };

  const confirmAction = () => {
    const intent = confirmation;
    setConfirmation(null);
    if (intent?.action === "end") void act("end");
    else if (intent?.action === "remove") void remove(intent.id);
  };

  return <><div className="document-shell">
    <AppHeader variant="admin" onLogout={() => { sessionStore.clearPersonal(); navigate("/"); }} />
    <main className="admin-main super-main">
      <div className="admin-heading"><div><p className="eyebrow">ADMINISTRACIÓN</p><h1>Supercarga</h1></div></div>

      {!authenticated && <section className="admin-panel super-panel super-login">
        <h2>Acceso administrativo</h2>
        <p>Introduce tu PIN.</p>
        <label htmlFor="super-login-pin">PIN</label>
        <input id="super-login-pin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4}" maxLength={4} autoFocus disabled={busy} value={pin} onChange={e => { const next = e.target.value.replace(/\D/g, "").slice(0, 4); setPin(next); if (next.length === 4) void login(next); }} />
      </section>}

      {authenticated && <section className="admin-panel super-panel">
        <div className="super-heading"><strong>Estado</strong><span className={`super-status is-${serviceReady ? (data?.status || "inactive") : "unavailable"}`}>{!serviceReady ? "No disponible" : statusLabel(data?.status ?? null, serviceReady)}</span></div>
        <p className="super-caption">{!serviceReady ? "No se confirmó la conexión con el servicio." : data?.active ? `Hasta ${data.expiresAt ? new Date(data.expiresAt).toLocaleString("es-CO") : "—"}` : "Transferencias normales habilitadas"}</p>
        {data?.status === "active" && <div className="super-capacity" aria-label="Capacidad utilizada">
          <div className="super-capacity-label"><span>{formatCapacity(used)} utilizados</span><span>10 GB en total</span></div>
          <progress max="100" value={percentage} aria-label="Porcentaje de capacidad ocupada">{percentage.toFixed(1)}%</progress>
          <small>{formatCapacity(available)} disponibles</small>
        </div>}
      </section>}

      {authenticated && serviceReady && data?.status === "inactive" && <section className="admin-panel super-panel">
        <h2>Iniciar supercarga</h2>
        <label>Duración<select value={duration} onChange={e => setDuration(Number(e.target.value))}>{SUPERCHARGE_DURATIONS.map(t => <option value={t.value} key={t.value}>{t.label}</option>)}</select></label>
        <p>Se eliminarán todos los elementos y se bloquearán las transferencias normales.</p>
        <label className="super-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmo el borrado irreversible.</label>
        <label>PIN actual<input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
        <button className="danger-outline-button" disabled={busy || !confirmed || pin.length !== 4} onClick={() => void act("start")}>Vaciar y activar</button>
      </section>}

      {authenticated && data?.status === "preparing" && <section className="admin-panel super-panel">
        <h2>Limpieza pendiente</h2><p>La limpieza no terminó. Hopper permanece bloqueado.</p>
        <label>PIN<input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
        <button className="secondary-button" disabled={busy || pin.length !== 4} onClick={() => void act("retry")}>Reintentar limpieza</button>
      </section>}

      {authenticated && data?.status === "active" && <section className="admin-panel super-panel">
        <h2>Duración</h2>
        <div className="super-duration-controls"><label>Nuevo tiempo<select value={extendDuration} disabled={busy} onChange={e => setExtendDuration(Number(e.target.value))}>{SUPERCHARGE_DURATIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label><button className="secondary-button" disabled={busy} onClick={() => void changeDuration()}>Actualizar tiempo</button></div>
      </section>}

      {authenticated && data?.status === "active" && <SuperFilePicker inputRef={fileInputRef} disabled={busy} file={file} available={available} progress={progress}
        onPick={chooseFile} onClear={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} onSend={() => void send()} />}

      {authenticated && data?.active && <section className="admin-panel super-panel">
        <h2>Archivos ({data.fileCount ?? data.files.length})</h2>
        {(data.fileCount ?? data.files.length) > data.files.length && <p>Mostrando los {data.files.length} archivos más recientes.</p>}
        <div className="super-files">{data.files.map(f => <div className="super-file" key={f.id}><div><strong>{f.name}</strong><small>{formatBytes(f.size)} · {f.status === "ready" ? "Disponible" : "Pendiente"}</small></div><div><button className="secondary-button" disabled={busy || f.status !== "ready"} onClick={() => void download(f.id)}>Descargar</button><button className="danger-outline-button" disabled={busy} onClick={() => setConfirmation({ action: "remove", id: f.id, name: f.name })}>Eliminar</button></div></div>)}</div>
      </section>}

      {authenticated && data?.active && <section className="admin-panel super-panel">
        <h2>Finalizar sesión</h2>
        <p>Elimina los archivos de esta sesión y libera Hopper.</p>
        <label>PIN actual<input type="password" inputMode="numeric" maxLength={4} autoComplete="off" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
        <button className="danger-outline-button" disabled={busy || pin.length !== 4} onClick={() => setConfirmation({ action: "end" })}>{data.status === "closing" ? "Reintentar liberación" : "Finalizar y liberar"}</button>
      </section>}

      {message && <p className="super-message" role="status">{message}</p>}
    </main>
  </div>
  <AppFooter />
  <dialog ref={dialogRef} className="super-dialog" aria-labelledby="super-dialog-title" onClose={() => setConfirmation(null)}>
    <h2 id="super-dialog-title">{confirmation?.action === "end" ? "Finalizar Supercarga" : "Eliminar archivo"}</h2>
    <p>{confirmation?.action === "end" ? "Se eliminarán los archivos de la sesión y se habilitarán las transferencias normales." : `¿Eliminar «${confirmation?.action === "remove" ? confirmation.name : ""}»?`}</p>
    <div className="super-dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => setConfirmation(null)}>Cancelar</button><button type="button" className="danger-outline-button" onClick={confirmAction}>{confirmation?.action === "end" ? "Finalizar y liberar" : "Eliminar"}</button></div>
  </dialog>
  </>;
}
