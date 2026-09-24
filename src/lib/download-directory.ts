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
  queryPermission?: (descriptor: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (descriptor: PermissionMode) => Promise<PermissionState>;
};

type DirectoryWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<HopperDirectoryHandle>;
};

const DB_NAME = "hopper-downloads-v1";
const STORE_NAME = "settings";
const DIRECTORY_KEY = "download-directory";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
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
