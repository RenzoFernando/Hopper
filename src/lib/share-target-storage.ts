const SHARE_DB = "hopper-share-target-v1";
const STORE_NAME = "payloads";
const PENDING_KEY = "pending";

export type ShareDestination = "personal" | "room";

export type PendingShareDelivery = {
  destination: ShareDestination;
  textId: string;
  fileIds: Record<string, string>;
};

export type SharedPayload = {
  title: string;
  text: string;
  url: string;
  files: File[];
  createdAt: number;
  delivery?: PendingShareDelivery;
};

type StoredSharedFile = {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
};

type StoredSharedPayload = Omit<SharedPayload, "files"> & { files: Array<File | Blob | StoredSharedFile> };

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storedFile(file: File): StoredSharedFile {
  return {
    blob: file,
    name: file.name || "archivo-compartido",
    type: file.type || "application/octet-stream",
    lastModified: Number(file.lastModified) || Date.now()
  };
}

function normalizeFile(value: unknown, index: number) {
  if (value instanceof File) return value;
  if (value instanceof Blob) {
    return new File([value], `archivo-compartido-${index + 1}`, {
      type: value.type || "application/octet-stream",
      lastModified: Date.now()
    });
  }
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<StoredSharedFile>;
  if (!(source.blob instanceof Blob)) return null;
  return new File([source.blob], String(source.name || `archivo-compartido-${index + 1}`), {
    type: String(source.type || source.blob.type || "application/octet-stream"),
    lastModified: Number(source.lastModified) || Date.now()
  });
}

function normalizePayload(value: unknown): SharedPayload | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<StoredSharedPayload>;
  const files = Array.isArray(source.files)
    ? source.files.map((file, index) => normalizeFile(file, index)).filter((file): file is File => Boolean(file))
    : [];
  const delivery = source.delivery && typeof source.delivery === "object"
    ? {
        destination: source.delivery.destination,
        textId: String(source.delivery.textId || ""),
        fileIds: source.delivery.fileIds && typeof source.delivery.fileIds === "object" ? { ...source.delivery.fileIds } : {}
      }
    : undefined;

  if (delivery && delivery.destination !== "personal" && delivery.destination !== "room") return null;

  return {
    title: String(source.title || ""),
    text: String(source.text || ""),
    url: String(source.url || ""),
    files,
    createdAt: Number(source.createdAt || 0),
    ...(delivery ? { delivery } : {})
  };
}

export async function readSharedPayload() {
  const db = await openDb();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(PENDING_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    return normalizePayload(value);
  } finally {
    db.close();
  }
}

export async function writeSharedPayload(value: SharedPayload) {
  const db = await openDb();
  try {
    const stored: StoredSharedPayload = { ...value, files: value.files.map(storedFile) };
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(stored, PENDING_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function clearSharedPayload() {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(PENDING_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
