import { expect, test } from "@playwright/test";

test("las rutas limpias tienen fallback SPA al abrirse directamente", async ({ request }) => {
  for (const path of ["/", "/space", "/admin", "/room/AB-1234", "/recover", "/share"]) {
    const response = await request.get(path, { headers: { Accept: "text/html" } });
    expect(response.status(), path).toBe(200);
    expect(await response.text(), path).toContain('id="root"');
  }
});



test("las rutas desconocidas muestran el 404 de la SPA sin romper el fallback", async ({ page, request }) => {
  const response = await request.get("/ruta-que-no-existe", { headers: { Accept: "text/html" } });
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('id="root"');

  await page.goto("/ruta-que-no-existe");
  await expect(page).toHaveURL(/\/ruta-que-no-existe$/);
  await expect(page.getByRole("heading", { name: "Esto no está en Hopper." })).toBeVisible();
  await expect(page.getByText("RUTA NO ENCONTRADA")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.locator(".not-found-actions").getByRole("link", { name: "Volver a Hopper", exact: true })).toHaveAttribute("href", "/");
});

test("la ruta 404 explícita usa el mismo fallback de la SPA", async ({ page, request }) => {
  const response = await request.get("/404", { headers: { Accept: "text/html" } });
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('id="root"');

  await page.goto("/404");
  await expect(page).toHaveURL(/\/404$/);
  await expect(page.getByRole("heading", { name: "Esto no está en Hopper." })).toBeVisible();
  await expect(page.getByText("RUTA NO ENCONTRADA")).toBeVisible();
});

test("el manifest declara navegación limpia y Share Target POST", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json() as {
    id?: string; start_url?: string; scope?: string; display?: string;
    share_target?: { action?: string; method?: string; enctype?: string; params?: { files?: Array<{ name?: string }> } };
  };
  expect(manifest.id).toBe("/");
  expect(manifest.start_url).toBe("/");
  expect(manifest.scope).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(manifest.share_target?.action).toBe("/share");
  expect(manifest.share_target?.method).toBe("POST");
  expect(manifest.share_target?.enctype).toBe("multipart/form-data");
  expect(manifest.share_target?.params?.files?.[0]?.name).toBe("files");
});

test("el Service Worker controla la SPA y persiste el POST de Share Target", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204 });
    if (path === "/api/security/status") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, locked: false, remainingAttempts: 5 }) });
    if (path === "/api/rooms/capacity") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, active: 0, maximum: 2, available: 2 }) });
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false }) });
  });

  await page.goto("/");
  await expect.poll(() => page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return Boolean(navigator.serviceWorker.controller);
  }), { timeout: 10_000 }).toBe(true);

  await page.evaluate(async () => {
    const form = new FormData();
    form.set("title", "Compartido desde PWA");
    form.set("text", "Contenido pendiente");
    form.append("files", new File(["audio"], "nota.txt", { type: "text/plain" }));
    await fetch("/share", { method: "POST", body: form, redirect: "manual" });
  });

  const stored = await page.evaluate(async () => {
    const request = indexedDB.open("hopper-share-target-v1", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise<{ title?: string; text?: string; files?: File[] } | null>((resolve, reject) => {
      const tx = db.transaction("payloads", "readonly");
      const get = tx.objectStore("payloads").get("pending");
      get.onsuccess = () => resolve((get.result as { title?: string; text?: string; files?: File[] } | undefined) ?? null);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return result ? { title: result.title, text: result.text, fileNames: (result.files || []).map((file) => file.name) } : null;
  });

  expect(stored).toEqual({ title: "Compartido desde PWA", text: "Contenido pendiente", fileNames: ["nota.txt"] });
});

test("la SPA conserva su shell de navegación sin conexión", async ({ page, context }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204 });
    if (path === "/api/security/status") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, locked: false, remainingAttempts: 5 }) });
    if (path === "/api/rooms/capacity") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, active: 0, maximum: 2, available: 2 }) });
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false }) });
  });

  await page.goto("/");
  await expect.poll(() => page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return Boolean(navigator.serviceWorker.controller);
  }), { timeout: 10_000 }).toBe(true);

  await context.setOffline(true);
  try {
    await page.goto("/ruta-offline");
    await expect(page.getByRole("heading", { name: "Esto no está en Hopper." })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
