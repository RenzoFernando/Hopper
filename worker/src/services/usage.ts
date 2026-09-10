import type { D1Database } from "../types/env.ts";
import { USAGE_RETENTION_DAYS } from "../lib/constants.ts";

const USAGE_FIELDS = new Set([
  "uploads_count",
  "upload_bytes",
  "deleted_count",
  "deleted_bytes",
  "text_count",
  "file_count",
  "room_uploads_count",
  "room_upload_bytes",
  "failed_uploads",
  "recovered_failures",
  "cleanup_failures",
  "rooms_created"
]);

function usageDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function normalizeDelta(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export async function incrementUsage(
  db: D1Database,
  deltas: Record<string, unknown>,
  date: Date = new Date()
): Promise<void> {
  const entries: Array<[string, number]> = [];

  for (const [field, value] of Object.entries(deltas)) {
    if (!USAGE_FIELDS.has(field)) {
      continue;
    }

    const normalized = normalizeDelta(value);
    if (normalized > 0) {
      entries.push([field, normalized]);
    }
  }

  if (entries.length === 0) {
    return;
  }

  const day = usageDate(date);
  const columns = entries.map(([field]) => field);
  const placeholders = entries.map((_, index) => `?${index + 2}`);
  const updates = columns.map((field) => `${field} = ${field} + excluded.${field}`);
  const values = entries.map(([, value]) => value);

  await db.prepare(`
    INSERT INTO usage_daily (date, ${columns.join(", ")})
    VALUES (?1, ${placeholders.join(", ")})
    ON CONFLICT(date) DO UPDATE SET
      ${updates.join(",\n      ")}
  `).bind(day, ...values).run();
}

export async function recordTransfer(db: D1Database, { type, bytes = 0, spaceType = "personal" }: { type?: string; bytes?: number; spaceType?: string } = {}) {
  const isRoom = spaceType === "room";
  const isText = type === "text";
  const size = normalizeDelta(bytes);

  await incrementUsage(db, {
    uploads_count: 1,
    upload_bytes: size,
    text_count: isText ? 1 : 0,
    file_count: isText ? 0 : 1,
    room_uploads_count: isRoom ? 1 : 0,
    room_upload_bytes: isRoom ? size : 0
  });
}

export async function recordDeletion(db: D1Database, bytes: number = 0) {
  await incrementUsage(db, {
    deleted_count: 1,
    deleted_bytes: normalizeDelta(bytes)
  });
}

export async function recordUploadFailure(db: D1Database, recovered = false) {
  await incrementUsage(db, recovered
    ? { recovered_failures: 1 }
    : { failed_uploads: 1 });
}

export async function recordCleanupFailure(db: D1Database, count: number = 1) {
  await incrementUsage(db, { cleanup_failures: normalizeDelta(count) || 1 });
}

function emptyUsage(day: string = usageDate()) {
  return {
    date: day,
    uploadsCount: 0,
    uploadBytes: 0,
    deletedCount: 0,
    deletedBytes: 0,
    textCount: 0,
    fileCount: 0,
    roomUploadsCount: 0,
    roomUploadBytes: 0,
    failedUploads: 0,
    recoveredFailures: 0,
    cleanupFailures: 0,
    roomsCreated: 0
  };
}

function mapUsage(row: Record<string, unknown> | null | undefined) {
  if (!row) {
    return emptyUsage();
  }

  return {
    date: String(row.date || ""),
    uploadsCount: Number(row.uploads_count || 0),
    uploadBytes: Number(row.upload_bytes || 0),
    deletedCount: Number(row.deleted_count || 0),
    deletedBytes: Number(row.deleted_bytes || 0),
    textCount: Number(row.text_count || 0),
    fileCount: Number(row.file_count || 0),
    roomUploadsCount: Number(row.room_uploads_count || 0),
    roomUploadBytes: Number(row.room_upload_bytes || 0),
    failedUploads: Number(row.failed_uploads || 0),
    recoveredFailures: Number(row.recovered_failures || 0),
    cleanupFailures: Number(row.cleanup_failures || 0),
    roomsCreated: Number(row.rooms_created || 0)
  };
}

export async function getTodayUsage(db: D1Database) {
  const day = usageDate();
  const row = await db.prepare(`
    SELECT *
    FROM usage_daily
    WHERE date = ?1
  `).bind(day).first();

  return row ? mapUsage(row) : emptyUsage(day);
}

export async function getRecentUsage(db: D1Database, days: number = 7) {
  const safeDays = Math.max(1, Math.min(90, Math.floor(Number(days) || 7)));
  const from = new Date(Date.now() - (safeDays - 1) * 86400000).toISOString().slice(0, 10);
  const row = await db.prepare(`
    SELECT
      MIN(date) AS date,
      COALESCE(SUM(uploads_count), 0) AS uploads_count,
      COALESCE(SUM(upload_bytes), 0) AS upload_bytes,
      COALESCE(SUM(deleted_count), 0) AS deleted_count,
      COALESCE(SUM(deleted_bytes), 0) AS deleted_bytes,
      COALESCE(SUM(text_count), 0) AS text_count,
      COALESCE(SUM(file_count), 0) AS file_count,
      COALESCE(SUM(room_uploads_count), 0) AS room_uploads_count,
      COALESCE(SUM(room_upload_bytes), 0) AS room_upload_bytes,
      COALESCE(SUM(failed_uploads), 0) AS failed_uploads,
      COALESCE(SUM(recovered_failures), 0) AS recovered_failures,
      COALESCE(SUM(cleanup_failures), 0) AS cleanup_failures,
      COALESCE(SUM(rooms_created), 0) AS rooms_created
    FROM usage_daily
    WHERE date >= ?1
  `).bind(from).first();

  return mapUsage(row);
}

export async function clearUsageStatistics(db: D1Database) {
  const result = await db.prepare(`DELETE FROM usage_daily`).run();
  return { deletedRows: Number(result.meta?.changes || 0) };
}

export async function cleanupUsageStatistics(db: D1Database) {
  const cutoff = new Date(Date.now() - USAGE_RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
  const result = await db.prepare(`
    DELETE FROM usage_daily
    WHERE date < ?1
  `).bind(cutoff).run();
  return { deletedRows: Number(result.meta?.changes || 0) };
}

export async function getMaintenanceState(db: D1Database) {
  const row = await db.prepare(`
    SELECT
      last_cleanup_at AS lastCleanupAt,
      last_cleanup_failed AS lastCleanupFailed,
      last_reconcile_at AS lastReconcileAt,
      orphan_count AS orphanCount,
      orphan_bytes AS orphanBytes,
      missing_count AS missingCount,
      updated_at AS updatedAt
    FROM maintenance_state
    WHERE id = 1
  `).first();

  return {
    lastCleanupAt: row?.lastCleanupAt || null,
    lastCleanupFailed: Number(row?.lastCleanupFailed || 0),
    lastReconcileAt: row?.lastReconcileAt || null,
    orphanCount: Number(row?.orphanCount || 0),
    orphanBytes: Number(row?.orphanBytes || 0),
    missingCount: Number(row?.missingCount || 0),
    updatedAt: row?.updatedAt || null
  };
}

export async function recordCleanupState(db: D1Database, failed: number = 0) {
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE maintenance_state
    SET last_cleanup_at = ?1, last_cleanup_failed = ?2, updated_at = ?1
    WHERE id = 1
  `).bind(now, Math.max(0, Math.floor(Number(failed) || 0))).run();
}

export async function recordReconcileState(db: D1Database, { orphanCount = 0, orphanBytes = 0, missingCount = 0 }: { orphanCount?: number; orphanBytes?: number; missingCount?: number } = {}) {
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE maintenance_state
    SET
      last_reconcile_at = ?1,
      orphan_count = ?2,
      orphan_bytes = ?3,
      missing_count = ?4,
      updated_at = ?1
    WHERE id = 1
  `).bind(
    now,
    Math.max(0, Math.floor(Number(orphanCount) || 0)),
    Math.max(0, Math.floor(Number(orphanBytes) || 0)),
    Math.max(0, Math.floor(Number(missingCount) || 0))
  ).run();
}