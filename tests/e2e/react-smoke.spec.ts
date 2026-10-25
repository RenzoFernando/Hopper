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
    maxBytes: 536870912,
    maxFileBytes: 268435456,
    maxItems: 25,
    usedBytes: 0,
    itemCount: 0,
    lastActivityAt: nowIso,
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
    if (path === "/api/rooms/capacity") return json(route, { ok: true, active: 0, maximum: 3, available: 3 });
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
      const item = { ...textItem(payload.content || ""), ttlMinutes: 10 };
      roomItems = [item, ...roomItems];
      return json(route, { ok: true, item }, 201);
    }

    if (path === "/api/admin/usage") return json(route, {
      ok: true,
      storage: { estimatedBytes: 1024, activeBytes: 1024, orphanBytes: 0, referenceBytes: 10737418240, freeEstimatedBytes: 10737417216, warningBytes: 8589934592, internalLimitBytes: 9663676416, warning: false, blocked: false },
      today: { uploadsCount: 1, uploadBytes: 1024, deletedBytes: 0, failedUploads: 0, cleanupFailures: 0 },
      last7Days: { uploadsCount: 1, uploadBytes: 1024, deletedBytes: 0, failedUploads: 0, cleanupFailures: 0 },
      rooms: { active: 1, maximum: 3 },
      limits: { maxFileBytes: 536870912, storageReferenceBytes: 10737418240, storageWarningBytes: 8589934592, storageInternalLimitBytes: 9663676416, maxRooms: 3, roomMaxTtlMinutes: 10, roomLifetimeMinutes: 10, roomInactivityMinutes: 5, roomMaxFileBytes: 268435456, roomMaxBytes: 536870912, roomMaxItems: 25, activeItems: 1, pendingUploads: 0, cleanupFailures: 0, orphanItems: 0, missingItems: 0 }
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
    localStorage.setItem("hopper-session-v1", JSON.stringify({ token: "personal-token", expiresAt: Date.now() + 3_600_000 }));
  });
}

test("login, texto, archivo y logout funcionan en React", async ({ page }) => {
  await installApiMock(page);
  await page.goto("/");
  await page.locator("#pin-input").fill("1234");
  await expect(page).toHaveURL(/\/space$/);
  await expect(page.locator("#workspace-screen")).toBeVisible();
  await expect(page.locator("#ttl-select option")).toHaveText(["5 min", "15 min", "30 min", "1 hora", "6 horas", "12 horas", "1 día", "Anclado"]);

  await page.locator("#text-input").fill("Texto desde React");
  await page.locator("#send-button").click();
  await expect(page.locator("#item-list")).toContainText("Texto desde React");

  await page.locator("#file-input").setInputFiles({ name: "prueba.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
  await expect(page.locator(".selected-file-status")).toContainText("100% · Preparado");
  await expect(page.locator("#item-list")).not.toContainText("prueba.txt");
  await page.locator("#ttl-select").selectOption("15");
  const completionRequest = page.waitForRequest((request) => request.url().includes(`/api/uploads/${uploadId}/complete`) && request.method() === "POST");
  await page.locator("#send-files-button").click();
  expect((await completionRequest).postDataJSON()).toEqual({ ttlMinutes: 15 });
  await expect(page.locator("#item-list")).toContainText("prueba.txt");
  await expect(page.getByRole("heading", { name: "Bandeja" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Descargar TXT" })).toBeVisible();

  await page.locator("#logout-button").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#auth-screen")).toBeVisible();
});


test("los textos admiten selección y descarga como TXT", async ({ page }) => {
  await seedPersonalSession(page);
  await installApiMock(page);
  await page.goto("/space");
  await page.locator("#text-input").fill("Contenido temporal de prueba");
  await page.locator("#send-button").click();
  await expect(page.locator("#item-list")).toContainText("Contenido temporal de prueba");
  await page.locator(".bulk-select-all input").check();
  await expect(page.getByRole("button", { name: /Descargar selección \(1\)/ })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar TXT" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.txt$/);
});

test("el compositor prioriza archivos y mantiene controles iconográficos accesibles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedPersonalSession(page);
  await installApiMock(page);
  await page.goto("/space");
  // Las pantallas privadas se cargan bajo demanda: esperar el montaje antes de medirlas.
  await expect(page.locator("#text-input")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".compose-text")).toBeVisible();
  await expect(page.locator(".compose-files")).toBeVisible();
  const widths = await page.evaluate(() => {
    const text = document.querySelector<HTMLElement>(".compose-text");
    const files = document.querySelector<HTMLElement>(".compose-files");
    const input = document.querySelector<HTMLTextAreaElement>("#text-input");
    if (!text || !files || !input) {
      throw new Error("El compositor no está montado: no se puede medir su distribución.");
    }
    return {
      text: text.getBoundingClientRect().width,
      files: files.getBoundingClientRect().width,
      resize: getComputedStyle(input).resize
    };
  });
  expect(widths.text / (widths.text + widths.files)).toBeGreaterThan(0.32);
  expect(widths.text / (widths.text + widths.files)).toBeLessThan(0.35);
  expect(widths.resize).toBe("none");
  await expect(page.getByRole("button", { name: "Enviar texto" })).toBeVisible();
  await page.locator("#text-input").fill("Control de tiempo");
  await page.locator("#send-button").click();
  await expect(page.locator(".expiry-countdown svg")).toBeVisible();
  await expect(page.getByLabel("Editar tiempo de expiración")).toBeVisible();
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
  await expect(page.locator("#admin-room-count")).toHaveText("1 / 3");
  await expect(page.getByRole("link", { name: "Mi espacio", exact: true })).toHaveAttribute("href", "/space");
  await expect(page.locator("#admin-logout-button")).toBeVisible();

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


test("Administración permite cerrar la sesión directamente", async ({ page }) => {
  await seedPersonalSession(page);
  await installApiMock(page);
  await page.goto("/admin");
  await page.locator("#admin-logout-button").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#auth-screen")).toBeVisible();
  const session = await page.evaluate(() => localStorage.getItem("hopper-session-v1"));
  expect(session).toBeNull();
});

test("carga exclusiva no ofrece borrado si el Worker aún no tiene la ruta", async ({ page }) => {
  await seedPersonalSession(page);
  await installApiMock(page);
  await page.route("**/api/admin/super/status", (route) => json(route, { ok: false, code: "not-found", message: "Ruta no encontrada." }, 404));
  await page.goto("/admin/super");
  await expect(page.getByRole("heading", { name: "Supercarga" })).toBeVisible();
  await expect(page.getByText("La API de supercarga no está desplegada.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vaciar y activar" })).toHaveCount(0);
  await expect(page.getByText("No disponible", { exact: true })).toBeVisible();
});

test("carga exclusiva permite ver la preparación solo con API comprobada", async ({ page }) => {
  await seedPersonalSession(page);
  await installApiMock(page);
  await page.route("**/api/admin/super/status", (route) => json(route, {
    ok: true, active: false, status: "inactive", expiresAt: null,
    limitBytes: 10 * 1024 * 1024 * 1024, files: []
  }));
  await page.goto("/admin/super");
  await expect(page.getByText("Inactiva", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vaciar y activar" })).toBeDisabled();
  await expect(page.getByRole("option", { name: "12 horas" })).toHaveCount(1);
});

test("Supercarga comparte el checkbox visual y evita recargas completas al navegar", async ({ page }) => {
  await seedPersonalSession(page);
  await installApiMock(page);
  await page.route("**/api/admin/super/status", route => json(route, {
    ok: true, active: false, status: "inactive", expiresAt: null, limitBytes: 10_000_000_000, files: []
  }));
  await page.goto("/admin/super");
  const checkbox = page.locator(".super-confirm input[type=checkbox]");
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toHaveCSS("appearance", "none");
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(page.getByText("Inactiva", { exact: true })).toBeVisible();

  await page.evaluate(() => { (window as typeof window & { __hopperNavMarker?: boolean }).__hopperNavMarker = true; });
  await page.getByRole("link", { name: "Mi espacio" }).click();
  await expect(page).toHaveURL(/\/space$/);
  expect(await page.evaluate(() => (window as typeof window & { __hopperNavMarker?: boolean }).__hopperNavMarker)).toBe(true);
});

test("Supercarga renueva duración y descarga sin abrir pestaña vacía", async ({ page, context }) => {
  await seedPersonalSession(page);
  await installApiMock(page);
  let expiresAt = "2099-09-10T04:05:00.000Z";
  const files = [{ id: uploadId, name: "prueba.zip", size: 1024, status: "ready", mime_type: "application/zip", created_at: nowIso }];
  await page.route("**/api/admin/super/status", route => json(route, {
    ok: true, active: true, status: "active", expiresAt,
    limitBytes: 10_000_000_000, files
  }));
  await page.route("**/api/admin/super/extend", route => {
    expect(route.request().postDataJSON().durationMinutes).toBe(720);
    expiresAt = "2099-09-10T12:05:00.000Z";
    return json(route, { ok: true, active: true, status: "active", expiresAt, limitBytes: 10_000_000_000 });
  });
  await page.route(`**/api/admin/super/uploads/${uploadId}/url`, route => json(route, { ok: true, url: "https://storage.test/archivo.zip", name: "prueba.zip" }));
  await page.goto("/admin/super");
  await expect(page.getByRole("heading", { name: "Supercarga" })).toBeVisible();
  await expect(page.getByText("10 GB en total")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Porcentaje de capacidad ocupada" })).toHaveCount(1);
  await page.getByLabel("Nuevo tiempo").selectOption("720");
  await page.getByRole("button", { name: "Actualizar tiempo" }).click();
  await expect(page.getByText("Duración actualizada.")).toBeVisible();
  const before = context.pages().length;
  await page.getByRole("button", { name: "Descargar" }).click();
  await expect(page.locator('iframe[src="https://storage.test/archivo.zip"]')).toHaveCount(1);
  expect(context.pages().length).toBe(before);
  await page.getByLabel("PIN actual").fill("1234");
  await page.getByRole("button", { name: "Finalizar y liberar" }).first().click();
  await expect(page.getByRole("dialog", { name: "Finalizar Supercarga" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Supercarga inicia sesión automáticamente al completar los cuatro dígitos", async ({ page }) => {
  await installApiMock(page);
  await page.route("**/api/admin/super/status", route => json(route, {
    ok: true, active: false, status: "inactive", expiresAt: null,
    limitBytes: 10_000_000_000, files: []
  }));
  await page.goto("/admin/super");
  await expect(page.getByLabel("PIN", { exact: true })).toBeVisible();
  await page.locator("#super-login-pin").fill("1234");
  await expect(page.getByText("Inactiva", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar" })).toHaveCount(0);
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

  // La navegación debe conservar la SPA y terminar de montar la ruta lazy.
  await page.evaluate(() => { (window as typeof window & { __hopperNavMarker?: string }).__hopperNavMarker = "spa"; });
  await page.getByRole("link", { name: "Administración", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator("main.admin-main")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Administración", exact: true })).toBeVisible();
  await expect(page.locator("#workspace-screen")).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { __hopperNavMarker?: string }).__hopperNavMarker)).toBe("spa");

  await page.getByRole("link", { name: "Mi espacio", exact: true }).click();
  await expect(page).toHaveURL(/\/space$/);
  await expect(page.locator("#workspace-screen")).toBeVisible();
  await expect(page.locator("main.admin-main")).toHaveCount(0);

  // Repetir la transición para detectar bucles de renders del estado de sincronización.
  await page.getByRole("link", { name: "Administración", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Administración", exact: true })).toBeVisible();
  await expect(page.locator("#workspace-screen")).toHaveCount(0);
  await page.getByRole("link", { name: "Mi espacio", exact: true }).click();
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
  await expect(page).toHaveURL(/\/space$/);
  await expect(page.locator("#workspace-screen")).toBeVisible();
  await expect(page.locator("#item-list")).toContainText("Texto compartido");
  await expect(page.locator("#item-list")).toContainText("prueba.txt");

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

test("Share Target envía automáticamente al completar el PIN", async ({ page }) => {
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
      tx.objectStore("payloads").put({ title: "", text: "Desde compartir", url: "", files: [], createdAt: Date.now() }, "pending");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  await page.reload();
  await page.locator("#share-pin").fill("1234");
  await expect(page).toHaveURL(/\/space$/);
});

test("Share Target puede crear una sala y enviar sin perder el payload", async ({ page }) => {
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
      tx.objectStore("payloads").put({ title: "", text: "A sala nueva", url: "", files: [], createdAt: Date.now() }, "pending");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  await page.reload();
  await page.locator("#share-create-room").click();
  await expect(page).toHaveURL(/\/room\/AB-1234$/);
});


test("PWA móvil conserva títulos de igual jerarquía y botones compactos", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(() => { window.__HOPPER_VISUAL_TEST__ = true; });
  await page.goto("/space");
  await expect(page.getByRole("heading", {name:"Enviar",exact:true})).toBeVisible();
  await expect(page.getByRole("heading", {name:"Bandeja",exact:true})).toBeVisible();
  const sizes=await page.evaluate(()=>({send:getComputedStyle(document.querySelector(".composer-heading h1")!).fontSize,inbox:getComputedStyle(document.querySelector(".recent-header h2")!).fontSize,caption:getComputedStyle(document.querySelector("#send-files-button .send-caption")!).display}));
  expect(sizes.send).toBe(sizes.inbox);
  expect(sizes.caption).toBe("none");
  await expect(page.getByRole("button",{name:"Enviar archivos"})).toBeVisible();
});

test("Administración expone el acceso a Supercarga", async ({page})=>{
  await page.addInitScript(() => { window.__HOPPER_VISUAL_TEST__ = true; });
  await page.goto("/admin");
  await expect(page.getByText("Supercarga",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Abrir",exact:true}).click();
  await expect(page).toHaveURL(/\/admin\/super$/);
  await expect(page.getByRole("heading",{name:"Supercarga",exact:true})).toBeVisible();
});
