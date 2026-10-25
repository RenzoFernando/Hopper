"use strict";

const APP_URL = "https://hopper-transfer.pages.dev/";
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const CHUNK_SIZE = 128 * 1024;
const byId = (id) => document.getElementById(id);
let hopperTabId = null;
let files = [];
let working = false;

function showMessage(message, success = false) {
  const element = byId("message");
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("is-success", success);
}

function setConnection(connected) {
  byId("status-dot").classList.toggle("is-ready", connected);
  byId("connection-label").textContent = connected ? "Conectado" : "Sin sesión";
  byId("workspace").hidden = !connected;
  byId("login-panel").hidden = connected;
}

async function ensureTab() {
  if (hopperTabId !== null) {
    const found = await chrome.tabs.get(hopperTabId).catch(() => null);
    if (found && found.url?.startsWith(APP_URL)) return hopperTabId;
  }
  const open = await chrome.tabs.query({ url: "https://hopper-transfer.pages.dev/*" });
  let tab = open.find((candidate) => candidate.status === "complete") || open[0];
  if (!tab) tab = await chrome.tabs.create({ url: `${APP_URL}space`, active: false });
  if (typeof tab.id !== "number") throw new Error("No fue posible abrir la sesión de Hopper.");
  hopperTabId = tab.id;
  if (tab.status !== "complete") {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("Hopper no respondió al abrirse.")); }, 18000);
      const listener = (tabId, info) => {
        if (tabId !== hopperTabId || info.status !== "complete") return;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  return hopperTabId;
}

async function bridge(action, payload = {}) {
  const tabId = await ensureTab();
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "hopper-extension", action, payload });
    if (!response?.ok) throw new Error(response?.message || "Hopper no respondió a la extensión.");
    return response;
  } catch (error) {
    if (/Receiving end does not exist|message port closed/i.test(String(error))) {
      throw new Error("Recarga la pestaña de Hopper, vuelve a iniciar sesión y abre la extensión.");
    }
    throw error;
  }
}

async function openHopper() {
  const tabId = await ensureTab();
  await chrome.tabs.update(tabId, { active: true, url: `${APP_URL}space` });
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
}

function updatePublishButton() {
  byId("publish").disabled = working || files.length === 0 || files.some((file) => file.status !== "Preparado");
}

function drawQueue() {
  const container = byId("queue");
  container.replaceChildren();
  for (const file of files) {
    const row = document.createElement("div");
    row.className = "queue-item";
    const copy = document.createElement("div");
    copy.className = "queue-copy";
    const name = document.createElement("span");
    name.className = "queue-name";
    name.textContent = file.name;
    name.title = file.name;
    const state = document.createElement("span");
    state.className = "queue-state";
    state.textContent = `${(file.size / 1048576).toFixed(2)} MB · ${file.progress || 0}% · ${file.status}`;
    copy.append(name, state);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "queue-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Quitar ${file.name}`);
    remove.title = `Quitar ${file.name}`;
    remove.addEventListener("click", async () => {
      try {
        await bridge("remove", { key: file.key });
        files = files.filter((entry) => entry.key !== file.key);
        drawQueue();
      } catch (error) { showMessage(String(error.message || error)); }
    });
    const progress = document.createElement("div");
    progress.className = "progress";
    const bar = document.createElement("span");
    bar.style.width = `${Math.max(0, Math.min(100, file.progress || 0))}%`;
    progress.append(bar);
    row.append(copy, remove, progress);
    container.append(row);
  }
  updatePublishButton();
}

async function syncStatus() {
  const status = await bridge("status");
  setConnection(Boolean(status.authorized));
  files = status.files || [];
  drawQueue();
}

async function sendText() {
  const textarea = byId("content");
  const content = textarea.value.trim();
  if (!content) return showMessage("Escribe o pega algo antes de enviarlo.");
  byId("send-text").disabled = true;
  try {
    await bridge("send-text", { content, ttlMinutes: Number(byId("ttl").value) });
    textarea.value = "";
    showMessage("Texto enviado a la bandeja.", true);
  } catch (error) { showMessage(String(error.message || error)); }
  finally { byId("send-text").disabled = false; }
}

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(result);
}

async function addFile(file) {
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    return showMessage(`${file.name}: máximo 32 MB desde la extensión. Usa la aplicación para archivos más grandes.`);
  }
  const key = crypto.randomUUID();
  try {
    await bridge("start-file", { key, name: file.name, size: file.size, mimeType: file.type, ttlMinutes: Number(byId("ttl").value) });
    files.push({ key, name: file.name, size: file.size, status: "Preparando", progress: 0 });
    drawQueue();
    for (let start = 0; start < file.size; start += CHUNK_SIZE) {
      const buffer = await file.slice(start, Math.min(start + CHUNK_SIZE, file.size)).arrayBuffer();
      await bridge("file-chunk", { key, chunk: encodeBase64(buffer) });
    }
    const entry = files.find((item) => item.key === key);
    if (entry) { entry.status = "Subiendo"; drawQueue(); }
    await bridge("upload-file", { key });
    const uploaded = files.find((item) => item.key === key);
    if (uploaded) { uploaded.status = "Preparado"; uploaded.progress = 100; drawQueue(); }
  } catch (error) {
    files = files.filter((entry) => entry.key !== key);
    drawQueue();
    showMessage(`${file.name}: ${String(error.message || error)}`);
    await bridge("remove", { key }).catch(() => undefined);
  }
}

async function addFiles(fileList) {
  const accepted = Array.from(fileList || []);
  if (!accepted.length) return;
  working = true;
  updatePublishButton();
  for (const file of accepted) await addFile(file);
  working = false;
  updatePublishButton();
}

async function publish() {
  working = true;
  updatePublishButton();
  try {
    const result = await bridge("publish", { ttlMinutes: Number(byId("ttl").value) });
    files = result.files || [];
    drawQueue();
    if (result.errors?.length) showMessage(result.errors.join(" · "));
    else showMessage(`${result.published.length} archivo(s) publicados.`, true);
  } catch (error) { showMessage(String(error.message || error)); }
  finally { working = false; updatePublishButton(); }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "hopper-progress") return;
  const entry = files.find((file) => file.key === message.key);
  if (!entry) return;
  entry.progress = message.progress;
  entry.status = message.status;
  drawQueue();
});

byId("send-text").addEventListener("click", () => { void sendText(); });
byId("content").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void sendText(); }
});
byId("paste").addEventListener("click", async () => {
  try { byId("content").value += await navigator.clipboard.readText(); }
  catch { showMessage("No se pudo acceder al portapapeles. Usa Ctrl + V."); }
});
byId("capture").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) return showMessage("Esta pestaña no tiene un enlace compartible.");
  const textarea = byId("content");
  textarea.value = `${textarea.value}${textarea.value ? "\n" : ""}${tab.url}`;
  textarea.focus();
});
byId("attach").addEventListener("click", () => byId("files").click());
byId("files").addEventListener("change", (event) => { void addFiles(event.target.files); event.target.value = ""; });
byId("publish").addEventListener("click", () => { void publish(); });
byId("open").addEventListener("click", () => { void openHopper(); });
byId("inbox").addEventListener("click", () => { void openHopper(); });
byId("login-button").addEventListener("click", () => { void openHopper(); });
const drop = byId("drop");
drop.addEventListener("click", () => byId("files").click());
drop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); byId("files").click(); }
});
for (const name of ["dragover", "dragenter"]) drop.addEventListener(name, (event) => {
  event.preventDefault(); drop.classList.add("is-dragging");
});
drop.addEventListener("dragleave", () => drop.classList.remove("is-dragging"));
drop.addEventListener("drop", (event) => {
  event.preventDefault(); drop.classList.remove("is-dragging"); void addFiles(event.dataTransfer?.files);
});

void syncStatus().catch((error) => { setConnection(false); showMessage(String(error.message || error)); });
