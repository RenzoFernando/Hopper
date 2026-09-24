import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { copyTextToClipboard } from "../../lib/clipboard";
import { chooseDownloadDirectory, downloadBlobWithBrowser, ensureDownloadDirectoryPermission, loadDownloadDirectory, saveBlobToDirectory, supportsDownloadDirectory, type HopperDirectoryHandle } from "../../lib/download-directory";
import { fileExtension, fileTypeInfo } from "../../lib/file-types";
import { formatBytes } from "../../lib/format";
import { createZipBlob } from "../../lib/zip";
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

const TEXT_PREVIEW_LIMIT_BYTES = 4 * 1024 * 1024;

function zipFileName() {
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const random = new Uint16Array(1);
  crypto.getRandomValues(random);
  return `hopper-${date}-${String((random[0] ?? 0) % 10000).padStart(4, "0")}.zip`;
}

function previewMimeType(item: HopperItem) {
  const mime = String(item.mimeType || "").toLowerCase();
  if (mime && mime !== "application/octet-stream") return mime;
  const extension = fileExtension(item.name || "");
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "avif") return "image/avif";
  if (extension === "pdf") return "application/pdf";
  return mime || "application/octet-stream";
}


async function imageToClipboardBlob(blob: Blob) {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new ApiError("No fue posible preparar la imagen para el portapapeles.");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new ApiError("No fue posible preparar la imagen para el portapapeles.")), "image/png");
    });
  } finally {
    bitmap.close();
  }
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
  const [preview, setPreviewState] = useState<PreviewState>(null);
  const [deleteTarget, setDeleteTarget] = useState<HopperItem | null>(null);
  const [downloadDirectory, setDownloadDirectory] = useState<HopperDirectoryHandle | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
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

  useEffect(() => {
    if (!supportsDownloadDirectory()) return;
    void loadDownloadDirectory().then(setDownloadDirectory).catch(() => undefined);
  }, []);

  useEffect(() => () => {
    if (preview?.url?.startsWith("blob:")) URL.revokeObjectURL(preview.url);
  }, [preview]);

  useEffect(() => () => {
    for (const entry of selectedFilesRef.current) entry.controller?.abort();
  }, []);

  const setPreview = useCallback((next: PreviewState) => setPreviewState(next), []);

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

  const fetchItemBlob = useCallback(async (item: HopperItem) => {
    const result = await api.getFileUrl(item.id, "download");
    const response = await fetch(result.url);
    if (!response.ok) throw new ApiError(`No fue posible leer ${item.name || "el archivo"}.`, { status: response.status, code: "download-failed" });
    onActivity();
    return response.blob();
  }, [api, onActivity]);

  const copyFileItem = useCallback(async (item: HopperItem) => {
    const info = fileTypeInfo(item.name || "", item.mimeType || "");
    if (info.previewKind === "image") {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new ApiError("Copiar imágenes no está disponible en este navegador.");
      const source = await fetchItemBlob(item);
      const typed = new Blob([source], { type: previewMimeType(item) });
      const clipboardBlob = await imageToClipboardBlob(typed);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": clipboardBlob })]);
      showToast("Imagen copiada.", "success");
      return;
    }
    if (!info.copyable) throw new ApiError("Este tipo de archivo no se puede copiar al portapapeles.");
    if (Number(item.size || 0) > TEXT_PREVIEW_LIMIT_BYTES) throw new ApiError(`El archivo supera ${formatBytes(TEXT_PREVIEW_LIMIT_BYTES)} y es demasiado grande para copiarlo completo.`);
    const blob = await fetchItemBlob(item);
    await copyTextToClipboard(await blob.text());
    showToast("Contenido del archivo copiado.", "success");
  }, [fetchItemBlob, showToast]);

  const chooseDirectory = useCallback(async () => {
    try {
      const handle = await chooseDownloadDirectory();
      setDownloadDirectory(handle);
      showToast(`Las descargas de Hopper se guardarán en ${handle.name}.`, "success");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      showToast(errorInfo(caught).message || "No fue posible seleccionar la carpeta.", "error");
    }
  }, [showToast]);

  const permittedDirectory = useCallback(async () => {
    if (!downloadDirectory) return null;
    try {
      return await ensureDownloadDirectoryPermission(downloadDirectory);
    } catch {
      return null;
    }
  }, [downloadDirectory]);

  const triggerSignedDownload = useCallback(async (item: HopperItem) => {
    const result = await api.getFileUrl(item.id, "download");
    const link = document.createElement("a");
    link.href = result.url;
    link.download = item.name || "archivo";
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    onActivity();
  }, [api, onActivity]);

  const downloadItem = useCallback(async (item: HopperItem) => {
    const directory = await permittedDirectory();
    if (!directory) {
      await triggerSignedDownload(item);
      return;
    }
    const blob = await fetchItemBlob(item);
    await saveBlobToDirectory(directory, item.name || "archivo", blob);
    showToast(`Guardado en ${directory.name}.`, "success");
  }, [fetchItemBlob, permittedDirectory, showToast, triggerSignedDownload]);

  const downloadItems = useCallback(async (items: HopperItem[]) => {
    const files = items.filter((item) => item.type === "file");
    if (files.length === 0) throw new ApiError("No hay archivos para descargar.");
    if (files.length === 1 && files[0]) {
      await downloadItem(files[0]);
      return;
    }

    setBatchBusy(true);
    try {
      const directory = await permittedDirectory();
      const entries = [];
      for (const item of files) {
        const blob = await fetchItemBlob(item);
        entries.push({ name: item.name || "archivo", blob, modifiedAt: new Date(item.createdAt) });
      }
      const zip = await createZipBlob(entries);
      const name = zipFileName();
      if (directory) await saveBlobToDirectory(directory, name, zip);
      else downloadBlobWithBrowser(name, zip);
      showToast(`${files.length} archivos empaquetados en ${name}.`, "success");
    } finally {
      setBatchBusy(false);
    }
  }, [downloadItem, fetchItemBlob, permittedDirectory, showToast]);

  const previewItem = useCallback(async (item: HopperItem) => {
    const info = fileTypeInfo(item.name || "", item.mimeType || "");
    if (!info.previewKind) throw new ApiError("Este tipo de archivo no tiene vista previa temporal.");

    if (info.previewKind === "text" || info.previewKind === "markdown") {
      if (Number(item.size || 0) > TEXT_PREVIEW_LIMIT_BYTES) throw new ApiError(`La vista previa de texto admite hasta ${formatBytes(TEXT_PREVIEW_LIMIT_BYTES)}.`);
      const blob = await fetchItemBlob(item);
      setPreview({ item, kind: info.previewKind, text: await blob.text() });
      return;
    }

    const blob = await fetchItemBlob(item);
    const typedBlob = new Blob([blob], { type: previewMimeType(item) });
    setPreview({ item, kind: info.previewKind, url: URL.createObjectURL(typedBlob) });
  }, [fetchItemBlob, setPreview]);

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


  const deleteItems = useCallback(async (items: HopperItem[]) => {
    if (items.length === 0) return;
    setBatchBusy(true);
    try {
      const results = await runWithConcurrency(items, 3, async (item) => {
        try {
          await api.deleteItem(item.id);
          return { id: item.id, ok: true as const };
        } catch (caught) {
          return { id: item.id, ok: false as const, error: errorInfo(caught) };
        }
      });
      const deleted = new Set(results.filter((result) => result.ok).map((result) => result.id));
      queryClient.setQueryData<ItemsResponse>(itemQueryKey, (current) => current ? { ...current, items: current.items.filter((entry) => !deleted.has(entry.id)) } : current);
      const failed = results.filter((result) => !result.ok);
      if (failed.length === 0) showToast(`${deleted.size} archivos eliminados.`, "success");
      else showToast(`${deleted.size} eliminados; ${failed.length} no pudieron eliminarse.`, "error");
    } finally {
      setBatchBusy(false);
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
    batchBusy,
    downloadDirectorySupported: supportsDownloadDirectory(),
    downloadDirectoryName: downloadDirectory?.name || "",
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
    copyFileItem,
    chooseDownloadDirectory: chooseDirectory,
    downloadItem,
    downloadItems,
    previewItem,
    shareItem,
    deleteItem,
    deleteItems,
    resetTtl,
    showToast,
    api,
    onActivity
  };
}