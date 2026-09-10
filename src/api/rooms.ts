import { operationResponseSchema } from "../schemas/auth";
import { roomActivityResponseSchema, roomCapacitySchema, roomSessionResponseSchema, roomStatusResponseSchema, roomsResponseSchema } from "../schemas/room";
import { forgetRoomCode, rememberRoomCode, request, sessionStore } from "./client";

export const roomsApi = {
  capacity: () => request("/api/rooms/capacity", roomCapacitySchema),
  async create() {
    const result = await request("/api/rooms", roomSessionResponseSchema, { method: "POST", body: {} });
    if (result.room.id && result.code) rememberRoomCode(result.room.id, result.code, result.room.expiresAt);
    sessionStore.setRoom(result.token, result.expiresIn, result.room.id);
    return result;
  },
  list: () => request("/api/rooms", roomsResponseSchema, { auth: "personal" }),
  async close(roomId: string) {
    const result = await request(`/api/rooms/${encodeURIComponent(roomId)}`, operationResponseSchema, { method: "DELETE", auth: "personal" });
    forgetRoomCode(roomId);
    if (sessionStore.getRoom()?.roomId === roomId) sessionStore.clearRoom();
    return result;
  },
  async join(code: string) {
    const result = await request("/api/rooms/join", roomSessionResponseSchema, { method: "POST", body: { code } });
    sessionStore.setRoom(result.token, result.expiresIn, result.room.id);
    rememberRoomCode(result.room.id, String(code || "").trim().toUpperCase(), result.room.expiresAt);
    return result;
  },
  status: () => request("/api/room/status", roomStatusResponseSchema, { auth: "room" }),
  async activity() {
    const result = await request("/api/room/activity", roomActivityResponseSchema, { method: "POST", auth: "room", body: {} });
    const session = sessionStore.getRoom();
    const code = session?.roomId ? sessionStore.getRoomCodes()[session.roomId]?.code || "" : "";
    if (code) rememberRoomCode(result.room.id, code, result.room.expiresAt);
    return result;
  }
};
