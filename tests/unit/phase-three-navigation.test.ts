import { describe, expect, it } from "vitest";
import { extractHttpUrls, splitHttpText } from "../../src/lib/links";
import { recoveryTokenFromHash, roomCodeFromLegacyHash, roomPath, roomUrl } from "../../src/lib/navigation";

describe("navegación limpia de Fase 3", () => {
  it("construye rutas y enlaces de sala limpios", () => {
    expect(roomPath("ab1234")).toBe("/room/AB-1234");
    expect(roomPath("incompleto")).toBe("/room");
    expect(roomUrl("AB-1234", "https://hopper.example")).toBe("https://hopper.example/room/AB-1234");
  });

  it("acepta tokens de recuperación nuevos y legacy", () => {
    expect(recoveryTokenFromHash("#abc_DEF-123")).toBe("abc_DEF-123");
    expect(recoveryTokenFromHash("#token=abc_DEF-123")).toBe("abc_DEF-123");
  });

  it("recupera códigos desde enlaces legacy", () => {
    expect(roomCodeFromLegacyHash("#ab1234")).toBe("AB-1234");
    expect(roomCodeFromLegacyHash("#AB-1234")).toBe("AB-1234");
  });

  it("detecta únicamente enlaces HTTP(S) y conserva puntuación", () => {
    expect(extractHttpUrls("Mira https://example.com/a?x=1, y http://example.org/test. javascript:alert(1)")).toEqual([
      "https://example.com/a?x=1",
      "http://example.org/test"
    ]);

    const parts = splitHttpText("Abrir https://example.com/listo.");
    expect(parts).toEqual([
      { text: "Abrir " },
      { text: "https://example.com/listo", href: "https://example.com/listo" },
      { text: "." }
    ]);
  });

});
