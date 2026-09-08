import { hopperApi } from "./api.js?v=20260908-3";

const elements = {
  loading: document.querySelector("#recovery-loading"),
  form: document.querySelector("#recovery-form"),
  newPin: document.querySelector("#new-pin"),
  confirmPin: document.querySelector("#confirm-pin"),
  submit: document.querySelector("#recovery-submit"),
  result: document.querySelector("#recovery-result"),
  resultTitle: document.querySelector("#recovery-result-title"),
  resultCopy: document.querySelector("#recovery-result-copy"),
  message: document.querySelector("#recovery-message")
};

let recoveryToken = "";

function normalizePinInput(input) {
  const value = input.value.replace(/\D/g, "").slice(0, 4);

  if (input.value !== value) {
    input.value = value;
  }

  return value;
}

function setMessage(message, type = "") {
  elements.message.textContent = message;
  elements.message.className = `form-message ${type ? `is-${type}` : ""}`.trim();
}

function showResult(title, copy) {
  elements.loading.hidden = true;
  elements.form.hidden = true;
  elements.result.hidden = false;
  elements.resultTitle.textContent = title;
  elements.resultCopy.textContent = copy;
}

function resultForStatus(status) {
  if (status === "expired") {
    return ["Enlace expirado", "Este enlace de recuperación ya venció. Solicita uno nuevo desde Hopper."];
  }

  if (status === "used") {
    return ["Enlace ya utilizado", "Este enlace de recuperación ya fue consumido y no puede volver a utilizarse."];
  }

  return ["Enlace no válido", "No fue posible validar este enlace de recuperación."];
}

async function verifyToken() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  recoveryToken = params.get("token") || "";

  if (recoveryToken) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }

  if (!recoveryToken) {
    showResult("Enlace no válido", "El enlace no contiene un token de recuperación.");
    return;
  }

  try {
    const result = await hopperApi.verifyRecovery(recoveryToken);

    if (!result?.ok || result.status !== "valid") {
      showResult(...resultForStatus(result?.status));
      return;
    }

    elements.loading.hidden = true;
    elements.form.hidden = false;
    requestAnimationFrame(() => elements.newPin.focus());
  } catch (error) {
    showResult("No fue posible verificar", error.message || "Hopper no pudo validar el enlace.");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const pin = normalizePinInput(elements.newPin);
  const confirmation = normalizePinInput(elements.confirmPin);

  if (!/^\d{4}$/.test(pin)) {
    setMessage("El nuevo PIN debe tener 4 dígitos.", "error");
    return;
  }

  if (pin !== confirmation) {
    setMessage("Los PIN no coinciden.", "error");
    return;
  }

  elements.submit.disabled = true;
  elements.submit.textContent = "Guardando…";
  setMessage("Actualizando acceso…");

  try {
    const result = await hopperApi.resetPin(recoveryToken, pin, confirmation);

    if (!result?.ok || result.status !== "updated") {
      showResult(...resultForStatus(result?.status));
      return;
    }

    recoveryToken = "";
    showResult("PIN actualizado", "Hopper quedó desbloqueado. Ya puedes volver e ingresar con el nuevo PIN.");
    setMessage("");
  } catch (error) {
    setMessage(error.message || "No fue posible actualizar el PIN.", "error");
  } finally {
    elements.submit.disabled = false;
    elements.submit.textContent = "Guardar nuevo PIN";
  }
}

elements.newPin.addEventListener("input", () => normalizePinInput(elements.newPin));
elements.confirmPin.addEventListener("input", () => normalizePinInput(elements.confirmPin));
elements.form.addEventListener("submit", handleSubmit);

verifyToken();