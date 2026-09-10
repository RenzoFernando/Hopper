import type { FileUrlResponse, HopperItem, ItemResponse, ItemsResponse, UploadResponse } from "../../schemas/item";

export type SelectedFileStatus = "" | "queued" | "preparando" | "subiendo" | "confirmando" | "listo" | "error";

export type SelectedFileEntry = {
  key: string;
  file: File;
  progress: number;
  status: SelectedFileStatus;
  uploadId: string;
  controller: AbortController | null;
};

export type TransferApi = {
  listItems: () => Promise<ItemsResponse>;
  createText: (content: string, ttlMinutes: number) => Promise<ItemResponse>;
  initializeUpload: (file: File, ttlMinutes: number) => Promise<UploadResponse>;
  uploadToSignedUrl: (file: File, uploadUrl: string, onProgress?: (progress: number) => void, contentType?: string, signal?: AbortSignal) => Promise<void>;
  completeUpload: (id: string) => Promise<ItemResponse>;
  cancelUpload: (id: string) => Promise<unknown>;
  getFileUrl: (id: string, mode?: "download" | "preview" | "stream") => Promise<FileUrlResponse>;
  deleteItem: (id: string) => Promise<unknown>;
  resetTtl?: (id: string, ttlMinutes: number) => Promise<ItemResponse>;
};

export type TransferWorkspaceOptions = {
  api: TransferApi;
  queryKey: string;
  enabled: boolean;
  maxFileBytes: number;
  defaultTtlMinutes: number;
  ttlOptions: number[];
  pollIntervalMs: number;
  uploadConcurrency: number;
  maxSelectedFiles?: number;
  allowTtlReset?: boolean;
  emptyTitle?: string;
  emptyCopy?: string;
  onUnauthorized: () => void;
  onActivity?: () => void;
  onSyncChange?: (label: string, variant: "" | "busy" | "offline" | "ok") => void;
};

export type PreviewState = { item: HopperItem; url: string } | null;
