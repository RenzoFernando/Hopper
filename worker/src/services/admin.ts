import type { Env } from "../types/env.ts";
import {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_ROOM_MAX_BYTES,
  DEFAULT_ROOM_MAX_FILE_BYTES,
  DEFAULT_ROOM_MAX_ITEMS,
  MAX_ACTIVE_ROOMS,
  ORPHAN_SAFETY_SECONDS,
  RECONCILE_INTERVAL_SECONDS,
  ROOM_INACTIVITY_SECONDS,
  ROOM_LIFETIME_MINUTES,
  STORAGE_INTERNAL_LIMIT_BYTES,
  STORAGE_REFERENCE_BYTES,
  STORAGE_WARNING_BYTES
} from "../lib/constants.ts";
import {
  checkB2Access,
  deleteB2Version,
  listB2VersionsByPrefix
} from "./b2.ts";
import { deleteAllItems, getEstimatedStorageUsage } from "./items.ts";
import { closeRoom, listActiveRooms } from "./rooms.ts";
import {
  clearUsageStatistics,
  getMaintenanceState,
  getRecentUsage,
  getTodayUsage,
  recordCleanupState,
  recordReconcileState
} from "./usage.ts";

function configuredCappedInteger(value: unknown, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(Math.floor(number), maximum)
    : maximum;
}

function configuredMaxFileBytes(env: Env) {
  return configuredCappedInteger(env.MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES);
}

function configuredRoomMaxFileBytes(env: Env) {
  return configuredCappedInteger(env.ROOM_MAX_FILE_BYTES, DEFAULT_ROOM_MAX_FILE_BYTES);
}

function configuredRoomMaxBytes(env: Env) {
  return configuredCappedInteger(env.ROOM_MAX_BYTES, DEFAULT_ROOM_MAX_BYTES);
}

function configuredRoomMaxItems(env: Env) {
  return configuredCappedInteger(env.ROOM_MAX_ITEMS, DEFAULT_ROOM_MAX_ITEMS);
}

export async function getAdminUsage(env: Env) {
  const [storage, today, last7Days, rooms, counts, maintenance] = await Promise.all([
    getEstimatedStorageUsage(env),
    getTodayUsage(env.DB),
    getRecentUsage(env.DB, 7),
    listActiveRooms(env.DB),
    env.DB.prepare(`
      SELECT
        SUM(CASE WHEN status = 'ready' AND (expires_at IS NULL OR expires_at > ?1) THEN 1 ELSE 0 END) AS activeItems,
        SUM(CASE WHEN status = 'pending' AND expires_at > ?1 THEN 1 ELSE 0 END) AS pendingUploads
      FROM drop_items
    `).bind(new Date().toISOString()).first<{ activeItems: number | null; pendingUploads: number | null }>(),
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
      roomMaxTtlMinutes: ROOM_LIFETIME_MINUTES,
      roomLifetimeMinutes: ROOM_LIFETIME_MINUTES,
      roomInactivityMinutes: Math.floor(ROOM_INACTIVITY_SECONDS / 60),
      roomMaxFileBytes: configuredRoomMaxFileBytes(env),
      roomMaxBytes: configuredRoomMaxBytes(env),
      roomMaxItems: configuredRoomMaxItems(env),
      activeItems: Number(counts?.activeItems || 0),
      pendingUploads: Number(counts?.pendingUploads || 0),
      cleanupFailures: Number(maintenance.lastCleanupFailed || 0),
      orphanItems: Number(maintenance.orphanCount || 0),
      missingItems: Number(maintenance.missingCount || 0)
    },
    maintenance
  };
}

export async function getAdminHealth(env: Env) {
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
  let b2Error: string | null = null;

  try {
    await checkB2Access(env);
    b2Ok = true;
  } catch (error) {
    b2Error = error instanceof Error ? error.message : "No disponible";
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

function isOlderThanSafety(value: unknown) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) && timestamp <= Date.now() - ORPHAN_SAFETY_SECONDS * 1000;
}

export async function reconcileStorage(env: Env) {
  const [listing, rowsResult] = await Promise.all([
    listB2VersionsByPrefix(env, "drop/", 50),
    env.DB.prepare(`
      SELECT id, status, storage_key AS storageKey, created_at AS createdAt, size
      FROM drop_items
      WHERE type = 'file' AND storage_key IS NOT NULL
    `).all()
  ]);
  const rows = (rowsResult.results || []) as Array<{
    id: string;
    status: string;
    storageKey: string | null;
    createdAt: string;
    size: number;
  }>;
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

export async function maybeReconcileStorage(env: Env) {
  const maintenance = await getMaintenanceState(env.DB);
  const last = Date.parse(String(maintenance.lastReconcileAt || ""));

  if (Number.isFinite(last) && last + RECONCILE_INTERVAL_SECONDS * 1000 > Date.now()) {
    return { skipped: true };
  }

  return reconcileStorage(env);
}

export async function deleteAdminStatistics(env: Env) {
  return clearUsageStatistics(env.DB);
}

async function purgeB2Storage(env: Env) {
  let listing;

  try {
    listing = await listB2VersionsByPrefix(env, "drop/", 50);
  } catch (error) {
    console.error("No fue posible enumerar B2 durante el reinicio.", error);
    return {
      complete: false,
      scanned: 0,
      deleted: 0,
      deleteFailures: 1,
      remainingVersions: -1,
      truncated: false
    };
  }

  let deleted = 0;
  let deleteFailures = 0;

  for (const entry of listing.entries) {
    try {
      await deleteB2Version(env, entry.key, entry.versionId);
      deleted += 1;
    } catch (error) {
      deleteFailures += 1;
      console.error("No fue posible eliminar una versión de B2 durante el reinicio.", entry.key, error);
    }
  }

  let verification;

  try {
    verification = await listB2VersionsByPrefix(env, "drop/", 2);
  } catch (error) {
    console.error("No fue posible verificar B2 después del reinicio.", error);
    return {
      complete: false,
      scanned: listing.entries.length,
      deleted,
      deleteFailures: deleteFailures + 1,
      remainingVersions: -1,
      truncated: listing.truncated
    };
  }

  const remainingVersions = verification.entries.length;
  const complete = !listing.truncated
    && deleteFailures === 0
    && !verification.truncated
    && remainingVersions === 0;

  return {
    complete,
    scanned: listing.entries.length,
    deleted,
    deleteFailures,
    remainingVersions,
    truncated: listing.truncated || verification.truncated
  };
}

export async function resetAdminSystem(env: Env) {
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
  const storage = await purgeB2Storage(env);
  await env.DB.prepare(`DELETE FROM rate_limits`).run();
  const [remainingItems, remainingRooms] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM drop_items`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM rooms WHERE status = 'active'`).first<{ count: number }>()
  ]);
  const remainingItemCount = Number(remainingItems?.count || 0);
  const remainingRoomCount = Number(remainingRooms?.count || 0);
  const storageFailures = storage.complete
    ? 0
    : Math.max(1, storage.deleteFailures, storage.remainingVersions > 0 ? storage.remainingVersions : 0);
  const failed = Number(items.failed || 0) + remainingItemCount + remainingRoomCount + storageFailures;
  await recordCleanupState(env.DB, failed);

  return {
    rooms: { scanned: rooms.length, closed, deleted: roomDeleted, failed: roomFailures },
    items,
    storage,
    verification: {
      remainingItems: remainingItemCount,
      activeRooms: remainingRoomCount,
      remainingStorageVersions: storage.remainingVersions,
      storageComplete: storage.complete
    },
    failed
  };
}
