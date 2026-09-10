import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../api/admin";
import { sessionStore } from "../api/client";
import { roomsApi } from "../api/rooms";
import { AdminHealth } from "../components/admin/AdminHealth";
import { AdminLimits } from "../components/admin/AdminLimits";
import { AdminMetrics } from "../components/admin/AdminMetrics";
import { AdminRooms } from "../components/admin/AdminRooms";
import { MaintenanceActions } from "../components/admin/MaintenanceActions";
import { AppFooter } from "../components/layout/AppFooter";
import { AppHeader } from "../components/layout/AppHeader";
import { ToastRegion } from "../components/ui/ToastRegion";
import { useNow } from "../hooks/useNow";
import { useToasts } from "../hooks/useToasts";
import { isVisualTestRuntime } from "../lib/runtime";
import type { Room } from "../schemas/room";

type ActionName = "cleanup" | "reconcile" | "delete-stats" | "reset";

export function AdminPage() {
  const navigate = useNavigate();
  const visual = isVisualTestRuntime();
  const hasSession = visual || sessionStore.hasPersonal();
  const [busyRoom, setBusyRoom] = useState("");
  const busyRoomRef = useRef("");
  const [busyAction, setBusyAction] = useState<ActionName | "">("");
  const busyActionRef = useRef<ActionName | "">("");
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const { toasts, showToast } = useToasts(3800);
  const now = useNow();
  const { data: usageData, error: usageError, refetch: refetchUsage } = useQuery({ queryKey: ["admin-usage"], queryFn: adminApi.usage, enabled: hasSession && !visual });
  const { data: healthData, error: healthError, refetch: refetchHealth } = useQuery({ queryKey: ["admin-health"], queryFn: adminApi.health, enabled: hasSession && !visual });
  const { data: roomsData, error: roomsError, refetch: refetchRooms } = useQuery({ queryKey: ["admin-rooms"], queryFn: adminApi.rooms, enabled: hasSession && !visual });

  const goHome = useCallback(() => {
    sessionStore.clearPersonal();
    navigate("/", { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!visual && !sessionStore.hasPersonal()) goHome();
  }, [goHome, visual]);

  useEffect(() => {
    const expired = () => goHome();
    window.addEventListener("hopper:session-expired", expired);
    return () => window.removeEventListener("hopper:session-expired", expired);
  }, [goHome]);

  useEffect(() => {
    const error = usageError || healthError || roomsError;
    if (!error) return;
    showToast(error instanceof Error ? error.message : "No fue posible actualizar Administración.", "error");
  }, [healthError, roomsError, showToast, usageError]);

  const refreshAll = useCallback(async (includeHealth = true) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const tasks = [
        refetchUsage().then((result) => result.error),
        refetchRooms().then((result) => result.error)
      ];
      if (includeHealth) tasks.push(refetchHealth().then((result) => result.error));
      const errors = await Promise.all(tasks);
      const error = errors.find((value) => value);
      if (error) throw error;
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 401) { goHome(); return; }
      showToast(error instanceof Error ? error.message : "No fue posible actualizar Administración.", "error");
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [goHome, refetchHealth, refetchRooms, refetchUsage, showToast]);

  const openRoom = async (room: Room) => {
    if (busyRoomRef.current) return;
    busyRoomRef.current = room.id;
    setBusyRoom(room.id);
    try {
      await adminApi.openRoom(room.id);
      const code = sessionStore.getRoomCodes()[room.id]?.code || "";
      navigate(code ? `/room/${encodeURIComponent(code)}` : "/room");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No fue posible abrir la sala.", "error");
    } finally {
      busyRoomRef.current = "";
      setBusyRoom("");
    }
  };

  const closeRoom = async (room: Room) => {
    if (busyRoomRef.current) return;
    busyRoomRef.current = room.id;
    setBusyRoom(room.id);
    try {
      await roomsApi.close(room.id);
      showToast("Sala cerrada.", "success");
      await refreshAll(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No fue posible cerrar la sala.", "error");
    } finally {
      busyRoomRef.current = "";
      setBusyRoom("");
    }
  };

  const runAction = async (action: ActionName) => {
    if (busyActionRef.current) return;
    if (action === "reset" && !window.confirm("¿Reiniciar Hopper? Se eliminará todo el contenido temporal, se cerrarán las salas y se invalidarán las sesiones. El PIN, la configuración y las estadísticas se conservarán.")) return;
    if (action === "delete-stats" && !window.confirm("¿Borrar las estadísticas agregadas de Hopper? El contenido temporal no se ve afectado.")) return;
    busyActionRef.current = action;
    setBusyAction(action);
    try {
      if (action === "cleanup") {
        const result = await adminApi.cleanup();
        showToast(`Limpieza completada: ${result.items?.deleted || 0} elementos eliminados.`, "success");
        await refreshAll();
      } else if (action === "reconcile") {
        const result = await adminApi.reconcile();
        showToast(`Reconciliación: ${result.orphanDeleted || 0} versiones huérfanas eliminadas.`, "success");
        await refreshAll();
      } else if (action === "delete-stats") {
        await adminApi.deleteStatistics();
        showToast("Estadísticas borradas.", "success");
        await refreshAll(false);
      } else {
        await adminApi.resetSystem();
        sessionStore.clearPersonal();
        sessionStore.clearRoom();
        showToast("Sistema reiniciado. Volviendo al inicio…", "success");
        window.setTimeout(goHome, 450);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No fue posible ejecutar el mantenimiento.", "error");
    } finally {
      busyActionRef.current = "";
      setBusyAction("");
    }
  };

  const changePin = async (pin: string, confirmation: string) => {
    await adminApi.changePin(pin, confirmation);
    sessionStore.clearPersonal();
    window.setTimeout(goHome, 450);
    return true;
  };

  return <>
    <div className="document-shell">
      <AppHeader variant="admin" adminRefreshing={refreshing} onRefreshAdmin={() => { void refreshAll(); }} />
      <main className="admin-main">
        <div className="admin-heading"><div><p className="eyebrow">HOPPER</p><h1>Administración</h1></div></div>
        <AdminMetrics usage={usageData} />
        <div className="admin-columns"><AdminHealth health={healthData?.health} /><AdminLimits usage={usageData} /></div>
        <AdminRooms rooms={roomsData?.rooms ?? []} now={now} busyRoom={busyRoom} onOpen={(room) => { void openRoom(room); }} onClose={(room) => { void closeRoom(room); }} />
        <MaintenanceActions busyAction={busyAction} onAction={(action) => { void runAction(action); }} onChangePin={changePin} />
      </main>
      <ToastRegion toasts={toasts} />
    </div>
    <AppFooter />
  </>;
}
