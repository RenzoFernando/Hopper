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

function normalizePayload(value: unknown): SharedPayload | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<SharedPayload>;
  const files = Array.isArray(source.files) ? source.files.filter((file): file is File => file instanceof File) : [];
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
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, PENDING_KEY);
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
