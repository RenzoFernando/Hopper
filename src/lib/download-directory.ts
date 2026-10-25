type PermissionState = "denied" | "granted" | "prompt";
type PermissionMode = { mode: "readwrite" };

type HopperWritable = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
};

export type HopperFileSystemFileHandle = {
  kind: "file";
  name: string;
  createWritable: () => Promise<HopperWritable>;
};

export type HopperDirectoryHandle = {
  kind: "directory";
  name: string;
  getFileHandle: (name: string, options: { create: boolean }) => Promise<HopperFileSystemFileHandle>;
  isSameEntry?: (other: HopperDirectoryHandle) => Promise<boolean>;
  removeEntry?: (name: string) => Promise<void>;
  queryPermission?: (descriptor: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (descriptor: PermissionMode) => Promise<PermissionState>;
};

type DirectoryWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; startIn?: HopperDirectoryHandle }) => Promise<HopperDirectoryHandle>;
};

const DB_NAME = "hopper-downloads-v1";
const STORE_NAME = "settings";
const DIRECTORY_KEY = "download-directory";
const TEMPORARY_STORE = "temporary-files";

type TemporaryDownload = {
  id: string;
  scope: string;
  itemIds: string[];
  expiresAt: string | null;
  name: string;
  directory: HopperDirectoryHandle;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      if (!request.result.objectStoreNames.contains(TEMPORARY_STORE)) request.result.createObjectStore(TEMPORARY_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No fue posible abrir la configuración local de descargas."));
  });
}

export function supportsDownloadDirectory() {
  return typeof window !== "undefined" && typeof (window as DirectoryWindow).showDirectoryPicker === "function" && typeof indexedDB !== "undefined";
}

export async function loadDownloadDirectory(): Promise<HopperDirectoryHandle | null> {
  if (!supportsDownloadDirectory()) return null;
  const db = await openDatabase();
  try {
    return await new Promise<HopperDirectoryHandle | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(DIRECTORY_KEY);
      request.onsuccess = () => resolve((request.result as HopperDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("No fue posible leer la carpeta de descargas."));
    });
  } finally {
    db.close();
  }
}

async function storeDownloadDirectory(handle: HopperDirectoryHandle) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(handle, DIRECTORY_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("No fue posible guardar la carpeta de descargas."));
    });
  } finally {
    db.close();
  }
}

export async function chooseDownloadDirectory() {
  if (!supportsDownloadDirectory()) throw new Error("Este navegador no permite elegir una carpeta permanente para Hopper.");
  const picker = (window as DirectoryWindow).showDirectoryPicker;
  if (!picker) throw new Error("Este navegador no permite elegir una carpeta permanente para Hopper.");
  const handle = await picker({ mode: "readwrite" });
  await storeDownloadDirectory(handle);
  return handle;
}

export async function ensureDownloadDirectoryPermission(handle: HopperDirectoryHandle | null) {
  if (!handle) return null;
  const descriptor = { mode: "readwrite" } as const;
  const current = await handle.queryPermission?.(descriptor);
  if (current === "granted" || current === undefined) return handle;
  if (current === "denied") return null;
  const requested = await handle.requestPermission?.(descriptor);
  return requested === "granted" ? handle : null;
}

function safeFileName(name: string) {
  const cleaned = String(name || "archivo")
      .replace(/[<>:"/\\|?*]/g, "_")
      .split("")
      .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
      .join("")
      .replace(/[. ]+$/g, "")
      .trim();
  return cleaned || "archivo";
}

export async function saveBlobToDirectory(handle: HopperDirectoryHandle, name: string, blob: Blob) {
  const fileHandle = await handle.getFileHandle(safeFileName(name), { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

export function downloadBlobWithBrowser(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFileName(name);
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function clearDownloadDirectory(): Promise<void> {
  if (!supportsDownloadDirectory()) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(DIRECTORY_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("No fue posible restaurar las descargas predeterminadas."));
    });
  } finally {
    db.close();
  }
}

// Los nombres asociados al identificador impiden sobrescribir documentos ajenos a Hopper.
export function temporaryFileName(name: string, id: string): string {
  const sanitized = safeFileName(name);
  const dot = sanitized.lastIndexOf(".");
  const stem = dot > 0 ? sanitized.slice(0, dot) : sanitized;
  const extension = dot > 0 ? sanitized.slice(dot) : "";
  return safeFileName(`${stem} (hopper-${id.slice(0, 12)})${extension}`);
}

export async function saveTemporaryDownload(
  directory: HopperDirectoryHandle,
  name: string,
  blob: Blob,
  id: string,
  scope: string,
  itemIds: string[],
  expiresAt: string | null
): Promise<void> {
  if (!directory.removeEntry) throw new Error("Esta carpeta no admite la limpieza automática de archivos temporales.");
  // El registro local se crea únicamente después de guardar correctamente el archivo.
  await saveBlobToDirectory(directory, name, blob);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(TEMPORARY_STORE, "readwrite");
      const entry: TemporaryDownload = { id, scope, itemIds, expiresAt, name, directory };
      transaction.objectStore(TEMPORARY_STORE).put(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("No fue posible registrar el archivo temporal."));
    });
  } finally {
    db.close();
  }
}


export type TemporaryDownloadInfo = { id: string; name: string; expiresAt: string | null };

export async function listTemporaryDownloads(directory: HopperDirectoryHandle): Promise<TemporaryDownloadInfo[]> {
  if (!directory.isSameEntry) throw new Error("El navegador no permite consultar esta carpeta.");
  const db = await openDatabase();
  try {
    const entries = await new Promise<TemporaryDownload[]>((resolve, reject) => {
      const transaction = db.transaction(TEMPORARY_STORE, "readonly");
      const request = transaction.objectStore(TEMPORARY_STORE).getAll();
      request.onsuccess = () => resolve(request.result as TemporaryDownload[]);
      request.onerror = () => reject(request.error ?? new Error("No fue posible consultar las descargas temporales."));
    });
    const found: TemporaryDownloadInfo[] = [];
    for (const entry of entries) {
      if (!(await directory.isSameEntry(entry.directory))) continue;
      try {
        // Solo se muestran los archivos registrados por Hopper que aún existen.
        await directory.getFileHandle(entry.name, { create: false });
        found.push({ id: entry.id, name: entry.name, expiresAt: entry.expiresAt });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      }
    }
    return found.reverse();
  } finally {
    db.close();
  }
}

export function browseDownloadDirectory(directory: HopperDirectoryHandle) {
  const picker = (window as DirectoryWindow).showDirectoryPicker;
  if (!picker) throw new Error("Este navegador no permite examinar carpetas.");
  // El selector se abre en la carpeta guardada, sin cambiar la carpeta activa.
  return picker({ mode: "read", startIn: directory });
}

let cleanupInProgress = false;

export async function cleanupTemporaryDownloads(activeItems: Array<{ id: string; expiresAt: string | null }> | null, scope: string, now = Date.now()): Promise<void> {
  if (!supportsDownloadDirectory() || cleanupInProgress) return;
  cleanupInProgress = true;
  try {
    const db = await openDatabase();
    try {
      const entries = await new Promise<TemporaryDownload[]>((resolve, reject) => {
        const transaction = db.transaction(TEMPORARY_STORE, "readonly");
        const request = transaction.objectStore(TEMPORARY_STORE).getAll();
        request.onsuccess = () => resolve(request.result as TemporaryDownload[]);
        request.onerror = () => reject(request.error ?? new Error("No fue posible comprobar las descargas temporales."));
      });
      const active = activeItems === null ? null : new Map(activeItems.map((item) => [item.id, item.expiresAt]));
      for (const entry of entries) {
        const missing = active !== null && entry.scope === scope && activeItems!.length < 100 && entry.itemIds.some((id) => !active.has(id));
        const expiry = active !== null && entry.scope === scope && entry.itemIds.every((id) => active.has(id))
          ? entry.itemIds.map((id) => active.get(id)).filter((value): value is string => Boolean(value)).sort()[0] ?? null
          : entry.expiresAt;
        const expired = expiry !== null && Date.parse(expiry) <= now;
        if (!expired && !missing) continue;
        if (!entry.directory.removeEntry) continue;
        // No solicitamos permisos de forma automática: el navegador exige interacción del usuario.
        try {
          if (entry.directory.queryPermission && (await entry.directory.queryPermission({ mode: "readwrite" })) !== "granted") continue;
        } catch {
          continue;
        }
        try {
          await entry.directory.removeEntry(entry.name);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "NotFoundError")) continue;
        }
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(TEMPORARY_STORE, "readwrite");
          transaction.objectStore(TEMPORARY_STORE).delete(entry.id);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error("No fue posible actualizar la limpieza temporal."));
        });
      }
    } finally {
      db.close();
    }
  } finally {
    cleanupInProgress = false;
  }
}
