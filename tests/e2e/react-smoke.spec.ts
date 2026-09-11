import { expect, test, type Page, type Route } from "@playwright/test";

const nowIso = "2026-09-10T04:00:00.000Z";
const laterIso = "2099-09-10T04:05:00.000Z";
const roomId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const uploadId = "33333333-3333-4333-8333-333333333333";

function room(code = "AB-1234") {
  return {
    id: roomId,
    status: "active",
    version: 1,
    createdAt: nowIso,
    expiresAt: laterIso,
    closedAt: null,
    maxBytes: 104857600,
    maxFileBytes: 104857600,
    maxItems: 20,
    usedBytes: 0,
    itemCount: 0,
    code
  };
}

function textItem(content = "Texto desde React") {
  return {
    id: itemId,
    type: "text",
    status: "ready",
    content,
    createdAt: nowIso,
    expiresAt: laterIso,
    ttlMinutes: 5
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type"
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: corsHeaders,
    body: JSON.stringify(body)
  });
}

async function installApiMock(page: Page) {
  let personalItems: Array<Record<string, unknown>> = [];
  let roomItems: Array<Record<string, unknown>> = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders });
    }

    if (path === "/api/security/status") return json(route, { ok: true, locked: false, remainingAttempts: 5 });
    if (path === "/api/rooms/capacity") return json(route, { ok: true, active: 0, maximum: 2, available: 2 });
    if (path === "/api/auth/login" && method === "POST") return json(route, { ok: true, status: "authorized", remainingAttempts: 5, token: "personal-token", expiresIn: 3600 });
    if (path === "/api/recovery/request" && method === "POST") return json(route, { ok: true, status: "sent" });

    if (path === "/api/items" && method === "GET") return json(route, { ok: true, items: personalItems, serverTime: nowIso });
    if (path === "/api/items/text" && method === "POST") {
      const payload = request.postDataJSON() as { content?: string };
      const item = textItem(payload.content || "");
      personalItems = [item, ...personalItems];
      return json(route, { ok: true, item }, 201);
    }
    if (path === "/api/uploads/init" && method === "POST") return json(route, { ok: true, upload: { id: uploadId, uploadUrl: "https://storage.test/upload", name: "prueba.txt", size: 5, mimeType: "text/plain" } }, 201);
    if (path === `/api/uploads/${uploadId}/complete` && method === "POST") {
      const item = { ...textItem(""), id: uploadId, type: "file" as const, name: "prueba.txt", size: 5, mimeType: "text/plain", previewable: false, audio: false };
      personalItems = [item, ...personalItems];
      return json(route, { ok: true, item });
    }
    if (path === `/api/uploads/${uploadId}/cancel`) return json(route, { ok: true });

    if (path === "/api/rooms" && method === "POST") return json(route, { ok: true, room: room(), code: "AB-1234", token: "room-token", expiresIn: 3600 }, 201);
    if (path === "/api/rooms/join" && method === "POST") return json(route, { ok: true, room: room(), token: "room-token", expiresIn: 3600 });
    if (path === "/api/room/status") return json(route, { ok: true, room: room(), serverTime: nowIso });
    if (path === "/api/room/activity" && method === "POST") return json(route, { ok: true, room: room() });
    if (path === "/api/room/items" && method === "GET") return json(route, { ok: true, items: roomItems, room: room(), serverTime: nowIso });
    if (path === "/api/room/items/text" && method === "POST") {
      const payload = request.postDataJSON() as { content?: string };
      const item = textItem(payload.content || "");
      roomItems = [item, ...roomItems];
      return json(route, { ok: true, item }, 201);
    }

    if (path === "/api/admin/usage") return json(route, {
      ok: true,
      storage: { estimatedBytes: 1024, activeBytes: 1024, orphanBytes: 0, referenceBytes: 10737418240, freeEstimatedBytes: 10737417216, warningBytes: 8589934592, internalLimitBytes: 9663676416, warning: false, blocked: false },
      today: { uploadsCount: 1, uploadBytes: 1024, deletedBytes: 0, failedUploads: 0, cleanupFailures: 0 },
      last7Days: { uploadsCount: 1, uploadBytes: 1024, deletedBytes: 0, failedUploads: 0, cleanupFailures: 0 },
      rooms: { active: 1, maximum: 2 },
      limits: { maxFileBytes: 536870912, storageReferenceBytes: 10737418240, storageWarningBytes: 8589934592, storageInternalLimitBytes: 9663676416, maxRooms: 2, roomMaxTtlMinutes: 5, roomMaxFileBytes: 104857600, roomMaxBytes: 104857600, roomMaxItems: 20, activeItems: 1, pendingUploads: 0, cleanupFailures: 0, orphanItems: 0, missingItems: 0 }
    });
    if (path === "/api/admin/health") return json(route, { ok: true, health: { worker: { ok: true }, d1: { ok: true, latencyMs: 1 }, b2: { ok: true, error: null }, b2Signing: { ok: true }, resend: { ok: true, configured: true }, cleanup: { ok: true, lastCleanupAt: nowIso, failures: 0 }, reconcile: { lastReconcileAt: nowIso, orphanCount: 0, orphanBytes: 0, missingCount: 0 } } });
    if (path === "/api/admin/rooms") return json(route, { ok: true, rooms: [room()] });
    if (path === "/api/admin/cleanup" && method === "POST") return json(route, { ok: true, items: { deleted: 0 } });
    if (path === "/api/admin/reconcile-storage" && method === "POST") return json(route, { ok: true, orphanDeleted: 0 });
    if (path === "/api/admin/statistics" && method === "DELETE") return json(route, { ok: true });
    if (path === "/api/admin/pin" && method === "POST") return json(route, { ok: true, status: "updated" });
    if (path === "/api/admin/reset-system" && method === "POST") return json(route, { ok: true, status: "reset" });
    if (path === `/api/admin/rooms/${roomId}/session` && method === "POST") return json(route, { ok: true, room: room(), token: "room-token", expiresIn: 3600 });

    if (path === "/api/recovery/verify" && method === "POST") return json(route, { ok: true, status: "valid" });
    if (path === "/api/recovery/reset" && method === "POST") return json(route, { ok: true, status: "updated" });

    return json(route, { ok: false, code: "unmocked", message: `${method} ${path}` }, 500);
  });

  await page.route("https://storage.test/**", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders });
    }
    return route.fulfill({ status: 200, headers: corsHeaders, body: "" });
  });
}

async function seedPersonalSession(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("hopper-session-v1", JSON.stringify({ token: "personal-token", expiresAt: Date.now() + 3_600_000 }));
  });
}

test("login, texto, archivo y logout funcionan en React", async ({ page }) => {
  await installApiMock(page);
  await page.goto("/");
  await page.locator("#pin-input").fill("1234");
  await expect(page).toHaveURL(/\/space$/);
  await expect(page.locator("#workspace-screen")).toBeVisible();

  await page.locator("#text-input").fill("Texto desde React");
  await page.locator("#send-button").click();
  await expect(page.locator("#item-list")).toContainText("Texto desde React");

  await page.locator("#file-input").setInputFiles({ name: "prueba.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
  await page.locator("#send-button").click();
  await expect(page.locator("#item-list")).toContainText("prueba.txt");

  await page.locator("#logout-button").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#auth-screen")).toBeVisible();
});

test("crear y entrar a una sala conserva el flujo legado", async ({ page }) => {
  await installApiMock(page);
  await page.goto("/");
  await expect(page.locator("#public-create-room")).toBeEnabled();
  await page.locator("#public-create-room").click();
  await expect(page.locator("#room-created-dialog")).toBeVisible();
  await expect(page.locator("#room-created-code")).toHaveText("AB-1234");
  await page.locator("#room-created-close").click();

  await page.locator("#public-room-code").fill("ab1234");
  await page.locator("#public-room-join").click();
  await expect(page).toHaveURL(/\/room\/AB-1234$/);
  await expect(page.locator("#workspace-screen")).toBeVisible();
  await expect(page.locator("#room-name")).toHaveText("AB-1234");

  await page.locator("#text-input").fill("Texto en sala");
  await page.locator("#send-button").click();
  await expect(page.locator("#item-list")).toContainText("Texto en sala");
});

test("Administración carga datos y ejecuta mantenimiento", async ({ page }) => {
  await seedPersonalSession(page);
  await installApiMock(page);
  await page.goto("/admin");
  await expect(page.locator("#usage-storage")).not.toHaveText("—");
  await expect(page.locator("#admin-room-count")).toHaveText("1 / 2");

  await page.locator("#cleanup-button").click();
  await expect(page.locator("#toast-region")).toContainText("Limpieza completada");

  await page.locator("#delete-stats-button").click();
  await expect(page.locator("#admin-reauth-dialog")).toBeVisible();
  await page.locator("#admin-reauth-pin").fill("1234");
  const statisticsRequest = page.waitForRequest((request) => request.url().endsWith("/api/admin/statistics") && request.method() === "DELETE");
  await page.locator("#admin-reauth-submit").click();
  const deleteRequest = await statisticsRequest;
  expect(deleteRequest.postDataJSON()).toEqual({ currentPin: "1234", confirmation: "DELETE_STATISTICS" });

  await page.locator("#change-pin-button").click();
  await expect(page.locator("#change-pin-dialog")).toBeVisible();
  await page.locator("#change-pin-current").fill("1234");
  await page.locator("#change-pin-new").fill("4321");
  await page.locator("#change-pin-confirm").fill("4321");
  const pinRequest = page.waitForRequest((request) => request.url().endsWith("/api/admin/pin") && request.method() === "POST");
  await page.locator("#change-pin-submit").click();
  const request = await pinRequest;
  expect(request.postDataJSON()).toEqual({ currentPin: "1234", pin: "4321", confirmation: "4321" });
  await expect(page).toHaveURL(/\/$/);
});

test("recuperación verifica, limpia el hash y actualiza el PIN", async ({ page }) => {
  await installApiMock(page);
  await page.goto("/recover#token-de-prueba");
  await expect(page).toHaveURL(/\/recover$/);
  await expect(page.locator("#recovery-form")).toBeVisible();
  await page.locator("#new-pin").fill("2468");
  await page.locator("#confirm-pin").fill("2468");
  await page.locator("#recovery-submit").click();
  await expect(page.locator("#recovery-result-title")).toHaveText("PIN actualizado");
});




test("los enlaces de navegación cambian también la pantalla y los textos HTTP(S) se abren como enlaces", async ({ page }) => {
  await seedPersonalSession(page);
  await installApiMock(page);
  await page.goto("/space");
  await expect(page.locator("#workspace-screen")).toBeVisible();

  await page.getByRole("link", { name: "Administración", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Administración", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Mi espacio", exact: true }).click();
  await expect(page).toHaveURL(/\/space$/);
  await expect(page.locator("#workspace-screen")).toBeVisible();

  await page.locator("#text-input").fill("Documentación https://example.com/hopper.");
  await page.locator("#send-button").click();
  const item = page.locator("#item-list .item-card").filter({ hasText: "Documentación" }).first();
  await expect(item.getByRole("link", { name: "https://example.com/hopper" })).toHaveAttribute("href", "https://example.com/hopper");
  await expect(item.getByRole("link", { name: "Abrir enlace" })).toHaveAttribute("href", "https://example.com/hopper");
});


test("Share Target React confirma y limpia el payload antes de navegar", async ({ page }) => {
  await seedPersonalSession(page);
  await installApiMock(page);
  await page.goto("/share");

  await page.evaluate(async () => {
    const request = indexedDB.open("hopper-share-target-v1", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("payloads")) request.result.createObjectStore("payloads");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("payloads", "readwrite");
      tx.objectStore("payloads").put({
        title: "Desde Android",
        text: "Texto compartido",
        url: "",
        files: [new File(["hola"], "prueba.txt", { type: "text/plain" })],
        createdAt: Date.now()
      }, "pending");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  await page.reload();
  await expect(page.locator("#share-summary")).toContainText("Texto");
  await expect(page.locator("#share-summary")).toContainText("prueba.txt");
  await page.locator("#share-send").click();
  await expect(page.locator("#share-message")).toHaveText("Contenido enviado y confirmado.");
  await expect(page).toHaveURL(/\/space$/);

  const pending = await page.evaluate(async () => {
    const request = indexedDB.open("hopper-share-target-v1", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction("payloads", "readonly");
      const get = tx.objectStore("payloads").get("pending");
      get.onsuccess = () => resolve(get.result ?? null);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return value;
  });
  expect(pending).toBeNull();
});