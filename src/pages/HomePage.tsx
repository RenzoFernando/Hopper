import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { authApi } from "../api/auth";
import { sessionStore } from "../api/client";
import { roomsApi } from "../api/rooms";
import { AppFooter } from "../components/layout/AppFooter";
import { AppHeader } from "../components/layout/AppHeader";
import { PinForm } from "../components/auth/PinForm";
import { RoomAccess } from "../components/rooms/RoomAccess";
import { RoomCreatedDialog } from "../components/rooms/RoomCreatedDialog";
import { useLegacyPwa } from "../hooks/useLegacyPwa";
import { isCompleteRoomCode } from "../lib/room-code";
import { isVisualTestRuntime } from "../lib/runtime";
import { SpacePage } from "./SpacePage";

type MessageKind = "" | "success" | "error";
type SyncVariant = "" | "busy" | "offline" | "ok";

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function HomePage() {
  const visual = isVisualTestRuntime();
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const pinSubmittingRef = useRef(false);
  const [pinMessage, setPinMessage] = useState("");
  const [pinKind, setPinKind] = useState<MessageKind>("");
  const [locked, setLocked] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryKind, setRecoveryKind] = useState<MessageKind>("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const recoveryLoadingRef = useRef(false);
  const [roomCode, setRoomCode] = useState("");
  const [roomMessage, setRoomMessage] = useState("");
  const [roomKind, setRoomKind] = useState<MessageKind>("");
  const [roomSubmitting, setRoomSubmitting] = useState(false);
  const roomSubmittingRef = useRef(false);
  const [createdRoomCode, setCreatedRoomCode] = useState("");
  const [sync, setSync] = useState<{ label: string; variant: SyncVariant }>({ label: "Sincronizado", variant: "" });
  const pwa = useLegacyPwa();
  const configured = sessionStore.hasConfiguredWorker();

  const security = useQuery({ queryKey: ["security-status"], queryFn: authApi.securityStatus, enabled: !visual && configured, retry: 1 });
  const capacity = useQuery({ queryKey: ["room-capacity"], queryFn: roomsApi.capacity, enabled: !visual && configured && !authenticated, refetchInterval: authenticated ? false : 10_000, refetchOnWindowFocus: true, retry: 1 });

  useEffect(() => {
    if (visual) return;
    if (!configured) {
      setPinMessage("Hopper todavía no está conectado al Worker.");
      setPinKind("error");
      return;
    }
    if (security.data) {
      setLocked(Boolean(security.data.locked));
      if (security.data.locked) {
        setAuthenticated(false);
        setPinMessage("El acceso está bloqueado.");
        setPinKind("error");
      } else if (sessionStore.hasPersonal()) {
        setAuthenticated(true);
        setPinMessage("");
        setPinKind("");
      } else {
        setAuthenticated(false);
        setPinMessage("");
        setPinKind("");
      }
    }
    if (security.error) {
      setAuthenticated(false);
      setPinMessage(messageFor(security.error, "No fue posible conectar con Hopper."));
      setPinKind("error");
    }
  }, [configured, security.data, security.error, visual]);

  useEffect(() => {
    const expired = () => {
      sessionStore.clearPersonal();
      setAuthenticated(false);
      setLocked(false);
      setPin("");
      setPinMessage("La sesión venció. Ingresa el PIN de nuevo.");
      setPinKind("error");
    };
    window.addEventListener("hopper:session-expired", expired);
    return () => window.removeEventListener("hopper:session-expired", expired);
  }, []);

  const unauthorize = useCallback(() => {
    sessionStore.clearPersonal();
    setAuthenticated(false);
    setLocked(false);
    setPin("");
    setPinMessage("La sesión venció. Ingresa el PIN de nuevo.");
    setPinKind("error");
  }, []);
  const syncChange = useCallback((label: string, variant: SyncVariant) => setSync({ label, variant }), []);

  const submitPin = async (pinValue = pin) => {
    if (pinSubmittingRef.current) return;
    if (pinValue.length !== 4) {
      setPinMessage("Escribe los cuatro dígitos del PIN.");
      setPinKind("error");
      return;
    }
    pinSubmittingRef.current = true;
    setPinSubmitting(true);
    setPinMessage("");
    setPinKind("");
    try {
      const result = await authApi.login(pinValue);
      if (result.status === "authorized") {
        setPin("");
        setAuthenticated(true);
        return;
      }
      if (result.status === "locked") {
        setLocked(true);
        setPinMessage("El acceso está bloqueado.");
        setPinKind("error");
        return;
      }
      const attempts = Number(result.remainingAttempts);
      setPinMessage(Number.isFinite(attempts) ? `PIN incorrecto. Quedan ${attempts} intento${attempts === 1 ? "" : "s"}.` : "PIN incorrecto.");
      setPinKind("error");
      setPin("");
    } catch (error) {
      setPinMessage(messageFor(error, "No fue posible validar el PIN."));
      setPinKind("error");
    } finally {
      pinSubmittingRef.current = false;
      setPinSubmitting(false);
    }
  };

  const requestRecovery = async () => {
    if (recoveryLoadingRef.current) return;
    recoveryLoadingRef.current = true;
    setRecoveryLoading(true);
    setRecoveryMessage("Enviando…");
    setRecoveryKind("");
    try {
      await authApi.requestRecovery();
      setRecoveryMessage("Enlace enviado.");
      setRecoveryKind("success");
    } catch (error) {
      setRecoveryMessage(messageFor(error, "No fue posible enviar el enlace."));
      setRecoveryKind("error");
    } finally {
      recoveryLoadingRef.current = false;
      setRecoveryLoading(false);
    }
  };

  const createRoom = async () => {
    if (roomSubmittingRef.current || (capacity.data?.available ?? 0) <= 0) return;
    roomSubmittingRef.current = true;
    setRoomSubmitting(true);
    try {
      const result = await roomsApi.create();
      setCreatedRoomCode(result.code || "");
      await capacity.refetch();
    } catch (error) {
      setRoomMessage(messageFor(error, "No fue posible crear la sala."));
      setRoomKind("error");
      await capacity.refetch();
    } finally {
      roomSubmittingRef.current = false;
      setRoomSubmitting(false);
    }
  };

  const joinRoom = async () => {
    if (roomSubmittingRef.current) return;
    if (!isCompleteRoomCode(roomCode)) {
      setRoomMessage("Código no válido.");
      setRoomKind("error");
      return;
    }
    roomSubmittingRef.current = true;
    setRoomSubmitting(true);
    setRoomMessage("");
    setRoomKind("");
    try {
      await roomsApi.join(roomCode);
      const url = new URL("room.html", window.location.href);
      url.hash = roomCode;
      window.location.assign(url.toString());
    } catch (error) {
      setRoomMessage(messageFor(error, "No fue posible entrar a la sala."));
      setRoomKind("error");
    } finally {
      roomSubmittingRef.current = false;
      setRoomSubmitting(false);
    }
  };

  const logout = () => {
    sessionStore.clearPersonal();
    setAuthenticated(false);
    setLocked(false);
    setPin("");
    setPinMessage("");
    setPinKind("");
    void capacity.refetch();
  };

  const enterCreatedRoom = () => {
    if (!createdRoomCode) return;
    const url = new URL("room.html", window.location.href);
    url.hash = createdRoomCode;
    window.location.assign(url.toString());
  };

  return <>
    <div className="app-shell">
      <AppHeader variant="home" authenticated={authenticated} syncLabel={sync.label} syncVariant={sync.variant} installVisible={pwa.installVisible} updateVisible={pwa.updateVisible} onInstall={() => { void pwa.install(); }} onUpdate={pwa.update} onLogout={logout} />
      <main className="app-main" id="app-main">
        <section className="auth-screen screen" id="auth-screen" hidden={authenticated} aria-labelledby="auth-title">
          <div className="auth-layout">
            <div className="auth-content">
              <img className="auth-logo" src="assets/favicon.svg" alt="" />
              <p className="eyebrow">HOPPER</p><h1 id="auth-title">Pasa cosas. Rápido.</h1><p className="auth-copy">Un espacio temporal para mover texto y archivos entre dispositivos.</p>
              <PinForm pin={pin} loading={pinSubmitting} locked={locked} disabled={!configured && !visual} message={pinMessage} messageKind={pinKind} recoveryMessage={recoveryMessage} recoveryKind={recoveryKind} recoveryLoading={recoveryLoading} onPinChange={(value) => { setPin(value); setPinMessage(""); setPinKind(""); }} onSubmit={(value) => { void submitPin(value); }} onRecovery={() => { void requestRecovery(); }} />
            </div>
            <span className="auth-divider" aria-hidden="true" />
            <RoomAccess available={capacity.data?.available ?? null} maximum={capacity.data?.maximum ?? 2} code={roomCode} submitting={roomSubmitting} message={roomMessage} messageKind={roomKind} onCodeChange={(value) => { setRoomCode(value); setRoomMessage(""); setRoomKind(""); }} onCreate={() => { void createRoom(); }} onJoin={() => { void joinRoom(); }} />
          </div>
        </section>
        <SpacePage active={authenticated} onUnauthorized={unauthorize} onSyncChange={syncChange} />
      </main>
      <RoomCreatedDialog code={createdRoomCode} onClose={() => setCreatedRoomCode("")} onEnter={enterCreatedRoom} />
    </div>
    <AppFooter />
  </>;
}
