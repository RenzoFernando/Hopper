import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { sessionStore } from "../api/client";
import { roomsApi } from "../api/rooms";
import { AppFooter } from "../components/layout/AppFooter";
import { AppHeader } from "../components/layout/AppHeader";
import { RoomCodeInput } from "../components/rooms/RoomCodeInput";
import { RoomWorkspace } from "../components/rooms/RoomWorkspace";
import { ToastRegion } from "../components/ui/ToastRegion";
import { useNow } from "../hooks/useNow";
import { useToasts } from "../hooks/useToasts";
import { copyTextToClipboard } from "../lib/clipboard";
import { formatCountdown } from "../lib/format";
import { roomPath, roomUrl } from "../lib/navigation";
import { isCompleteRoomCode, normalizeRoomCode } from "../lib/room-code";
import { isVisualTestRuntime } from "../lib/runtime";
import type { Room } from "../schemas/room";

export function RoomPage() {
  const navigate = useNavigate();
  const params = useParams<{ code?: string }>();
  const visual = isVisualTestRuntime();
  const [joining, setJoining] = useState(false);
  const joiningRef = useRef(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [code, setCode] = useState(() => visual ? "" : normalizeRoomCode(params.code || ""));
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"" | "success" | "error">("");
  const toasts = useToasts();
  const now = useNow();
  const initializedInvite = useRef("");
  const lastActivityAt = useRef(0);
  const activityPromise = useRef<Promise<unknown> | null>(null);

  const rememberedCode = useCallback((roomId: string) => sessionStore.getRoomCodes()[roomId]?.code || "", []);
  const leaveToHome = useCallback(() => {
    sessionStore.clearRoom();
    navigate("/", { replace: true });
  }, [navigate]);

  const markActivity = useCallback((force = false) => {
    if (!room || activityPromise.current) return;
    const time = Date.now();
    if (!force && time - lastActivityAt.current < 30_000) return;
    lastActivityAt.current = time;
    activityPromise.current = roomsApi.activity().then((result) => {
      setRoom(result.room);
    }).catch((error: unknown) => {
      if (error instanceof Error && "status" in error && (error as { status?: number }).status === 401) leaveToHome();
    }).finally(() => { activityPromise.current = null; });
  }, [leaveToHome, room]);

  const enterRoom = useCallback((nextRoom: Room, nextCode = "") => {
    const resolvedCode = nextCode || rememberedCode(nextRoom.id);
    setRoom(nextRoom);
    setCode(resolvedCode);
    lastActivityAt.current = Date.now();
    setMessage("");
    setMessageKind("");
    if (resolvedCode && window.location.pathname !== roomPath(resolvedCode)) navigate(roomPath(resolvedCode), { replace: true });
  }, [navigate, rememberedCode]);

  const joinRoom = useCallback(async (requestedCode = code) => {
    if (joiningRef.current) return;
    const normalized = normalizeRoomCode(requestedCode);
    setCode(normalized);
    if (!isCompleteRoomCode(normalized)) {
      setMessage("Código no válido.");
      setMessageKind("error");
      return;
    }
    joiningRef.current = true;
    setJoining(true);
    setMessage("");
    setMessageKind("");
    try {
      const result = await roomsApi.join(normalized);
      enterRoom(result.room, normalized);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible entrar a la sala.");
      setMessageKind("error");
    } finally {
      joiningRef.current = false;
      setJoining(false);
    }
  }, [code, enterRoom]);

  useEffect(() => {
    if (visual) return;
    const routeCode = normalizeRoomCode(params.code || "");
    const inviteKey = routeCode || "__room__";
    if (initializedInvite.current === inviteKey) return;
    initializedInvite.current = inviteKey;

    const initialize = async () => {
      const hasInvite = isCompleteRoomCode(routeCode);
      if (hasInvite) {
        setCode(routeCode);
        const stored = sessionStore.getRoom();
        const storedCode = stored?.roomId ? rememberedCode(stored.roomId) : "";
        if (stored && storedCode && storedCode !== routeCode) sessionStore.clearRoom();
      }

      if (sessionStore.hasRoom()) {
        try {
          const result = await roomsApi.status();
          const knownCode = rememberedCode(result.room.id);
          if (!hasInvite || !knownCode || knownCode === routeCode) {
            enterRoom(result.room, knownCode || routeCode);
            return;
          }
          sessionStore.clearRoom();
        } catch {
          sessionStore.clearRoom();
        }
      }

      if (hasInvite) await joinRoom(routeCode);
    };

    void initialize();
  }, [enterRoom, joinRoom, params.code, rememberedCode, visual]);

  useEffect(() => {
    const expired = () => leaveToHome();
    window.addEventListener("hopper:room-session-expired", expired);
    return () => window.removeEventListener("hopper:room-session-expired", expired);
  }, [leaveToHome]);

  useEffect(() => {
    if (!room) return;
    const activity = () => markActivity(false);
    for (const eventName of ["pointerdown", "keydown", "input", "touchstart"]) document.addEventListener(eventName, activity, { passive: true, capture: true });
    return () => { for (const eventName of ["pointerdown", "keydown", "input", "touchstart"]) document.removeEventListener(eventName, activity, { capture: true }); };
  }, [markActivity, room]);

  useEffect(() => {
    if (room && Date.parse(room.expiresAt) <= now) leaveToHome();
  }, [leaveToHome, now, room]);

  const shareRoom = async () => {
    if (!code || !room) return;
    const url = roomUrl(code);
    const text = `Hopper\nSala: ${code}\n${url}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Hopper", text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await copyTextToClipboard(text);
      toasts.showToast("Sala copiada.", "success");
    } catch {
      toasts.showToast("No fue posible compartir la sala.", "error");
    }
  };

  const active = Boolean(room);
  return <>
    <div className="app-shell">
      <AppHeader variant="room" authenticated={active} roomCode={code} roomExpiry={room ? formatCountdown(room.expiresAt, now) : "--:--"} onShareRoom={() => { void shareRoom(); }} onLeaveRoom={leaveToHome} />
      <main className="app-main">
        <section className="auth-screen screen" id="room-join-screen" hidden={active} aria-labelledby="room-join-title"><div className="auth-content room-join-content"><img className="auth-logo" src="/assets/favicon.svg" alt="" /><p className="eyebrow">SALA</p><h1 id="room-join-title">Entrar a una sala</h1><form className="pin-form room-code-form" id="room-form" noValidate onSubmit={(event) => { event.preventDefault(); void joinRoom(); }}><label htmlFor="room-code-input">Código</label><div className="pin-field"><RoomCodeInput id="room-code-input" value={code} autoFocus onChange={(value) => { setCode(value); setMessage(""); setMessageKind(""); }} disabled={joining} /><span className="pin-loader" id="room-loader" hidden={!joining} aria-hidden="true" /></div><button className="primary-button" type="submit" disabled={joining}>Entrar</button></form><p className={`form-message ${messageKind ? `is-${messageKind}` : ""}`.trim()} id="room-message" aria-live="polite" hidden={!message}>{message}</p><a className="auth-secondary-link" href="/">Volver</a></div></section>
        <RoomWorkspace room={room} active={active} onUnauthorized={leaveToHome} onActivity={() => markActivity(false)} toastController={toasts} />
      </main>
      {!active && <ToastRegion toasts={toasts.toasts} />}
    </div>
    <AppFooter />
  </>;
}
