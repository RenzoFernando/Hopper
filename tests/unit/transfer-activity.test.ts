import { describe, expect, test } from "vitest";
import { beginTransfer, isTransferActive } from "../../src/lib/transfer-activity";

describe("protección frente a recargas de la PWA durante subidas", () => {
  test("no libera hasta que la última subida haya finalizado", () => {
    let signals = 0;
    const listener = () => { signals += 1; };
    window.addEventListener("hopper:transfers-idle", listener);
    try {
      const finishOne = beginTransfer();
      const finishTwo = beginTransfer();
      expect(isTransferActive()).toBe(true);
      finishOne();
      finishOne();
      expect(isTransferActive()).toBe(true);
      expect(signals).toBe(0);
      finishTwo();
      expect(isTransferActive()).toBe(false);
      expect(signals).toBe(1);
    } finally {
      window.removeEventListener("hopper:transfers-idle", listener);
    }
  });
});
