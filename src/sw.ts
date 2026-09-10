/// <reference lib="webworker" />

export {};

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string | null }>;
};

const CACHE_NAME = "hopper-shell-v3";
const CACHE_PREFIX = "hopper-shell";
const SHARE_DB = "hopper-share-target-v1";
const PRECACHE = self.__WB_MANIFEST;
const SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/assets/favicon.svg",
  "/assets/icons/hopper.svg",
  "/assets/icons/hopper-192.png",
  "/assets/icons/hopper-512.png"
];

function absoluteUrl(path: string) {
  return new URL(path, self.location.origin).toString();
}

function openShareDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("payloads")) request.result.createObjectStore("payloads");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeSharedPayload(payload: unknown) {
  const db = await openShareDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("payloads", "readwrite");
      transaction.objectStore("payloads").put(payload, "pending");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function handleShareTarget(request: Request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  await storeSharedPayload({
    title: String(form.get("title") || ""),
    text: String(form.get("text") || ""),
    url: String(form.get("url") || ""),
    files,
    createdAt: Date.now()
  });
  return Response.redirect(new URL("/share?received=1", request.url), 303);
}

async function cacheResponse(cache: Cache, requestUrl: string, response: Response) {
  if (!response.ok) return;
  await cache.put(absoluteUrl(requestUrl), response.clone());
}

async function warmShell() {
  const cache = await caches.open(CACHE_NAME);
  const precacheUrls = PRECACHE.map((entry) => new URL(entry.url, self.location.origin).pathname);

  await Promise.allSettled(precacheUrls.map(async (url) => {
    const response = await fetch(absoluteUrl(url), { cache: "reload" });
    await cacheResponse(cache, url, response);
  }));

  await Promise.allSettled(SHELL_URLS.map(async (url) => {
    const response = await fetch(absoluteUrl(url), { cache: "reload" });
    await cacheResponse(cache, url, response);
  }));

  const rootResponse = await cache.match(absoluteUrl("/"));
  if (rootResponse) await cache.put(absoluteUrl("/index.html"), rootResponse.clone());
}

self.addEventListener("install", (event) => {
  event.waitUntil(warmShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    event.request.method === "POST"
    && url.origin === self.location.origin
    && (url.pathname === "/share" || url.pathname === "/share-target.html")
  ) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: "no-cache" });
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(absoluteUrl("/index.html"), response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(absoluteUrl("/index.html"))) || (await cache.match(absoluteUrl("/"))) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request, { cache: "no-cache" });
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      return (await cache.match(event.request)) || Response.error();
    }
  })());
});
