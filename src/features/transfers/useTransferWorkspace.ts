import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { copyTextToClipboard } from "../../lib/clipboard";
import { formatBytes } from "../../lib/format";
import type { HopperItem, ItemsResponse } from "../../schemas/item";
import type { PreviewState, SelectedFileEntry, TransferWorkspaceOptions } from "./types";

function errorInfo(error: unknown) {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) return new ApiError(error.message);
  return new ApiError("Hopper no pudo completar la operación.");
}

function runWithConcurrency<T, R>(values: T[], limit: number, worker: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    while (index < values.length) {
      const currentIndex = index;
      index += 1;
      const value = values[currentIndex];
      if (value !== undefined) results[currentIndex] = await worker(value);
    }
  });
  return Promise.all(runners).then(() => results);
}

export function useTransferWorkspace(options: TransferWorkspaceOptions, showToast: (message: string, kind?: "" | "success" | "error") => void) {
  const {
    api,
    queryKey,
    enabled,
    maxFileBytes,
    defaultTtlMinutes,
    ttlOptions,
    pollIntervalMs,
    uploadConcurrency,
    maxSelectedFiles = 20,
    allowTtlReset = true,
    onUnauthorized,
    onActivity = () => {},
    onSyncChange = () => {}
  } = options;
  const queryClient = useQueryClient();
  const [selectedFiles, setSelectedFiles] = useState<SelectedFileEntry[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [text, setText] = useState("");
  const [ttlMinutes, setTtlMinutes] = useState(defaultTtlMinutes);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [deleteTarget, setDeleteTarget] = useState<HopperItem | null>(null);
  const online = useRef(typeof navigator === "undefined" ? true : navigator.onLine);
  const selectedFilesRef = useRef<SelectedFileEntry[]>([]);
  const itemQueryKey = useMemo(() => ["hopper-items", queryKey] as const, [queryKey]);

  const {
    data: queryData,
    error: queryError,
    isError: queryIsError,
    isFetching: queryIsFetching,
    isPending: queryIsPending,
    refetch
  } = useQuery({
    queryKey: itemQueryKey,
    queryFn: api.listItems,
    enabled,
    refetchInterval: sending ? false : pollIntervalMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1
  });

  useEffect(() => {
    if (!enabled) return;
    if (!online.current) onSyncChange("Sin conexión", "offline");
    else if (queryIsFetching) onSyncChange("Sincronizando…", "busy");
    else if (queryIsError) onSyncChange("Reintentando", "busy");
    else onSyncChange("Sincronizado", "ok");
  }, [enabled, onSyncChange, queryIsError, queryIsFetching]);

  useEffect(() => {
    if (!queryError) return;
    const error = errorInfo(queryError);
    if (error.status === 401 || error.code === "invalid-session" || error.code === "invalid-room-session") {
      onUnauthorized();
      return;
    }
    if (!queryData) showToast(error.message || "No fue posible actualizar Hopper.", "error");
  }, [onUnauthorized, queryData, queryError, showToast]);

  useEffect(() => {
    const offline = () => {
      online.current = false;
      onSyncChange("Sin conexión", "offline");
    };
    const onlineAgain = () => {
      online.current = true;
      onSyncChange("Reintentando", "busy");
      void refetch();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", onlineAgain);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", onlineAgain);
    };
  }, [onSyncChange, refetch]);

  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  useEffect(() => () => {
    for (const entry of selectedFilesRef.current) entry.controller?.abort();
  }, []);

  const updateSelected = useCallback((key: string, patch: Partial<SelectedFileEntry>) => {
    setSelectedFiles((current) => current.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  }, []);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const availableSlots = Math.max(0, maxSelectedFiles - selectedFilesRef.current.length);
    const accepted = files.slice(0, availableSlots);
    if (files.length > availableSlots) showToast(`Puedes preparar hasta ${maxSelectedFiles} archivos por envío.`, "error");

    const entries: SelectedFileEntry[] = [];
    for (const file of accepted) {
      if (file.size > maxFileBytes) {
        showToast(`${file.name} supera el límite de ${formatBytes(maxFileBytes)}.`, "error");
        continue;
      }
      entries.push({ key: crypto.randomUUID(), file, progress: 0, status: "", uploadId: "", controller: null });
    }

    if (entries.length > 0) {
      setSelectedFiles((current) => [...current, ...entries].slice(0, maxSelectedFiles));
    }
    onActivity();
  }, [maxFileBytes, maxSelectedFiles, onActivity, showToast]);

  const completeUploadWithRetry = useCallback(async (id: string) => {
    let lastError: ApiError | null = null;
    const retryableCodes = new Set(["upload-not-found", "storage-error", "network-error"]);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await api.completeUpload(id);
        if (attempt > 0) showToast("La confirmación se recuperó tras un reintento.", "success");
        return result;
      } catch (caught) {
        const error = errorInfo(caught);
        lastError = error;
        if (!retryableCodes.has(error.code) || attempt === 3) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
    throw lastError ?? new ApiError("No fue posible confirmar la subida.");
  }, [api, showToast]);

  const putWithRetry = useCallback(async (entry: SelectedFileEntry, uploadUrl: string, mimeType: string) => {
    let lastError: ApiError | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await api.uploadToSignedUrl(entry.file, uploadUrl, (progress) => {
          updateSelected(entry.key, { progress });
          onActivity();
        }, mimeType, entry.controller?.signal);
        return;
      } catch (caught) {
        const error = errorInfo(caught);
        lastError = error;
        const status = error.status;
        const retryable = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
        if (error.code === "upload-aborted" || !retryable || attempt === 1) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }
    }
    throw lastError ?? new ApiError("No fue posible subir el archivo.");
  }, [api, onActivity, updateSelected]);

  const uploadEntry = useCallback(async (entry: SelectedFileEntry, ttl: number) => {
    let uploadId = "";
    const controller = new AbortController();
    try {
      updateSelected(entry.key, { status: "preparando", progress: 0, controller });
      const initialized = await api.initializeUpload(entry.file, ttl);
      uploadId = initialized.upload.id;
      const uploadUrl = initialized.upload.uploadUrl;
      const mimeType = initialized.upload.mimeType || entry.file.type || "application/octet-stream";
      const activeEntry = { ...entry, controller };
      updateSelected(entry.key, { status: "subiendo", uploadId, controller });
      await putWithRetry(activeEntry, uploadUrl, mimeType);
      updateSelected(entry.key, { status: "confirmando", progress: 100 });
      await completeUploadWithRetry(uploadId);
      updateSelected(entry.key, { status: "listo", progress: 100, controller: null });
      return { ok: true as const, key: entry.key, cancelled: false };
    } catch (caught) {
      const error = errorInfo(caught);
      if (uploadId) void api.cancelUpload(uploadId, error.code !== "upload-aborted").catch(() => undefined);
      if (error.code === "upload-aborted") {
        setSelectedFiles((current) => current.filter((item) => item.key !== entry.key));
        return { ok: false as const, key: entry.key, cancelled: true, error };
      }
      updateSelected(entry.key, { status: "error", controller: null });
      return { ok: false as const, key: entry.key, cancelled: false, error };
    }
  }, [api, completeUploadWithRetry, putWithRetry, updateSelected]);

  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      onSyncChange("Sin conexión", "offline");
      return;
    }
    await refetch();
  }, [onSyncChange, refetch]);

  const send = useCallback(async () => {
    if (sendingRef.current) return;
    const files = selectedFiles.filter((entry) => entry.status !== "listo");
    const hasText = Boolean(text.trim());
    if (!hasText && files.length === 0) {
      showToast("Pega texto o adjunta al menos un archivo.", "error");
      return;
    }
    onActivity();
    sendingRef.current = true;
    setSending(true);
    const failures: Array<{ label: string; error: ApiError }> = [];
    let textCreated = false;
    try {
      if (hasText) {
        try {
          await api.createText(text, ttlMinutes);
          textCreated = true;
        } catch (caught) {
          failures.push({ label: "texto", error: errorInfo(caught) });
        }
      }
      const results = await runWithConcurrency(files, uploadConcurrency, (entry) => uploadEntry(entry, ttlMinutes));
      for (const result of results) {
        if (!result.ok && !result.cancelled) {
          const entry = files.find((item) => item.key === result.key);
          failures.push({ label: entry?.file.name || "archivo", error: result.error });
        }
      }
      if (textCreated) setText("");
      const successful = new Set(results.filter((result) => result.ok).map((result) => result.key));
      setSelectedFiles((current) => current.filter((entry) => !successful.has(entry.key)));
      if (failures.length === 0) showToast("Contenido disponible en Hopper.", "success");
      else if (failures.length === 1) showToast(`${failures[0]?.label ?? "Elemento"}: ${failures[0]?.error.message || "no pudo enviarse"}`, "error");
      else showToast(`${failures.length} elementos no pudieron enviarse.`, "error");
      await queryClient.invalidateQueries({ queryKey: itemQueryKey });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [api, itemQueryKey, onActivity, queryClient, selectedFiles, showToast, text, ttlMinutes, uploadConcurrency, uploadEntry]);

  const retryFile = useCallback(async (key: string) => {
    if (sendingRef.current) return;
    const entry = selectedFiles.find((item) => item.key === key);
    if (!entry) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const result = await uploadEntry(entry, ttlMinutes);
      if (result.ok) {
        setSelectedFiles((current) => current.filter((item) => item.key !== key));
        await queryClient.invalidateQueries({ queryKey: itemQueryKey });
        showToast("Archivo enviado.", "success");
      } else if (!result.cancelled) showToast(result.error.message || "No fue posible reenviar el archivo.", "error");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [itemQueryKey, queryClient, selectedFiles, showToast, ttlMinutes, uploadEntry]);

  const removeFile = useCallback((key: string) => setSelectedFiles((current) => current.filter((entry) => entry.key !== key)), []);
  const cancelFile = useCallback((key: string) => {
    const entry = selectedFiles.find((item) => item.key === key);
    entry?.controller?.abort();
    if (entry?.uploadId) void api.cancelUpload(entry.uploadId).catch(() => undefined);
    removeFile(key);
  }, [api, removeFile, selectedFiles]);

  const copyItem = useCallback(async (item: HopperItem) => {
    await copyTextToClipboard(item.content || "");
    showToast("Texto copiado.", "success");
  }, [showToast]);

  const downloadItem = useCallback(async (item: HopperItem) => {
    const result = await api.getFileUrl(item.id, "download");
    const link = document.createElement("a");
    link.href = result.url;
    link.download = item.name || "archivo";
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  }, [api]);

  const previewItem = useCallback(async (item: HopperItem) => {
    const result = await api.getFileUrl(item.id, "preview");
    setPreview({ item, url: result.url });
  }, [api]);

  const shareItem = useCallback(async (item: HopperItem) => {
    if (typeof navigator.share !== "function") throw new ApiError("Compartir no está disponible en este navegador.");
    if (item.type === "text") {
      await navigator.share({ title: "Hopper", text: item.content || "" });
      return;
    }
    const result = await api.getFileUrl(item.id, "download");
    await navigator.share({ title: item.name || "Hopper", text: `${item.name || "Archivo"} · enlace temporal de Hopper`, url: result.url });
  }, [api]);

  const deleteItem = useCallback(async (item: HopperItem) => {
    try {
      await api.deleteItem(item.id);
      queryClient.setQueryData<ItemsResponse>(itemQueryKey, (current) => current ? { ...current, items: current.items.filter((entry) => entry.id !== item.id) } : current);
      showToast("Elemento eliminado.", "success");
    } catch (caught) {
      showToast(errorInfo(caught).message || "No fue posible eliminar el elemento.", "error");
    }
  }, [api, itemQueryKey, queryClient, showToast]);

  const resetTtl = useCallback(async (item: HopperItem, minutes: number) => {
    if (!allowTtlReset || !api.resetTtl) return;
    try {
      const result = await api.resetTtl(item.id, minutes);
      queryClient.setQueryData<ItemsResponse>(itemQueryKey, (current) => current ? { ...current, items: current.items.map((entry) => entry.id === result.item.id ? result.item : entry) } : current);
      showToast("Cuenta regresiva reiniciada.", "success");
    } catch (caught) {
      showToast(errorInfo(caught).message || "No fue posible cambiar la expiración.", "error");
      await refetch();
    }
  }, [allowTtlReset, api, itemQueryKey, queryClient, refetch, showToast]);

  return {
    items: queryData?.items ?? [],
    loading: enabled && queryIsPending,
    selectedFiles,
    sending,
    text,
    ttlMinutes,
    ttlOptions,
    dragging,
    preview,
    deleteTarget,
    maxFileBytes,
    allowTtlReset,
    setText,
    setTtlMinutes,
    setDragging,
    setPreview,
    setDeleteTarget,
    addFiles,
    refresh,
    send,
    retryFile,
    removeFile,
    cancelFile,
    copyItem,
    downloadItem,
    previewItem,
    shareItem,
    deleteItem,
    resetTtl,
    showToast,
    api,
    onActivity
  };
}
