import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cancelFileUpload } from "../worker/src/services/items.ts";
import {
  getRecentUsage,
  getTodayUsage,
  incrementUsage
} from "../worker/src/services/usage.ts";
import { TestD1 } from "./d1-test-helper.js";

const baseline = readFileSync(new URL("../worker/migrations/0001_baseline.sql", import.meta.url), "utf8");
const tuning = readFileSync(new URL("../worker/migrations/0002_product_tuning.sql", import.meta.url), "utf8");
const schema = `${baseline}\n${tuning}`;

test("las métricas administrativas persisten en D1 y agregan siete días", async () => {
  const db = new TestD1(schema);
  const today = new Date();
  const sixDaysAgo = new Date(today.getTime() - 6 * 86400000);

  try {
    await incrementUsage(db, { uploads_count: 2, upload_bytes: 2048, file_count: 2 }, today);

    const failedUploadId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO drop_items (
        id, type, status, name, size, mime_type, storage_key, created_at, expires_at,
        ttl_minutes, updated_at, space_type, room_id
      ) VALUES (?1, 'file', 'pending', 'fallo.bin', 10, 'application/octet-stream', NULL, ?2, ?3, 5, ?2, 'personal', NULL)
    `).bind(
      failedUploadId,
      today.toISOString(),
      new Date(today.getTime() + 20 * 60_000).toISOString()
    ).run();
    await cancelFileUpload({ DB: db }, failedUploadId, undefined, { recordFailure: true });

    await incrementUsage(db, { uploads_count: 3, upload_bytes: 4096, cleanup_failures: 1 }, sixDaysAgo);

    const stored = await db.prepare(`
      SELECT uploads_count AS uploadsCount, upload_bytes AS uploadBytes, failed_uploads AS failedUploads
      FROM usage_daily
      WHERE date = ?1
    `).bind(today.toISOString().slice(0, 10)).first();

    assert.deepEqual(stored, {
      uploadsCount: 2,
      uploadBytes: 2048,
      failedUploads: 1
    });

    const current = await getTodayUsage(db);
    assert.equal(current.uploadsCount, 2);
    assert.equal(current.uploadBytes, 2048);
    assert.equal(current.failedUploads, 1);

    const week = await getRecentUsage(db, 7);
    assert.equal(week.uploadsCount, 5);
    assert.equal(week.uploadBytes, 6144);
    assert.equal(week.failedUploads, 1);
    assert.equal(week.cleanupFailures, 1);
  } finally {
    db.close();
  }
});
