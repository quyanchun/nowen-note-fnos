/**
 * diaryAttachmentsRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-diary-att-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { diaryAttachmentsRepository } from "../src/repositories/diaryAttachmentsRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-da";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
  getDb().prepare("INSERT OR IGNORE INTO diaries (id, userId, contentText) VALUES (?, ?, ?)").run("d1", USER_ID, "diary content");
}

function clean() {
  getDb().prepare("DELETE FROM diary_attachments").run();
}

test("createAsync inserts attachment", async () => {
  clean();
  seedBase();
  await diaryAttachmentsRepository.createAsync({
    id: "da-1", userId: USER_ID, workspaceId: null,
    mimeType: "image/png", size: 1024, path: "/img.png",
  });
  const row = getDb().prepare("SELECT * FROM diary_attachments WHERE id = ?").get("da-1") as any;
  assert.ok(row);
  assert.equal(row.mimeType, "image/png");
  assert.equal(row.size, 1024);
  assert.equal(row.diaryId, null);
  clean();
});

test("getByIdAsync returns attachment", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?)").run("da-find", "d1", USER_ID, "text/plain", 50, "/x.txt");
  const row = await diaryAttachmentsRepository.getByIdAsync("da-find");
  assert.ok(row);
  assert.equal(row.mimeType, "text/plain");
  clean();
});

test("getByIdAsync returns undefined when not found", async () => {
  clean();
  const row = await diaryAttachmentsRepository.getByIdAsync("nonexistent");
  assert.equal(row, undefined);
});

test("getByIdForDeleteAsync returns full record", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?)").run("da-delinfo", "d1", USER_ID, "text/plain", 50, "/x.txt");
  const row = await diaryAttachmentsRepository.getByIdForDeleteAsync("da-delinfo");
  assert.ok(row);
  assert.equal(row.userId, USER_ID);
  assert.equal(row.diaryId, "d1");
  clean();
});

test("listIdsByDiaryIdAsync returns attachment ids", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?)").run("da-l1", "d1", USER_ID, "text/plain", 10, "/a");
  getDb().prepare("INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?)").run("da-l2", "d1", USER_ID, "text/plain", 20, "/b");
  const ids = await diaryAttachmentsRepository.listIdsByDiaryIdAsync("d1");
  assert.ok(ids.includes("da-l1"));
  assert.ok(ids.includes("da-l2"));
  assert.equal(ids.length, 2);
  clean();
});

test("listIdsByDiaryIdAsync returns empty for diary without attachments", async () => {
  clean();
  const ids = await diaryAttachmentsRepository.listIdsByDiaryIdAsync("no-such-diary");
  assert.deepEqual(ids, []);
});

test("countOrphansAsync counts orphan attachments", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?)").run("da-orp", null, USER_ID, "text/plain", 10, "/o");
  const count = await diaryAttachmentsRepository.countOrphansAsync(USER_ID, null);
  assert.ok(count >= 1);
  clean();
});

test("countOrphansAsync returns 0 when no orphans", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?)").run("da-no", "d1", USER_ID, "text/plain", 10, "/n");
  const count = await diaryAttachmentsRepository.countOrphansAsync(USER_ID, null);
  assert.equal(count, 0);
  clean();
});

test("deleteAsync removes attachment", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?)").run("da-del", "d1", USER_ID, "text/plain", 10, "/d");
  await diaryAttachmentsRepository.deleteAsync("da-del");
  const row = getDb().prepare("SELECT id FROM diary_attachments WHERE id = ?").get("da-del");
  assert.equal(row, undefined);
  clean();
});

test("deleteByIdsAsync deletes multiple attachments", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?)").run("da-d1", "d1", USER_ID, "text/plain", 10, "/a");
  getDb().prepare("INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?)").run("da-d2", "d1", USER_ID, "text/plain", 20, "/b");
  getDb().prepare("INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?)").run("da-d3", "d1", USER_ID, "text/plain", 30, "/c");
  const removed = await diaryAttachmentsRepository.deleteByIdsAsync(["da-d1", "da-d3"]);
  assert.equal(removed, 2);
  const row = getDb().prepare("SELECT id FROM diary_attachments WHERE id = ?").get("da-d2");
  assert.ok(row);
  clean();
});

test("deleteByIdsAsync with empty array returns 0", async () => {
  clean();
  const removed = await diaryAttachmentsRepository.deleteByIdsAsync([]);
  assert.equal(removed, 0);
});

test("listExpiredOrphansAsync returns expired orphan ids", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run("da-exp", null, USER_ID, "text/plain", 10, "/e", "2020-01-01T00:00:00");
  const ids = await diaryAttachmentsRepository.listExpiredOrphansAsync("2025-01-01T00:00:00");
  assert.ok(ids.includes("da-exp"));
  clean();
});
