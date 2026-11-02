/**
 * calendarExportTargetsRepository async 方法行为测试
 *
 * 使用临时 DB_PATH，不访问真实用户数据。
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-calendar-targets-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { calendarExportTargetsRepository } from "../src/repositories/calendarExportTargetsRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-cal";
const FEED_ID = "feed-1";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
  getDb().prepare(`INSERT OR IGNORE INTO task_calendar_feeds (id, userId, token, enabled)
    VALUES (?, ?, ?, ?)`).run(FEED_ID, USER_ID, `token-${FEED_ID}`, 1);
}

function cleanTargets() {
  getDb().prepare("DELETE FROM calendar_export_targets").run();
}

function seedTarget(overrides: Partial<{ id: string; userId: string; feedId: string; type: string; enabled: number; name: string; configJson: string }> = {}) {
  const id = overrides.id ?? `tgt-${Date.now()}`;
  const userId = overrides.userId ?? USER_ID;
  const feedId = overrides.feedId ?? FEED_ID;
  const type = overrides.type ?? "ical";
  const enabled = overrides.enabled ?? 1;
  const name = overrides.name ?? "Test Target";
  const configJson = overrides.configJson ?? "{}";
  try {
    getDb().prepare(
      `INSERT INTO calendar_export_targets (id, userId, feedId, type, enabled, name, configJson)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, feedId, type, enabled, name, configJson);
  } catch (e: any) {
    console.error("seedTarget error:", e.message, e.code, "table exists:", getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='calendar_export_targets'").get());
    throw e;
  }
  return { id, userId, feedId, type, enabled, name, configJson };
}

test("getDb works", () => {
  const db = getDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
  assert.ok(tables.length > 0, "Should have tables");
  assert.ok(tables.some((t: any) => t.name === "users"), "Should have users table");
  assert.ok(tables.some((t: any) => t.name === "calendar_export_targets"), "Should have calendar_export_targets table");
  assert.ok(tables.some((t: any) => t.name === "task_calendar_feeds"), "Should have task_calendar_feeds table");
});

test("listByUserAsync returns user targets", async () => {
  cleanTargets();
  seedBase();
  // 使用不同秒数确保排序可验证
  getDb().prepare(
    `INSERT INTO calendar_export_targets (id, userId, feedId, type, enabled, name, configJson, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-10 seconds'))`,
  ).run("t1", USER_ID, FEED_ID, "ical", 1, "Alpha", "{}");
  getDb().prepare(
    `INSERT INTO calendar_export_targets (id, userId, feedId, type, enabled, name, configJson, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run("t2", USER_ID, FEED_ID, "ical", 1, "Beta", "{}");

  const rows = await calendarExportTargetsRepository.listByUserAsync(USER_ID);
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].id, "t2"); // 最新在前
  assert.equal(typeof rows[0].enabled, "boolean");

  cleanTargets();
});

test("listByUserAsync does not return other user targets", async () => {
  cleanTargets();
  seedBase();
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run("other", "other", "hash");
  getDb().prepare(`INSERT OR IGNORE INTO task_calendar_feeds (id, userId, token, enabled)
    VALUES (?, ?, ?, ?)`).run("feed-other", "other", "token-feed-other", 1);
  seedTarget({ id: "t-mine" });
  seedTarget({ id: "t-other", userId: "other", feedId: "feed-other" });

  const rows = await calendarExportTargetsRepository.listByUserAsync(USER_ID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "t-mine");

  cleanTargets();
});

test("getByIdAndUserAsync returns target by id and userId", async () => {
  cleanTargets();
  seedBase();
  seedTarget({ id: "t-find" });

  const row = await calendarExportTargetsRepository.getByIdAndUserAsync("t-find", USER_ID);
  assert.ok(row);
  assert.equal(row.id, "t-find");
  assert.equal(typeof row.enabled, "boolean");

  cleanTargets();
});

test("getByIdAndUserAsync returns undefined for other user", async () => {
  cleanTargets();
  seedBase();
  seedTarget({ id: "t-find" });

  const row = await calendarExportTargetsRepository.getByIdAndUserAsync("t-find", "other");
  assert.equal(row, undefined);

  cleanTargets();
});

test("listEnabledAsync returns only enabled targets", async () => {
  cleanTargets();
  seedBase();
  seedTarget({ id: "t-enabled", enabled: 1 });
  seedTarget({ id: "t-disabled", enabled: 0 });

  const rows = await calendarExportTargetsRepository.listEnabledAsync();
  assert.ok(rows.length >= 1);
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes("t-enabled"));
  assert.ok(!ids.includes("t-disabled"));

  cleanTargets();
});

test("createAsync inserts target", async () => {
  cleanTargets();
  seedBase();
  await calendarExportTargetsRepository.createAsync({
    id: "t-create",
    userId: USER_ID,
    feedId: FEED_ID,
    type: "ical",
    enabled: 1,
    name: "Created",
    configJson: '{"url":"https://example.com"}',
  });

  const row = getDb().prepare("SELECT * FROM calendar_export_targets WHERE id = ?").get("t-create") as any;
  assert.ok(row);
  assert.equal(row.name, "Created");
  assert.equal(row.userId, USER_ID);

  cleanTargets();
});

test("updateByIdAndUserAsync updates allowed fields", async () => {
  cleanTargets();
  seedBase();
  seedTarget({ id: "t-update", name: "Old Name" });

  await calendarExportTargetsRepository.updateByIdAndUserAsync("t-update", USER_ID, {
    name: "New Name",
    enabled: 0,
  });

  const row = getDb().prepare("SELECT name, enabled FROM calendar_export_targets WHERE id = ?").get("t-update") as any;
  assert.equal(row.name, "New Name");
  assert.equal(row.enabled, 0);

  cleanTargets();
});

test("updateByIdAndUserAsync does not update other user target", async () => {
  cleanTargets();
  seedBase();
  seedTarget({ id: "t-update", name: "Original" });

  await calendarExportTargetsRepository.updateByIdAndUserAsync("t-update", "other", {
    name: "Hacked",
  });

  const row = getDb().prepare("SELECT name FROM calendar_export_targets WHERE id = ?").get("t-update") as any;
  assert.equal(row.name, "Original");

  cleanTargets();
});

test("updateStatusByIdAsync updates export status", async () => {
  cleanTargets();
  seedBase();
  seedTarget({ id: "t-status" });

  await calendarExportTargetsRepository.updateStatusByIdAsync("t-status", {
    lastStatus: "success",
    publicUrl: "https://cal.example.com/export.ics",
  });

  const row = getDb().prepare("SELECT lastStatus, publicUrl, lastExportAt FROM calendar_export_targets WHERE id = ?").get("t-status") as any;
  assert.equal(row.lastStatus, "success");
  assert.equal(row.publicUrl, "https://cal.example.com/export.ics");
  assert.ok(row.lastExportAt);

  cleanTargets();
});

test("deleteByIdAndUserAsync returns true when deleted", async () => {
  cleanTargets();
  seedBase();
  seedTarget({ id: "t-del" });

  const result = await calendarExportTargetsRepository.deleteByIdAndUserAsync("t-del", USER_ID);
  assert.equal(result, true);

  const row = getDb().prepare("SELECT id FROM calendar_export_targets WHERE id = ?").get("t-del");
  assert.equal(row, undefined);
});

test("deleteByIdAndUserAsync returns false for other user", async () => {
  cleanTargets();
  seedBase();
  seedTarget({ id: "t-del" });

  const result = await calendarExportTargetsRepository.deleteByIdAndUserAsync("t-del", "other");
  assert.equal(result, false);

  const row = getDb().prepare("SELECT id FROM calendar_export_targets WHERE id = ?").get("t-del");
  assert.ok(row); // 仍存在

  cleanTargets();
});

test("deleteByIdAndUserAsync returns false for nonexistent", async () => {
  cleanTargets();
  seedBase();

  const result = await calendarExportTargetsRepository.deleteByIdAndUserAsync("nonexistent", USER_ID);
  assert.equal(result, false);
});
