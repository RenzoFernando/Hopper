import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { copyTextToClipboard } from "../../lib/clipboard";
import { chooseDownloadDirectory, clearDownloadDirectory, cleanupTemporaryDownloads, downloadBlobWithBrowser, ensureDownloadDirectoryPermission, listTemporaryDownloads, loadDownloadDirectory, saveTemporaryDownload, supportsDownloadDirectory, temporaryFileName, type HopperDirectoryHandle, type TemporaryDownloadInfo } from "../../lib/download-directory";
import { fileExtension, fileTypeInfo } from "../../lib/file-types";
import { formatBytes } from "../../lib/format";
import { createZipBlob } from "../../lib/zip";
import { beginTransfer } from "../../lib/transfer-activity";
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

// Un callback predeterminado debe conservar su identidad entre renderizados.
const noop = () => undefined;

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
    onActivity = noop,
    onSyncChange = noop
  } = options;
  const queryClient = useQueryClient();
  const [selectedFiles, setSelectedFiles] = useState<SelectedFileEntry[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const uploadTasks = useRef(new Set<string>());
  const [text, setText] = useState("");
  const [ttlMinutes, setTtlMinutes] = useState(defaultTtlMinutes);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreviewState] = useState<PreviewState>(null);
  const [deleteTarget, setDeleteTarget] = useState<HopperItem | null>(null);
  const [downloadDirectory, setDownloadDirectory] = useState<HopperDirectoryHandle | null>(null);
  const [downloadDirectoryItems, setDownloadDirectoryItems] = useState<TemporaryDownloadInfo[] | null>(null);
  const [downloadDirectoryLoading, setDownloadDirectoryLoading] = useState(false);
  const directoryRequest = useRef(0);
  const [batchBusy, setBatchBusy] = useState(false);
  const online = useRef(typeof navigator === "undefined" ? true : navigator.onLine);
  const selectedFilesRef = useRef<SelectedFileEntry[]>([]);
  const transferReleaseRef = useRef<(() => void) | null>(null);
  const itemQueryKey = useMemo(() => ["hopper-items", queryKey] as const, [queryKey]);
  const replaceSelected = useCallback((updater: (files: SelectedFileEntry[]) => SelectedFileEntry[]) => {
    const next = updater(selectedFilesRef.current);
    selectedFilesRef.current = next;
    setSelectedFiles(next);
  }, []);

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
    const uploading = sending || selectedFiles.some((entry) =>
      entry.status === "preparando" || entry.status === "subiendo" || entry.status === "confirmando"
    );
    if (uploading && !transferReleaseRef.current) transferReleaseRef.current = beginTransfer();
    if (!uploading && transferReleaseRef.current) {
      transferReleaseRef.current();
      transferReleaseRef.current = null;
    }
  }, [selectedFiles, sending]);

  useEffect(() => () => {
    transferReleaseRef.current?.();
    transferReleaseRef.current = null;
  }, []);

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
    if (!supportsDownloadDirectory()) return;
    void loadDownloadDirectory().then(setDownloadDirectory).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!enabled || !queryData || queryIsError) return;
    void cleanupTemporaryDownloads(queryData.items, queryKey).catch(() => undefined);
  }, [enabled, queryData, queryIsError, queryKey]);

  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => {
      void cleanupTemporaryDownloads(null, queryKey).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [enabled, queryKey]);

  useEffect(() => () => {
    if (preview?.url?.startsWith("blob:")) URL.revokeObjectURL(preview.url);
  }, [preview]);

  useEffect(() => () => {
    for (const entry of selectedFilesRef.current) {
      entry.controller?.abort();
      if (entry.uploadId) void api.cancelUpload(entry.uploadId).catch(() => undefined);
    }
  }, [api]);

  const setPreview = useCallback((next: PreviewState) => setPreviewState(next), []);

  const updateSelected = useCallback((key: string, patch: Partial<SelectedFileEntry>) => {
    replaceSelected((current) => current.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  }, [replaceSelected]);

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
      entries.push({ key: crypto.randomUUID(), file, progress: 0, status: "queued", uploadId: "", controller: null, preparedAt: 0 });
    }
    if (entries.length > 0) replaceSelected((current) => [...current, ...entries]);
    onActivity();
  }, [maxFileBytes, maxSelectedFiles, onActivity, replaceSelected, showToast]);

  const completeUploadWithRetry = useCallback(async (id: string, ttl: number) => {
    let lastError: ApiError | null = null;
    const retryableCodes = new Set(["upload-not-found", "storage-error", "network-error"]);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await api.completeUpload(id, ttl);
      } catch (caught) {
        const error = errorInfo(caught);
        lastError = error;
        if (!retryableCodes.has(error.code) || attempt === 3) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
    throw lastError ?? new ApiError("No fue posible publicar el archivo.");
  }, [api]);

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
        if (error.code === "upload-aborted" || entry.controller?.signal.aborted || !retryable || attempt === 1) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }
    }
    throw lastError ?? new ApiError("No fue posible subir el archivo.");
  }, [api, onActivity, updateSelected]);

  const stageFile = useCallback(async (entry: SelectedFileEntry) => {
    let uploadId = "";
    const controller = new AbortController();
    updateSelected(entry.key, { status: "preparando", progress: 0, controller, uploadId: "", preparedAt: 0 });
    try {
      const initializedAt = Date.now();
      const initialized = await api.initializeUpload(entry.file, ttlMinutes);
      uploadId = initialized.upload.id;
      if (controller.signal.aborted || !selectedFilesRef.current.some((item) => item.key === entry.key)) {
        void api.cancelUpload(uploadId).catch(() => undefined);
        return;
      }
      const active = { ...entry, controller };
      updateSelected(entry.key, { status: "subiendo", uploadId });
      await putWithRetry(active, initialized.upload.uploadUrl, initialized.upload.mimeType || entry.file.type || "application/octet-stream");
      if (controller.signal.aborted || !selectedFilesRef.current.some((item) => item.key === entry.key)) {
        void api.cancelUpload(uploadId).catch(() => undefined);
        return;
      }
      // El objeto ya está en B2, pero sigue privado hasta confirmar la publicación.
      updateSelected(entry.key, { status: "listo", progress: 100, controller: null, preparedAt: initializedAt });
    } catch (caught) {
      const error = errorInfo(caught);
      if (uploadId) void api.cancelUpload(uploadId, error.code !== "upload-aborted").catch(() => undefined);
      if (controller.signal.aborted || error.code === "upload-aborted") {
        replaceSelected((current) => current.filter((item) => item.key !== entry.key));
        return;
      }
      updateSelected(entry.key, { status: "error", controller: null, uploadId: "", preparedAt: 0 });
      showToast(`${entry.file.name}: ${error.message}`, "error");
    }
  }, [api, putWithRetry, replaceSelected, showToast, ttlMinutes, updateSelected]);

  const pumpRef = useRef<() => void>(() => undefined);
  const pumpUploads = useCallback(() => {
    if (!enabled) return;
    const capacity = Math.max(1, uploadConcurrency) - uploadTasks.current.size;
    const queued = selectedFilesRef.current.filter((entry) => entry.status === "queued" && !uploadTasks.current.has(entry.key));
    for (const entry of queued.slice(0, Math.max(0, capacity))) {
      uploadTasks.current.add(entry.key);
      void stageFile(entry).finally(() => {
        uploadTasks.current.delete(entry.key);
        pumpRef.current();
      });
    }
  }, [enabled, stageFile, uploadConcurrency]);
  pumpRef.current = pumpUploads;
  useEffect(() => { pumpUploads(); }, [selectedFiles, pumpUploads]);

  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      onSyncChange("Sin conexión", "offline");
      return;
    }
    await refetch();
  }, [onSyncChange, refetch]);

  const sendText = useCallback(async () => {
    if (sendingRef.current) return;
    if (!text.trim()) {
      showToast("Escribe o pega contenido antes de enviar texto.", "error");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      await api.createText(text, ttlMinutes);
      setText("");
      showToast("Texto disponible en Hopper.", "success");
      await queryClient.invalidateQueries({ queryKey: itemQueryKey });
      onActivity();
    } catch (caught) {
      showToast(errorInfo(caught).message || "No fue posible enviar el texto.", "error");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [api, itemQueryKey, onActivity, queryClient, showToast, text, ttlMinutes]);

  const sendFiles = useCallback(async () => {
    if (sendingRef.current) return;
    const files = selectedFilesRef.current;
    if (!files.length) {
      showToast("Adjunta archivos para enviarlos.", "error");
      return;
    }
    if (files.some((entry) => entry.status !== "listo")) {
      showToast("Espera a que todas las subidas terminen o reintenta los archivos con error.", "error");
      return;
    }
    const stale = files.filter((entry) => !entry.preparedAt || Date.now() - entry.preparedAt > 19 * 60_000);
    if (stale.length > 0) {
      for (const entry of stale) {
        if (entry.uploadId) void api.cancelUpload(entry.uploadId).catch(() => undefined);
        updateSelected(entry.key, { status: "queued", progress: 0, uploadId: "", preparedAt: 0 });
      }
      showToast("Algunos archivos preparados caducaron; se están subiendo de nuevo.", "error");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      const results = await runWithConcurrency(files, uploadConcurrency, async (entry) => {
        updateSelected(entry.key, { status: "confirmando" });
        try {
          await completeUploadWithRetry(entry.uploadId, ttlMinutes);
          return { key: entry.key, ok: true as const };
        } catch (caught) {
          const error = errorInfo(caught);
          if (error.code === "upload-expired") {
            updateSelected(entry.key, { status: "queued", progress: 0, uploadId: "", preparedAt: 0 });
          } else {
            updateSelected(entry.key, { status: "listo" });
          }
          return { key: entry.key, ok: false as const, error };
        }
      });
      const published = new Set(results.filter((result) => result.ok).map((result) => result.key));
      replaceSelected((current) => current.filter((entry) => !published.has(entry.key)));
      const failures = results.filter((result) => !result.ok);
      if (!failures.length) showToast(`${published.size} ${published.size === 1 ? "archivo publicado" : "archivos publicados"}.`, "success");
      else showToast(`${published.size} publicados; ${failures.length} no pudieron publicarse.`, "error");
      if (published.size) await queryClient.invalidateQueries({ queryKey: itemQueryKey });
      onActivity();
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [api, completeUploadWithRetry, itemQueryKey, onActivity, queryClient, replaceSelected, showToast, ttlMinutes, updateSelected, uploadConcurrency]);

  const removeFile = useCallback((key: string) => {
    const entry = selectedFilesRef.current.find((item) => item.key === key);
    entry?.controller?.abort();
    if (entry?.uploadId) void api.cancelUpload(entry.uploadId).catch(() => undefined);
    replaceSelected((current) => current.filter((item) => item.key !== key));
  }, [api, replaceSelected]);

  const retryFile = useCallback(async (key: string) => {
    const entry = selectedFilesRef.current.find((item) => item.key === key);
    if (!entry || entry.status !== "error") return;
    if (entry.uploadId) await api.cancelUpload(entry.uploadId).catch(() => undefined);
    updateSelected(key, { status: "queued", progress: 0, uploadId: "", controller: null, preparedAt: 0 });
  }, [api, updateSelected]);

  const cancelFile = removeFile;

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
      directoryRequest.current += 1;
      setDownloadDirectory(handle);
      setDownloadDirectoryItems(null);
      showToast(`Las descargas de Hopper se guardarán en ${handle.name}.`, "success");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      showToast(errorInfo(caught).message || "No fue posible seleccionar la carpeta.", "error");
    }
  }, [showToast]);

  const disableDirectory = useCallback(async () => {
    await clearDownloadDirectory();
    directoryRequest.current += 1;
    setDownloadDirectory(null);
    setDownloadDirectoryItems(null);
    showToast("Las próximas descargas usarán la carpeta predeterminada del navegador.", "success");
  }, [showToast]);

  const permittedDirectory = useCallback(async () => {
    if (!downloadDirectory) return null;
    try {
      return await ensureDownloadDirectoryPermission(downloadDirectory);
    } catch {
      return null;
    }
  }, [downloadDirectory]);

  const viewDownloadDirectory = useCallback(async () => {
    if (!downloadDirectory) return;
    const requestId = ++directoryRequest.current;
    setDownloadDirectoryItems([]);
    setDownloadDirectoryLoading(true);
    try {
      const directory = await permittedDirectory();
      if (!directory) throw new Error("Concede acceso a la carpeta para consultar sus archivos.");
      const files = await listTemporaryDownloads(directory);
      if (directoryRequest.current === requestId) setDownloadDirectoryItems(files);
    } catch (caught) {
      if (directoryRequest.current === requestId) {
        showToast(errorInfo(caught).message, "error");
        setDownloadDirectoryItems(null);
      }
    } finally {
      if (directoryRequest.current === requestId) setDownloadDirectoryLoading(false);
    }
  }, [downloadDirectory, permittedDirectory, showToast]);

  const closeDownloadDirectory = useCallback(() => {
    directoryRequest.current += 1;
    setDownloadDirectoryItems(null);
    setDownloadDirectoryLoading(false);
  }, []);

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
    if (item.type === "text") {
      const name = `texto-hopper-${item.id.slice(0, 8)}.txt`;
      const blob = new Blob([item.content || ""], { type: "text/plain;charset=utf-8" });
      if (directory) {
        const downloadId = crypto.randomUUID();
        await saveTemporaryDownload(directory, temporaryFileName(name, downloadId), blob, `${queryKey}:text:${downloadId}`, queryKey, [item.id], item.expiresAt);
        showToast(`Texto temporal guardado en ${directory.name}.`, "success");
      } else downloadBlobWithBrowser(name, blob);
      return;
    }
    if (!directory) {
      await triggerSignedDownload(item);
      return;
    }
    const blob = await fetchItemBlob(item);
    const downloadId = crypto.randomUUID();
    await saveTemporaryDownload(directory, temporaryFileName(item.name || "archivo", downloadId), blob, `${queryKey}:file:${downloadId}`, queryKey, [item.id], item.expiresAt);
    showToast(`Archivo temporal guardado en ${directory.name}.`, "success");
  }, [fetchItemBlob, permittedDirectory, queryKey, showToast, triggerSignedDownload]);

  const downloadItems = useCallback(async (items: HopperItem[]) => {
    if (items.length === 0) throw new ApiError("No hay elementos para descargar.");
    if (items.length === 1 && items[0]) {
      await downloadItem(items[0]);
      return;
    }
    setBatchBusy(true);
    try {
      const directory = await permittedDirectory();
      const entries: Array<{ name: string; blob: Blob; modifiedAt: Date }> = [];
      for (const item of items) {
        const isText = item.type === "text";
        const blob = isText ? new Blob([item.content || ""], { type: "text/plain;charset=utf-8" }) : await fetchItemBlob(item);
        entries.push({ name: isText ? `texto-hopper-${item.id.slice(0, 8)}.txt` : item.name || "archivo", blob, modifiedAt: new Date(item.createdAt) });
      }
      const zip = await createZipBlob(entries);
      const name = zipFileName();
      if (directory) {
        const downloadId = crypto.randomUUID();
        const expiresAt = items.map((item) => item.expiresAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
        await saveTemporaryDownload(directory, temporaryFileName(name, downloadId), zip, `${queryKey}:bundle:${downloadId}`, queryKey, items.map((item) => item.id), expiresAt);
      } else downloadBlobWithBrowser(name, zip);
      showToast(`${items.length} elementos empaquetados en ZIP.`, "success");
    } finally {
      setBatchBusy(false);
    }
  }, [downloadItem, fetchItemBlob, permittedDirectory, queryKey, showToast]);

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
    downloadDirectoryItems,
    downloadDirectoryLoading,
    viewDownloadDirectory,
    closeDownloadDirectory,
    maxFileBytes,
    allowTtlReset,
    setText,
    setTtlMinutes,
    setDragging,
    setPreview,
    setDeleteTarget,
    addFiles,
    refresh,
    send: sendText,
    sendText,
    sendFiles,
    retryFile,
    removeFile,
    cancelFile,
    copyItem,
    copyFileItem,
    chooseDownloadDirectory: chooseDirectory,
    disableDownloadDirectory: disableDirectory,
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
