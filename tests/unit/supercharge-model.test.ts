import { describe, expect, test } from "vitest";
import { capacityFor, formatCapacity, statusLabel, SUPERCHARGE_DURATIONS } from "../../src/features/supercharge/model";
import type { ExclusiveStatus } from "../../src/api/exclusive";

const status = (sizes: number[]): ExclusiveStatus => ({
  ok: true, active: true, status: "active", expiresAt: "2099-10-25T20:00:00.000Z", limitBytes: 10_000_000_000,
  files: sizes.map((size, index) => ({ id: String(index), name: `archivo-${index}`, mime_type: "application/zip", size, status: "ready", created_at: "2026-10-25T00:00:00.000Z" }))
});

describe("Supercarga: modelo y límites", () => {
  test("el total se comparte entre archivos y reservas", () => {
    expect(capacityFor(status([3_000_000_000, 5_000_000_000]))).toEqual({ used: 8_000_000_000, available: 2_000_000_000, percentage: 80 });
    expect(capacityFor(status([11_000_000_000]))).toEqual({ used: 11_000_000_000, available: 0, percentage: 100 });
    const truncated = { ...status([1_000]), usedBytes: 9_000_000_000, fileCount: 201 };
    expect(capacityFor(truncated)).toEqual({ used: 9_000_000_000, available: 1_000_000_000, percentage: 90 });
    expect(capacityFor(null)).toEqual({ used: 0, available: 0, percentage: 0 });
  });

  test("las duraciones no permiten sesiones indefinidas", () => {
    expect(SUPERCHARGE_DURATIONS.map(option => option.value)).toEqual([60, 360, 720, 1440]);
  });

  test("mantiene estados breves y cifras decimales comprensibles", () => {
    expect(formatCapacity(10_000_000_000)).toContain("10");
    expect(formatCapacity(10_000_000_000)).toContain("GB");
    expect(statusLabel("active", true)).toBe("Activa");
    expect(statusLabel("preparing", true)).toBe("Limpiando");
    expect(statusLabel("active", false)).toBe("No disponible");
  });
});
