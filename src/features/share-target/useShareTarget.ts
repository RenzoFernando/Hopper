import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../api/auth";
import { sessionStore } from "../../api/client";
import { itemsApi, roomItemsApi } from "../../api/items";
import { roomsApi } from "../../api/rooms";
import { appConfig } from "../../lib/config";
import { formatBytes } from "../../lib/format";
import { roomPath } from "../../lib/navigation";
import { isCompleteRoomCode, normalizeRoomCode } from "../../lib/room-code";
import { clearSharedPayload, readSharedPayload, writeSharedPayload, type PendingShareDelivery, type SharedPayload, type ShareDestination } from "../../lib/share-target-storage";
import type { TransferApi } from "../transfers/types";

const MAX_PAYLOAD_AGE_MS = 10 * 60 * 1000;
const PERSONAL_TTLS = [5, 15, 30, 60, 360];

type MessageKind = "" | "success" | "error";
type DestinationOption = { value: ShareDestination; label: string };
type ActiveDelivery = { destination: ShareDestination; textId: string; fileIds: Map<number, string> };

type ShareTransferApi = Pick<TransferApi, "listItems" | "createText" | "initializeUpload" | "uploadToSignedUrl" | "completeUpload" | "cancelUpload"> & {
  maxFileBytes: number;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function roomLabel() {
  const session = sessionStore.getRoom();
  if (!session?.roomId) return "Sala activa";
  return sessionStore.getRoomCodes()[session.roomId]?.code || "Sala activa";
}

function restoreDelivery(payload: SharedPayload | null): ActiveDelivery | null {
  const saved = payload?.delivery;
  if (!saved) return null;
  const fileIds = new Map<number, string>();
  for (const [index, id] of Object.entries(saved.fileIds || {})) {
    const numericIndex = Number(index);
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && id) fileIds.set(numericIndex, String(id));
  }
  return { destination: saved.destination, textId: String(saved.textId || ""), fileIds };
}

function serializedDelivery(delivery: ActiveDelivery): PendingShareDelivery {
  return {
    destination: delivery.destination,
    textId: delivery.textId,
    fileIds: Object.fromEntries([...delivery.fileIds.entries()].map(([index, id]) => [String(index), id]))
  };
}

async function confirmWithRetry(api: ShareTransferApi, id: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await api.completeUpload(id);
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
      if (!["upload-not-found", "storage-error", "network-error"].includes(code) || attempt === 3) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function putWithRetry(api: ShareTransferApi, file: File, uploadUrl: string, onProgress: (progress: number) => void, mimeType: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await api.uploadToSignedUrl(file, uploadUrl, onProgress, mimeType);
      return;
    } catch (error) {
      lastError = error;
      const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status || 0) : 0;
      const retryable = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
      if (!retryable || attempt === 1) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 900));
    }
  }
  throw lastError;
}

async function runWithConcurrency<T>(values: T[], limit: number, worker: (value: T) => Promise<void>) {
  let index = 0;
  const errors: unknown[] = [];
  const runners = Array.from({ length: Math.min(Math.max(1, Number(limit) || 1), values.length) }, async () => {
    while (index < values.length) {
      const current = index;
      index += 1;
      const value = values[current];
      if (value === undefined) continue;
      try {
        await worker(value);
      } catch (error) {
        errors[current] = error;
      }
    }
  });
  await Promise.all(runners);
  const failure = errors.find(Boolean);
  if (failure) throw failure;
}

async function verifyDelivered(api: ShareTransferApi, ids: string[]) {
  const expected = new Set(ids.filter(Boolean));
  if (expected.size === 0) throw new Error("Hopper no devolvió elementos para verificar.");
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await api.listItems();
      const visible = new Set(result.items.map((item) => item.id));
      if ([...expected].every((id) => visible.has(id))) return;
      lastError = new Error("El contenido todavía no aparece en el destino.");
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
  }

  throw lastError instanceof Error ? lastError : new Error("No fue posible comprobar el contenido enviado.");
}

export function useShareTarget(enabled = true) {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<SharedPayload | null>(null);
  const payloadRef = useRef<SharedPayload | null>(null);
  const pendingDeliveryRef = useRef<ActiveDelivery | null>(null);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [sessions, setSessions] = useState(() => ({ hasPersonal: sessionStore.hasPersonal(), hasRoom: sessionStore.hasRoom(), roomLabel: roomLabel() }));
  const [destination, setDestination] = useState<ShareDestination | "">("");
  const [ttlMinutes, setTtlMinutes] = useState(appConfig.defaultTtlMinutes || 5);
  const [pin, setPin] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [pinMessage, setPinMessage] = useState("");
  const [pinKind, setPinKind] = useState<MessageKind>("");
  const [roomMessage, setRoomMessage] = useState("");
  const [roomKind, setRoomKind] = useState<MessageKind>("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<MessageKind>("");
  const [progress, setProgress] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const authBusyRef = useRef(false);
  const [sendBusy, setSendBusy] = useState(false);
  const sendBusyRef = useRef(false);
  const [directSending, setDirectSending] = useState(false);

  const destinations = useMemo<DestinationOption[]>(() => {
    const values: DestinationOption[] = [];
    if (sessions.hasPersonal) values.push({ value: "personal", label: "Mi espacio" });
    if (sessions.hasRoom) values.push({ value: "room", label: sessions.roomLabel });
    return values;
  }, [sessions]);

  const refreshDestinations = useCallback((preferred: ShareDestination | "" = "") => {
    const hasPersonal = sessionStore.hasPersonal();
    const hasRoom = sessionStore.hasRoom();
    setSessions({ hasPersonal, hasRoom, roomLabel: roomLabel() });
    const available: ShareDestination[] = [];
    if (hasPersonal) available.push("personal");
    if (hasRoom) available.push("room");
    setDestination((current) => {
      if (preferred && available.includes(preferred)) return preferred;
      if (current && available.includes(current)) return current;
      return available[0] || "";
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      let stored = await readSharedPayload().catch(() => null);
      if (stored?.createdAt && stored.createdAt < Date.now() - MAX_PAYLOAD_AGE_MS) {
        await clearSharedPayload().catch(() => undefined);
        stored = null;
      }
      if (!alive) return;
      payloadRef.current = stored;
      pendingDeliveryRef.current = restoreDelivery(stored);
      setPayload(stored);
      refreshDestinations(pendingDeliveryRef.current?.destination || "");
      if (!stored || !([stored.title, stored.text, stored.url].some(Boolean) || stored.files.length > 0)) {
        setMessage("No hay contenido compartido pendiente.");
        setMessageKind("error");
      }
    })();

    const sessionsChanged = () => refreshDestinations();
    window.addEventListener("hopper:session-expired", sessionsChanged);
    window.addEventListener("hopper:room-session-expired", sessionsChanged);
    return () => {
      alive = false;
      window.removeEventListener("hopper:session-expired", sessionsChanged);
      window.removeEventListener("hopper:room-session-expired", sessionsChanged);
    };
  }, [enabled, refreshDestinations]);

  useEffect(() => {
    if (destination === "room") setTtlMinutes(5);
    else if (!PERSONAL_TTLS.includes(ttlMinutes)) setTtlMinutes(5);
  }, [destination, ttlMinutes]);

  const persistDelivery = useCallback(() => {
    const task = persistQueueRef.current.catch(() => undefined).then(async () => {
      const currentPayload = payloadRef.current;
      const delivery = pendingDeliveryRef.current;
      if (!currentPayload || !delivery) return;
      const nextPayload = { ...currentPayload, delivery: serializedDelivery(delivery) };
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      await writeSharedPayload(nextPayload);
    });
    persistQueueRef.current = task;
    return task;
  }, []);

  const apiFor = useCallback((target: ShareDestination): ShareTransferApi => target === "room"
    ? { ...roomItemsApi, maxFileBytes: appConfig.roomMaxFileBytes }
    : { ...itemsApi, maxFileBytes: appConfig.maxFileBytes }, []);

  const targetPath = useCallback((target: ShareDestination) => {
    if (target === "personal") return "/space";
    const session = sessionStore.getRoom();
    const code = session?.roomId ? sessionStore.getRoomCodes()[session.roomId]?.code || "" : "";
    return code ? roomPath(code) : "/room";
  }, []);

  const uploadFile = useCallback(async (api: ShareTransferApi, file: File, ttl: number, index: number, total: number) => {
    if (file.size > api.maxFileBytes) throw new Error(`${file.name || "El archivo"} supera el límite de ${formatBytes(api.maxFileBytes)}.`);
    let uploadId = "";
    try {
      setProgress(`${index + 1}/${total} · Preparando ${file.name || "archivo"}`);
      const initialized = await api.initializeUpload(file, ttl);
      uploadId = initialized.upload.id;
      const uploadUrl = initialized.upload.uploadUrl;
      if (!uploadId || !uploadUrl) throw new Error("Hopper no devolvió una URL de subida válida.");
      await putWithRetry(api, file, uploadUrl, (value) => setProgress(`${index + 1}/${total} · ${value}% · ${file.name || "archivo"}`), initialized.upload.mimeType || file.type || "application/octet-stream");
      setProgress(`${index + 1}/${total} · 100% · Confirmando`);
      const confirmed = await confirmWithRetry(api, uploadId);
      if (!confirmed.item.id || confirmed.item.id !== uploadId) throw new Error("Hopper no confirmó correctamente el archivo compartido.");
      return confirmed.item.id;
    } catch (error) {
      if (uploadId) void api.cancelUpload(uploadId).catch(() => undefined);
      throw error;
    }
  }, []);

  const canUseDestination = useCallback((target: ShareDestination) => target === "room" ? sessionStore.hasRoom() : sessionStore.hasPersonal(), []);

  const send = useCallback(async (override: ShareDestination | "" = "") => {
    const currentPayload = payloadRef.current;
    if (!currentPayload || sendBusyRef.current) return false;
    const hasContent = Boolean([currentPayload.title, currentPayload.text, currentPayload.url].filter(Boolean).join("\n").trim() || currentPayload.files.length > 0);
    if (!hasContent) return false;
    const target = override || destination;
    if (!target || !canUseDestination(target)) {
      refreshDestinations();
      setMessage("Primero inicia sesión en el destino.");
      setMessageKind("error");
      return false;
    }

    if (pendingDeliveryRef.current && pendingDeliveryRef.current.destination !== target) {
      const pending = pendingDeliveryRef.current.destination;
      setMessage(pending === "room" ? "Este contenido ya comenzó a enviarse a la sala. Termina ese envío antes de cambiar de destino." : "Este contenido ya comenzó a enviarse a Mi espacio. Termina ese envío antes de cambiar de destino.");
      setMessageKind("error");
      refreshDestinations(pending);
      return false;
    }

    const api = apiFor(target);
    const ttl = target === "room" ? 5 : ttlMinutes || 5;
    const text = [currentPayload.title, currentPayload.text, currentPayload.url].filter(Boolean).join("\n").trim();
    const files = currentPayload.files;
    sendBusyRef.current = true;
    setSendBusy(true);
    setMessage("Enviando…");
    setMessageKind("");
    let completed = false;

    try {
      if (!pendingDeliveryRef.current) pendingDeliveryRef.current = { destination: target, textId: "", fileIds: new Map() };
      const delivery = pendingDeliveryRef.current;

      if (text && !delivery.textId) {
        const created = await api.createText(text, ttl);
        if (!created.item.id) throw new Error("Hopper no confirmó correctamente el texto compartido.");
        delivery.textId = created.item.id;
        await persistDelivery();
      }

      const pendingFiles = files.map((file, index) => ({ file, index })).filter(({ index }) => !delivery.fileIds.has(index));
      await runWithConcurrency(pendingFiles, appConfig.uploadConcurrency, async ({ file, index }) => {
        const id = await uploadFile(api, file, ttl, index, files.length);
        delivery.fileIds.set(index, id);
        await persistDelivery();
      });

      if (delivery.fileIds.size !== files.length) throw new Error("No todos los archivos compartidos quedaron confirmados.");
      const ids = [...(delivery.textId ? [delivery.textId] : []), ...delivery.fileIds.values()];
      setProgress("Comprobando el destino…");
      await verifyDelivered(api, ids);
      await clearSharedPayload();
      completed = true;
      pendingDeliveryRef.current = null;
      payloadRef.current = null;
      setPayload(null);
      setProgress("");
      setMessage("Contenido enviado y confirmado.");
      setMessageKind("success");
      window.setTimeout(() => navigate(targetPath(target), { replace: true }), 350);
      return true;
    } catch (error) {
      await persistDelivery().catch(() => undefined);
      setMessage(errorMessage(error, "No fue posible enviar el contenido compartido."));
      setMessageKind("error");
      return false;
    } finally {
      if (!completed) {
        sendBusyRef.current = false;
        setSendBusy(false);
        refreshDestinations(pendingDeliveryRef.current?.destination || target);
      }
    }
  }, [apiFor, canUseDestination, destination, navigate, persistDelivery, refreshDestinations, targetPath, ttlMinutes, uploadFile]);

  const submitPin = useCallback(async () => {
    if (authBusyRef.current) return;
    if (pin.length !== 4) {
      setPinMessage("Escribe los cuatro dígitos del PIN.");
      setPinKind("error");
      return;
    }
    authBusyRef.current = true;
    setAuthBusy(true);
    setPinMessage("");
    setPinKind("");
    try {
      const result = await authApi.login(pin);
      if (result.status === "authorized") {
        setPin("");
        refreshDestinations("personal");
        setDirectSending(true);
        try {
          await send("personal");
        } finally {
          setDirectSending(false);
        }
        return;
      }
      if (result.status === "locked") {
        setPinMessage("Hopper está bloqueado. Usa Recuperar acceso desde la página principal.");
        setPinKind("error");
        return;
      }
      const attempts = Number(result.remainingAttempts);
      setPinMessage(Number.isFinite(attempts) ? `PIN incorrecto. Quedan ${attempts} intento${attempts === 1 ? "" : "s"}.` : "PIN incorrecto.");
      setPinKind("error");
      setPin("");
    } catch (error) {
      setPinMessage(errorMessage(error, "No fue posible validar el PIN."));
      setPinKind("error");
    } finally {
      authBusyRef.current = false;
      setAuthBusy(false);
    }
  }, [pin, refreshDestinations, send]);

  const submitRoom = useCallback(async () => {
    if (authBusyRef.current) return;
    const normalized = normalizeRoomCode(roomCode);
    setRoomCode(normalized);
    if (!isCompleteRoomCode(normalized)) {
      setRoomMessage("Código no válido.");
      setRoomKind("error");
      return;
    }
    authBusyRef.current = true;
    setAuthBusy(true);
    setRoomMessage("");
    setRoomKind("");
    try {
      await roomsApi.join(normalized);
      refreshDestinations("room");
      setDirectSending(true);
      try {
        await send("room");
      } finally {
        setDirectSending(false);
      }
    } catch (error) {
      setRoomMessage(errorMessage(error, "No fue posible entrar a la sala."));
      setRoomKind("error");
    } finally {
      authBusyRef.current = false;
      setAuthBusy(false);
    }
  }, [refreshDestinations, roomCode, send]);

  const discard = useCallback(async () => {
    await clearSharedPayload().catch(() => undefined);
    payloadRef.current = null;
    pendingDeliveryRef.current = null;
    setPayload(null);
    navigate("/", { replace: true });
  }, [navigate]);

  const summary = useMemo(() => {
    if (!payload) return [] as string[];
    const values: string[] = [];
    const text = [payload.title, payload.text, payload.url].filter(Boolean).join("\n").trim();
    if (text) values.push(`Texto · ${text.length.toLocaleString("es-CO")} caracteres`);
    for (const file of payload.files) values.push(`${file.name || "Archivo compartido"} · ${formatBytes(file.size)}`);
    return values;
  }, [payload]);

  const ttlOptions = destination === "room" ? [5] : PERSONAL_TTLS;
  const hasDestination = destinations.length > 0;
  const hasContent = summary.length > 0;

  return {
    payload,
    summary,
    destinations,
    destination,
    setDestination,
    ttlMinutes,
    setTtlMinutes,
    ttlOptions,
    pin,
    setPin: (value: string) => { setPin(value.replace(/\D/g, "").slice(0, 4)); setPinMessage(""); setPinKind(""); },
    roomCode,
    setRoomCode: (value: string) => { setRoomCode(normalizeRoomCode(value)); setRoomMessage(""); setRoomKind(""); },
    pinMessage,
    pinKind,
    roomMessage,
    roomKind,
    message,
    messageKind,
    progress,
    authBusy,
    sendBusy,
    directSending,
    hasPersonal: sessions.hasPersonal,
    hasRoom: sessions.hasRoom,
    hasDestination,
    hasContent,
    submitPin,
    submitRoom,
    send,
    discard
  };
}
