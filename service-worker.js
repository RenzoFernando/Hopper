const CACHE_NAME = "hopper-shell";
const SHARE_DB = "hopper-share-target-v1";
const SHELL = [
  "./",
  "./index.html",
  "./room.html",
  "./admin.html",
  "./share-target.html",
  "./recover.html",
  "./manifest.webmanifest",
  "./assets/favicon.svg",
  "./assets/icons/hopper.svg",
  "./assets/icons/hopper-192.png",
  "./assets/icons/hopper-512.png",
  "./css/styles.css",
  "./js/config.js",
  "./js/api.js",
  "./js/transfer-controller.js",
  "./js/app.js",
  "./js/room.js",
  "./js/admin.js",
  "./js/qrcode.js",
  "./js/room-code.js",
  "./js/share-target.js",
  "./js/recover.js"
];

function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("payloads")) {
        request.result.createObjectStore("payloads");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeSharedPayload(payload) {
  const db = await openShareDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("payloads", "readwrite");
    transaction.objectStore("payloads").put(payload, "pending");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function handleShareTarget(request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((value) => value instanceof File && value.size > 0);
  await storeSharedPayload({
    title: String(form.get("title") || ""),
    text: String(form.get("text") || ""),
    url: String(form.get("url") || ""),
    files,
    createdAt: Date.now()
  });
  return Response.redirect(new URL("./share-target.html?received=1", request.url), 303);
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("hopper-shell") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.origin === self.location.origin && url.pathname.endsWith("/share-target.html")) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method !== "GET") {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.includes("/api/") || url.pathname.endsWith("/share-target.html") && url.search) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-cache" }).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return cache.match(event.request) || cache.match("./index.html");
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(event.request, { cache: "no-cache" });

        if (response.ok) {
          cache.put(event.request, response.clone());
        }

        return response;
      } catch {
        return cache.match(event.request);
      }
    })
  );
});
