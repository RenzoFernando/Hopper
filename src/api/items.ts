import { operationResponseSchema } from "../schemas/auth";
import { fileUrlResponseSchema, itemResponseSchema, itemsResponseSchema, uploadResponseSchema } from "../schemas/item";
import { request, uploadToSignedUrl } from "./client";

function itemApi(prefix: string, auth: "personal" | "room", fixedTtl?: number) {
  const itemsPath = `${prefix}/items`;
  const uploadsPath = `${prefix}/uploads`;
  return {
    listItems: () => request(itemsPath, itemsResponseSchema, { auth }),
    createText: (content: string, ttlMinutes: number) => request(`${itemsPath}/text`, itemResponseSchema, {
      method: "POST", auth, body: { content, ttlMinutes: fixedTtl ?? ttlMinutes }
    }),
    initializeUpload: (file: File, ttlMinutes: number) => request(`${uploadsPath}/init`, uploadResponseSchema, {
      method: "POST",
      auth,
      body: { name: file.name, size: file.size, mimeType: file.type || "application/octet-stream", ttlMinutes: fixedTtl ?? ttlMinutes }
    }),
    completeUpload: (id: string) => request(`${uploadsPath}/${encodeURIComponent(id)}/complete`, itemResponseSchema, { method: "POST", auth, body: {} }),
    cancelUpload: (id: string, failed = false) => {
      const query = failed ? "?outcome=failed" : "";
      return request(`${uploadsPath}/${encodeURIComponent(id)}/cancel${query}`, operationResponseSchema, { method: "DELETE", auth });
    },
    getFileUrl: (id: string, mode: "download" | "preview" | "stream" = "download") => {
      const query = new URLSearchParams({ mode });
      return request(`${itemsPath}/${encodeURIComponent(id)}/url?${query.toString()}`, fileUrlResponseSchema, { auth });
    },
    deleteItem: (id: string) => request(`${itemsPath}/${encodeURIComponent(id)}`, operationResponseSchema, { method: "DELETE", auth }),
    uploadToSignedUrl
  };
}

const personalBase = itemApi("/api", "personal");
const roomBase = itemApi("/api/room", "room", 10);

export const itemsApi = {
  ...personalBase,
  resetTtl: (id: string, ttlMinutes: number) => request(`/api/items/${encodeURIComponent(id)}/ttl`, itemResponseSchema, {
    method: "PATCH", auth: "personal", body: { ttlMinutes }
  })
};

export const roomItemsApi = roomBase;
