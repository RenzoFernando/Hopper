/** El SW puede actualizarse, pero nunca recargamos la PWA en medio de una subida. */
let activeTransfers = 0;
export function isTransferActive() { return activeTransfers > 0; }

/** Devuelve una liberación idempotente para que los errores no dejen el bloqueo retenido. */
export function beginTransfer() {
  activeTransfers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeTransfers = Math.max(0, activeTransfers - 1);
    if (activeTransfers === 0 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("hopper:transfers-idle"));
    }
  };
}
