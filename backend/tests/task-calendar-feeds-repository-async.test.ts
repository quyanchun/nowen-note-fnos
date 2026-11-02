/**
 * taskCalendarFeedsRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-task-cal-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { taskCalendarFeedsRepository } from "../src/repositories/taskCalendarFeedsRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-tcf";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
}

function clean() {
  getDb().prepare("DELETE FROM task_calendar_feeds").run();
}

test("createAsync inserts feed", async () => {
  clean();
  seedBase();
  await taskCalendarFeedsRepository.createAsync({ id: "feed-1", userId: USER_ID, token: "tok-1" });
  const row = getDb().prepare("SELECT * FROM task_calendar_feeds WHERE id = ?").get("feed-1") as any;
  assert.ok(row);
  assert.equal(row.token, "tok-1");
  assert.equal(row.enabled, 1);
  assert.equal(row.includeCompleted, 0);
  assert.equal(row.includeDescription, 1);
  assert.equal(row.defaultAlarmMinutes, 30);
  clean();
});

test("getByUserAsync returns feed", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 1, 0, 1, 30)").run("feed-gu", USER_ID, "tok-gu");
  const row = await taskCalendarFeedsRepository.getByUserAsync(USER_ID);
  assert.ok(row);
  assert.equal(row.id, "feed-gu");
  clean();
});

test("getByUserAsync returns undefined when not found", async () => {
  clean();
  const row = await taskCalendarFeedsRepository.getByUserAsync("no-such-user");
  assert.equal(row, undefined);
});

test("getByTokenAsync returns feed", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 1, 0, 1, 30)").run("feed-gtk", USER_ID, "tok-gtk");
  const row = await taskCalendarFeedsRepository.getByTokenAsync("tok-gtk");
  assert.ok(row);
  assert.equal(row.id, "feed-gtk");
  clean();
});

test("getEnabledByTokenAsync returns enabled feed", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 1, 0, 1, 30)").run("feed-ge", USER_ID, "tok-ge");
  const row = await taskCalendarFeedsRepository.getEnabledByTokenAsync("tok-ge");
  assert.ok(row);
  assert.equal(row.id, "feed-ge");
  clean();
});

test("getEnabledByTokenAsync returns undefined for disabled feed", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 0, 0, 1, 30)").run("feed-dis", USER_ID, "tok-dis");
  const row = await taskCalendarFeedsRepository.getEnabledByTokenAsync("tok-dis");
  assert.equal(row, undefined);
  clean();
});

test("getByIdAndUserAsync returns id for valid user", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 1, 0, 1, 30)").run("feed-gibu", USER_ID, "tok-gibu");
  const row = await taskCalendarFeedsRepository.getByIdAndUserAsync("feed-gibu", USER_ID);
  assert.ok(row);
  assert.equal(row.id, "feed-gibu");
  clean();
});

test("getByIdAndUserAsync returns undefined for wrong user", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 1, 0, 1, 30)").run("feed-wrong", USER_ID, "tok-wrong");
  const row = await taskCalendarFeedsRepository.getByIdAndUserAsync("feed-wrong", "other-user");
  assert.equal(row, undefined);
  clean();
});

test("getByIdAsync returns feed", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 1, 0, 1, 30)").run("feed-gbi", USER_ID, "tok-gbi");
  const row = await taskCalendarFeedsRepository.getByIdAsync("feed-gbi");
  assert.ok(row);
  assert.equal(row.token, "tok-gbi");
  clean();
});

test("enableAsync enables feed", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 0, 0, 1, 30)").run("feed-en", USER_ID, "tok-en");
  await taskCalendarFeedsRepository.enableAsync("feed-en");
  const row = getDb().prepare("SELECT enabled FROM task_calendar_feeds WHERE id = ?").get("feed-en") as any;
  assert.equal(row.enabled, 1);
  clean();
});

test("updateAsync updates allowed fields", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 1, 0, 1, 30)").run("feed-upd", USER_ID, "tok-upd");
  await taskCalendarFeedsRepository.updateAsync("feed-upd", { includeCompleted: 1, defaultAlarmMinutes: 60 });
  const row = getDb().prepare("SELECT includeCompleted, defaultAlarmMinutes FROM task_calendar_feeds WHERE id = ?").get("feed-upd") as any;
  assert.equal(row.includeCompleted, 1);
  assert.equal(row.defaultAlarmMinutes, 60);
  clean();
});

test("updateAsync with empty patch is no-op", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 1, 0, 1, 30)").run("feed-nop", USER_ID, "tok-nop");
  await taskCalendarFeedsRepository.updateAsync("feed-nop", {});
  const row = getDb().prepare("SELECT includeCompleted FROM task_calendar_feeds WHERE id = ?").get("feed-nop") as any;
  assert.equal(row.includeCompleted, 0);
  clean();
});

test("regenerateTokenAsync updates token", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 1, 0, 1, 30)").run("feed-regen", USER_ID, "tok-old");
  await taskCalendarFeedsRepository.regenerateTokenAsync("feed-regen", "tok-new");
  const row = getDb().prepare("SELECT token FROM task_calendar_feeds WHERE id = ?").get("feed-regen") as any;
  assert.equal(row.token, "tok-new");
  clean();
});

test("updateLastAccessedAtAsync updates timestamp", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 1, 0, 1, 30)").run("feed-acc", USER_ID, "tok-acc");
  await taskCalendarFeedsRepository.updateLastAccessedAtAsync("feed-acc");
  const row = getDb().prepare("SELECT lastAccessedAt FROM task_calendar_feeds WHERE id = ?").get("feed-acc") as any;
  assert.ok(row.lastAccessedAt);
  clean();
});

test("getEnabledAndTokenByIdAndUserAsync returns fields", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes) VALUES (?, ?, ?, 1, 0, 1, 30)").run("feed-et", USER_ID, "tok-et");
  const row = await taskCalendarFeedsRepository.getEnabledAndTokenByIdAndUserAsync("feed-et", USER_ID);
  assert.ok(row);
  assert.equal(row.enabled, 1);
  assert.equal(row.token, "tok-et");
  clean();
});
