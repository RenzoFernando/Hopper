import { describe, expect, it } from "vitest";
import { fileTypeLabel, formatBytes, formatCountdown, textPreview, ttlLabel } from "../../src/lib/format";
import { isCompleteRoomCode, normalizeRoomCode } from "../../src/lib/room-code";

describe("utilidades migradas a TypeScript", () => {
  it("conserva la normalización de códigos de sala", () => {
    expect(normalizeRoomCode("ab1234")).toBe("AB-1234");
    expect(normalizeRoomCode("a!b-12x34")).toBe("AB-1234");
    expect(normalizeRoomCode("a1")).toBe("A");
    expect(isCompleteRoomCode("ab1234")).toBe(true);
    expect(isCompleteRoomCode("A-1234")).toBe(false);
  });

  it("conserva el formato visible de tamaños y TTL", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(104857600)).toBe("100 MB");
    expect(ttlLabel(5)).toBe("5 min");
    expect(ttlLabel(60)).toBe("1 hora");
    expect(ttlLabel(360)).toBe("6 horas");
    expect(ttlLabel(1440)).toBe("1 día");
    expect(ttlLabel(0)).toBe("Indefinido");
  });

  it("conserva previews y cuenta regresiva", () => {
    expect(textPreview("  hola\n   mundo  ")).toBe("hola mundo");
    expect(fileTypeLabel("foto.png", "image/png")).toBe("PNG");
    expect(fileTypeLabel("archivo", "application/octet-stream")).toBe("APPLICATION");
    expect(formatCountdown("2026-09-10T00:05:00.000Z", Date.parse("2026-09-10T00:00:28.000Z"))).toBe("4:32");
    expect(formatCountdown(null)).toBe("Indefinido");
  });
});
