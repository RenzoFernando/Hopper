import { operationResponseSchema } from "../schemas/auth";
import { adminCleanupSchema, adminHealthSchema, adminReconcileSchema, adminRoomsSchema, adminStatusSchema, adminUsageSchema } from "../schemas/admin";
import { roomSessionResponseSchema } from "../schemas/room";
import { request, sessionStore } from "./client";

export const adminApi = {
  usage: () => request("/api/admin/usage", adminUsageSchema, { auth: "personal" }),
  health: () => request("/api/admin/health", adminHealthSchema, { auth: "personal" }),
  rooms: () => request("/api/admin/rooms", adminRoomsSchema, { auth: "personal" }),
  async openRoom(roomId: string) {
    const result = await request(`/api/admin/rooms/${encodeURIComponent(roomId)}/session`, roomSessionResponseSchema, { method: "POST", auth: "personal", body: {} });
    sessionStore.setRoom(result.token, result.expiresIn, result.room.id);
    return result;
  },
  reconcile: () => request("/api/admin/reconcile-storage", adminReconcileSchema, { method: "POST", auth: "personal", body: {} }),
  cleanup: () => request("/api/admin/cleanup", adminCleanupSchema, { method: "POST", auth: "personal", body: {} }),
  deleteStatistics: () => request("/api/admin/statistics", operationResponseSchema, { method: "DELETE", auth: "personal" }),
  changePin: (pin: string, confirmation: string) => request("/api/admin/pin", adminStatusSchema, { method: "POST", auth: "personal", body: { pin, confirmation } }),
  resetSystem: () => request("/api/admin/reset-system", adminStatusSchema, { method: "POST", auth: "personal", body: {} })
};
