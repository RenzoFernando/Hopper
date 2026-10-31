import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useToasts } from "../../src/hooks/useToasts";

afterEach(() => {
  vi.useRealTimers();
});

describe("notificaciones de descarga", () => {
  test("mantiene el progreso visible hasta terminar y luego lo retira", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToasts(2500));
    let id = "";
    act(() => { id = result.current.startToast("Iniciando descarga…"); });
    expect(result.current.toasts).toEqual([{ id, message: "Iniciando descarga…", kind: "progress", placement: "top" }]);

    act(() => { vi.advanceTimersByTime(12_000); });
    expect(result.current.toasts).toHaveLength(1);
    act(() => { result.current.updateToast(id, "Descargando: 80%"); });
    expect(result.current.toasts[0]?.message).toBe("Descargando: 80%");

    act(() => { result.current.updateToast(id, "Descarga enviada al navegador.", "success"); });
    expect(result.current.toasts[0]?.kind).toBe("success");
    act(() => { vi.advanceTimersByTime(5999); });
    expect(result.current.toasts).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.toasts).toHaveLength(0);
  });

  test("muestra una falla y conserva los avisos simultáneos de otros archivos", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToasts());
    let first = "";
    let second = "";
    act(() => {
      first = result.current.startToast("Audio grande");
      second = result.current.startToast("Video grande");
    });
    act(() => { result.current.updateToast(first, "Falló la descarga", "error"); });
    expect(result.current.toasts.map((toast) => toast.kind)).toEqual(["error", "progress"]);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(result.current.toasts.map((toast) => toast.id)).toEqual([second]);
  });
});
