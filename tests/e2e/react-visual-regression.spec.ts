import { expect, test, type Page } from "@playwright/test";

async function openModern(page: Page, path: string, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.__HOPPER_VISUAL_TEST__ = true;
  });
  await page.goto(path);
  await page.locator("#root").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
}

async function openLegacyShareTarget(page: Page) {
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.route("**/js/**", (route) => route.abort());
  await page.route("**/service-worker.js", (route) => route.abort());
  await page.goto("/share-target.html");
  await page.evaluate(() => document.fonts.ready);
}

async function showWorkspace(page: Page) {
  await page.evaluate(() => {
    const publicScreen = document.querySelector<HTMLElement>("#auth-screen");
    const workspaceScreen = document.querySelector<HTMLElement>("#workspace-screen");
    const publicNav = document.querySelector<HTMLElement>("#public-nav");
    const headerSession = document.querySelector<HTMLElement>("#header-session");
    if (publicScreen) publicScreen.hidden = true;
    if (workspaceScreen) workspaceScreen.hidden = false;
    if (publicNav) publicNav.hidden = true;
    if (headerSession) headerSession.hidden = false;
  });
}

async function setRecentItem(page: Page, kind: "text" | "image" | "audio") {
  await page.evaluate((itemKind) => {
    const emptyState = document.querySelector<HTMLElement>("#empty-state");
    const itemList = document.querySelector<HTMLElement>("#item-list");
    const count = document.querySelector<HTMLElement>("#item-count");
    if (!itemList) return;

    if (emptyState) emptyState.hidden = true;
    itemList.hidden = false;
    if (count) count.textContent = "1";

    const data = {
      text: { title: "Texto", preview: "Texto temporal de referencia para Hopper", meta: "39 caracteres" },
      image: { title: "captura-hopper.png", preview: "PNG · image/png", meta: "284 KB" },
      audio: { title: "nota-de-voz.m4a", preview: "M4A · audio/mp4", meta: "1,8 MB" }
    }[itemKind];
    const marks = {
      text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12M6 9h12M6 13h8M6 17h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>',
      image: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4V20H7zM14 3.5V8h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path></svg>',
      audio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V8a6 6 0 0 1 12 0v8M6 14H4.8A1.8 1.8 0 0 0 3 15.8v2.4A1.8 1.8 0 0 0 4.8 20H7v-6Zm12 0h1.2a1.8 1.8 0 0 1 1.8 1.8v2.4a1.8 1.8 0 0 1-1.8 1.8H17v-6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
    }[itemKind];
    const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>';
    const previewIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12s3.2-5 8.5-5 8.5 5 8.5 5-3.2 5-8.5 5-8.5-5-8.5-5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path><circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"></circle></svg>';
    const downloadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 18v2h14v-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
    const deleteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8v10m4-10v10m4-10v10M5 6h14M9 6V4h6v2m3 0-1 15H7L6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
    const audioRow = itemKind === "audio"
      ? '<div class="audio-row"><button type="button" class="audio-load-button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.5v9l7-4.5-7-4.5Z" fill="currentColor"></path></svg><span>Reproducir audio</span></button><audio controls preload="none" hidden aria-label="Reproductor de nota-de-voz.m4a"></audio></div>'
      : "";
    const itemActions = itemKind === "text"
      ? `<button type="button" class="action-button is-info" aria-label="Copiar" title="Copiar">${copyIcon}</button>`
      : `${itemKind === "image" ? `<button type="button" class="action-button is-info" aria-label="Ver" title="Ver">${previewIcon}</button>` : ""}<button type="button" class="action-button is-info" aria-label="Descargar" title="Descargar">${downloadIcon}</button>`;

    itemList.innerHTML = `
      <article class="item-card">
        <div class="item-main">
          <div class="item-type-mark is-${itemKind === "text" ? "text" : itemKind === "audio" ? "audio" : "file"}">${marks}</div>
          <div class="item-copy">
            <h3 class="item-title">${data.title}</h3>
            <p class="item-preview">${data.preview}</p>
            <div class="item-meta"><span>${data.meta}</span><span>10:30 a. m.</span></div>
            ${audioRow}
          </div>
        </div>
        <div class="item-actions">
          <div class="expiry-controls"><span class="expiry-countdown" aria-label="Tiempo restante">04:32</span><select class="expiry-select" aria-label="Reiniciar tiempo de expiración"><option selected>Tiempo</option><option>5 min</option><option>15 min</option><option>30 min</option><option>1 h</option><option>6 h</option></select></div>
          ${itemActions}
          <button type="button" class="action-button is-danger" aria-label="Eliminar" title="Eliminar">${deleteIcon}</button>
        </div>
      </article>`;
  }, kind);
}

test("React conserva inicio móvil", async ({ page }) => {
  await openModern(page, "/index.html", 390, 844);
  await expect(page).toHaveScreenshot("home-mobile.png", {
    fullPage: true,
    ...(process.platform === "win32" ? { maxDiffPixelRatio: 0.05 } : {})
  });
});

test("React conserva inicio escritorio", async ({ page }) => {
  await openModern(page, "/index.html", 1440, 1000);
  await expect(page).toHaveScreenshot("home-desktop.png", { fullPage: true });
});

test("React conserva Mi espacio", async ({ page }) => {
  await openModern(page, "/index.html");
  await showWorkspace(page);
  await expect(page).toHaveScreenshot("space-empty.png", { fullPage: true });

  await setRecentItem(page, "text");
  await expect(page).toHaveScreenshot("space-text.png", { fullPage: true });

  await setRecentItem(page, "image");
  await expect(page).toHaveScreenshot("space-image.png", { fullPage: true });

  await setRecentItem(page, "audio");
  await expect(page).toHaveScreenshot("space-audio.png", { fullPage: true });
});

test("React conserva selección y progreso", async ({ page }) => {
  await openModern(page, "/index.html");
  await showWorkspace(page);
  await page.evaluate(() => {
    const selected = document.querySelector<HTMLElement>("#selected-files");
    if (!selected) return;
    selected.hidden = false;
    selected.innerHTML = '<div class="selected-file"><div class="selected-file-copy"><span class="selected-file-name">informe.pdf</span><span class="selected-file-size">2,4 MB</span><span class="selected-file-status selected-file-progress-label">Listo para enviar</span></div><button class="remove-file-button" type="button" aria-label="Quitar informe.pdf" title="Quitar"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg></button><div class="file-progress" hidden><span style="width: 0%"></span></div></div>';
  });
  await expect(page).toHaveScreenshot("file-selection.png", { fullPage: true });

  await page.evaluate(() => {
    const status = document.querySelector<HTMLElement>(".selected-file-status");
    const action = document.querySelector<HTMLButtonElement>(".remove-file-button");
    if (status) {
      status.className = "selected-file-status selected-file-progress-label is-info";
      status.textContent = "47% · Subiendo";
    }
    if (action) {
      action.className = "remove-file-button is-cancel";
      action.setAttribute("aria-label", "Cancelar informe.pdf");
      action.setAttribute("title", "Cancelar");
    }
    const progress = document.querySelector<HTMLElement>(".file-progress");
    const bar = progress?.querySelector<HTMLElement>("span");
    if (progress) progress.hidden = false;
    if (bar) bar.style.width = "47%";
  });
  await expect(page).toHaveScreenshot("upload-progress.png", { fullPage: true });
});

test("React conserva salas", async ({ page }) => {
  await openModern(page, "/index.html");
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("#room-created-dialog");
    const code = document.querySelector<HTMLElement>("#room-created-code");
    if (code) code.textContent = "AB-1234";
    dialog?.showModal();
  });
  await expect(page).toHaveScreenshot("room-created.png", { fullPage: true });

  await openModern(page, "/room.html#AB-1234");
  await expect(page).toHaveScreenshot("room-entry.png", { fullPage: true });

  await page.evaluate(() => {
    const access = document.querySelector<HTMLElement>("#room-join-screen");
    const workspace = document.querySelector<HTMLElement>("#workspace-screen");
    const session = document.querySelector<HTMLElement>("#header-session");
    const name = document.querySelector<HTMLElement>("#room-name");
    const expiry = document.querySelector<HTMLElement>("#room-expiry");
    if (access) access.hidden = true;
    if (workspace) workspace.hidden = false;
    if (session) session.hidden = false;
    if (name) name.textContent = "AB-1234";
    if (expiry) expiry.textContent = "04:32";
  });
  await expect(page).toHaveScreenshot("room-active.png", { fullPage: true });
});

test("React conserva administración", async ({ page }) => {
  await openModern(page, "/admin.html", 1440, 1200);
  await expect(page).toHaveScreenshot("admin.png", { fullPage: true });

  await page.evaluate(() => document.querySelector<HTMLDialogElement>("#change-pin-dialog")?.showModal());
  await expect(page).toHaveScreenshot("change-pin.png", { fullPage: true });
});

test("React conserva recuperación", async ({ page }) => {
  await openModern(page, "/recover.html#token=baseline", 900, 900);
  await expect(page).toHaveScreenshot("recover.png", { fullPage: true });
});

test("compatibilidad Share Target conserva estados", async ({ page }) => {
  await openLegacyShareTarget(page);
  await page.evaluate(() => {
    const summary = document.querySelector<HTMLElement>("#share-summary");
    if (summary) summary.innerHTML = '<div class="share-item">captura.png · 284 KB</div>';
  });
  await expect(page).toHaveScreenshot("share-unauthenticated.png", { fullPage: true });

  await page.evaluate(() => {
    const auth = document.querySelector<HTMLElement>("#share-auth");
    const destination = document.querySelector<HTMLSelectElement>("#share-destination");
    if (auth) auth.hidden = true;
    if (destination) destination.innerHTML = '<option>Mi espacio</option><option>Sala AB-1234</option>';
  });
  await expect(page).toHaveScreenshot("share-authenticated.png", { fullPage: true });
});
