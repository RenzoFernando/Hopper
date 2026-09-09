import {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_ROOM_MAX_BYTES,
  DEFAULT_ROOM_MAX_FILE_BYTES,
  DEFAULT_ROOM_MAX_ITEMS,
  MAX_ACTIVE_ROOMS,
  ORPHAN_SAFETY_SECONDS,
  RECONCILE_INTERVAL_SECONDS,
  ROOM_TTL_OPTIONS,
  STORAGE_INTERNAL_LIMIT_BYTES,
  STORAGE_REFERENCE_BYTES,
  STORAGE_WARNING_BYTES
} from "./constants.js";
import {
  checkB2Access,
  deleteB2Version,
  listB2VersionsByPrefix
} from "./b2.js";
import { deleteAllItems, getEstimatedStorageUsage } from "./items.js";
import { closeRoom, listActiveRooms } from "./rooms.js";
import {
  clearUsageStatistics,
  getMaintenanceState,
  getRecentUsage,
  getTodayUsage,
  recordCleanupState,
  recordReconcileState
} from "./usage.js";

function configuredMaxFileBytes(env) {
  const value = Number(env.MAX_FILE_BYTES);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_FILE_BYTES;
}

export async function getAdminUsage(env) {
  const [storage, today, last7Days, rooms, counts, maintenance] = await Promise.all([
    getEstimatedStorageUsage(env),
    getTodayUsage(env.DB),
    getRecentUsage(env.DB, 7),
    listActiveRooms(env.DB),
    env.DB.prepare(`
      SELECT
        SUM(CASE WHEN status = 'ready' AND expires_at > ?1 THEN 1 ELSE 0 END) AS activeItems,
        SUM(CASE WHEN status = 'pending' AND expires_at > ?1 THEN 1 ELSE 0 END) AS pendingUploads
      FROM drop_items
    `).bind(new Date().toISOString()).first(),
    getMaintenanceState(env.DB)
  ]);

  return {
    storage: {
      estimatedBytes: storage.estimatedBytes,
      activeBytes: storage.activeBytes,
      orphanBytes: storage.orphanBytes,
      referenceBytes: STORAGE_REFERENCE_BYTES,
      freeEstimatedBytes: Math.max(0, STORAGE_REFERENCE_BYTES - storage.estimatedBytes),
      warningBytes: STORAGE_WARNING_BYTES,
      internalLimitBytes: STORAGE_INTERNAL_LIMIT_BYTES,
      warning: storage.warning,
      blocked: storage.blocked
    },
    today,
    last7Days,
    rooms: {
      active: rooms.length,
      maximum: MAX_ACTIVE_ROOMS
    },
    limits: {
      maxFileBytes: configuredMaxFileBytes(env),
      storageReferenceBytes: STORAGE_REFERENCE_BYTES,
      storageWarningBytes: STORAGE_WARNING_BYTES,
      storageInternalLimitBytes: STORAGE_INTERNAL_LIMIT_BYTES,
      maxRooms: MAX_ACTIVE_ROOMS,
      roomMaxTtlMinutes: Math.max(...ROOM_TTL_OPTIONS),
      roomMaxFileBytes: DEFAULT_ROOM_MAX_FILE_BYTES,
      roomMaxBytes: DEFAULT_ROOM_MAX_BYTES,
      roomMaxItems: DEFAULT_ROOM_MAX_ITEMS,
      activeItems: Number(counts?.activeItems || 0),
      pendingUploads: Number(counts?.pendingUploads || 0),
      cleanupFailures: Number(maintenance.lastCleanupFailed || 0),
      orphanItems: Number(maintenance.orphanCount || 0),
      missingItems: Number(maintenance.missingCount || 0)
    },
    maintenance
  };
}

export async function getAdminHealth(env) {
  const d1Started = Date.now();
  let d1Ok = false;

  try {
    const row = await env.DB.prepare(`SELECT 1 AS ok`).first();
    d1Ok = Number(row?.ok || 0) === 1;
  } catch {
    d1Ok = false;
  }

  const maintenance = await getMaintenanceState(env.DB);
  let b2Ok = false;
  let b2Error = null;

  try {
    await checkB2Access(env);
    b2Ok = true;
  } catch (error) {
    b2Error = error?.message || "No disponible";
  }

  return {
    worker: { ok: true },
    d1: { ok: d1Ok, latencyMs: Date.now() - d1Started },
    b2: { ok: b2Ok, error: b2Error },
    b2Signing: { ok: Boolean(env.B2_KEY_ID && env.B2_APPLICATION_KEY && env.B2_ENDPOINT && env.B2_BUCKET_NAME) },
    resend: { ok: Boolean(env.RESEND_API_KEY && env.RECOVERY_EMAIL), configured: Boolean(env.RECOVERY_EMAIL) },
    cleanup: {
      ok: Boolean(maintenance.lastCleanupAt) && maintenance.lastCleanupFailed === 0,
      lastCleanupAt: maintenance.lastCleanupAt,
      failures: maintenance.lastCleanupFailed
    },
    reconcile: {
      lastReconcileAt: maintenance.lastReconcileAt,
      orphanCount: maintenance.orphanCount,
      orphanBytes: maintenance.orphanBytes,
      missingCount: maintenance.missingCount
    }
  };
}

function isOlderThanSafety(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && timestamp <= Date.now() - ORPHAN_SAFETY_SECONDS * 1000;
}

export async function reconcileStorage(env) {
  const [listing, rowsResult] = await Promise.all([
    listB2VersionsByPrefix(env, "drop/", 50),
    env.DB.prepare(`
      SELECT id, status, storage_key AS storageKey, created_at AS createdAt, size
      FROM drop_items
      WHERE type = 'file' AND storage_key IS NOT NULL
    `).all()
  ]);
  const rows = rowsResult.results || [];
  const referenced = new Map(rows.map((row) => [String(row.storageKey || ""), row]));
  const latestByKey = new Map();

  for (const entry of listing.entries) {
    if (entry.isLatest && !latestByKey.has(entry.key)) {
      latestByKey.set(entry.key, entry);
    }
  }

  let orphanDetected = 0;
  let orphanBytes = 0;
  let orphanDeleted = 0;
  let orphanDeleteFailures = 0;
  let remainingOrphans = 0;
  let remainingOrphanBytes = 0;

  for (const entry of listing.entries) {
    if (entry.deleteMarker) {
      continue;
    }

    const referencedRow = referenced.get(entry.key);
    const latest = latestByKey.get(entry.key);
    const isStaleVersion = Boolean(referencedRow) && latest && latest.versionId !== entry.versionId;
    const isOrphan = !referencedRow || isStaleVersion;

    if (!isOrphan) {
      continue;
    }

    orphanDetected += 1;
    orphanBytes += Number(entry.size || 0);

    if (!listing.truncated && isOlderThanSafety(entry.lastModified)) {
      try {
        await deleteB2Version(env, entry.key, entry.versionId);
        orphanDeleted += 1;
        continue;
      } catch (error) {
        orphanDeleteFailures += 1;
        console.error("No fue posible eliminar una versión huérfana de B2.", entry.key, error);
      }
    }

    remainingOrphans += 1;
    remainingOrphanBytes += Number(entry.size || 0);
  }

  let missingDetected = 0;
  let missingRemoved = 0;

  if (!listing.truncated) {
    for (const row of rows) {
      const latest = latestByKey.get(String(row.storageKey || ""));
      const available = latest && !latest.deleteMarker;

      if (available || !isOlderThanSafety(row.createdAt)) {
        continue;
      }

      missingDetected += 1;
      const result = await env.DB.prepare(`
        DELETE FROM drop_items
        WHERE id = ?1 AND storage_key = ?2
      `).bind(row.id, row.storageKey).run();
      missingRemoved += Number(result.meta?.changes || 0);
    }
  }

  await recordReconcileState(env.DB, {
    orphanCount: remainingOrphans,
    orphanBytes: remainingOrphanBytes,
    missingCount: listing.truncated ? 0 : Math.max(0, missingDetected - missingRemoved)
  });

  return {
    complete: !listing.truncated,
    pages: listing.pages,
    versionsScanned: listing.entries.length,
    orphanDetected,
    orphanBytes,
    orphanDeleted,
    orphanDeleteFailures,
    remainingOrphans,
    remainingOrphanBytes,
    missingDetected,
    missingRemoved
  };
}

export async function maybeReconcileStorage(env) {
  const maintenance = await getMaintenanceState(env.DB);
  const last = Date.parse(maintenance.lastReconcileAt || "");

  if (Number.isFinite(last) && last + RECONCILE_INTERVAL_SECONDS * 1000 > Date.now()) {
    return { skipped: true };
  }

  return reconcileStorage(env);
}

export async function deleteAdminStatistics(env) {
  return clearUsageStatistics(env.DB);
}

export async function resetAdminSystem(env) {
  const rooms = await listActiveRooms(env.DB);
  let closed = 0;
  let roomDeleted = 0;
  let roomFailures = 0;

  for (const room of rooms) {
    const result = await closeRoom(env, room.id);
    closed += result.closed ? 1 : 0;
    roomDeleted += Number(result.deleted || 0);
    roomFailures += Number(result.failed || 0);
  }

  const items = await deleteAllItems(env);
  await env.DB.prepare(`DELETE FROM rate_limits`).run();
  await recordCleanupState(env.DB, items.failed);

  return {
    rooms: { scanned: rooms.length, closed, deleted: roomDeleted, failed: roomFailures },
    items,
    failed: Number(items.failed || 0)
  };
}
