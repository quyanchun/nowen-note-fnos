/**
 * embeddingQueueRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-embed-q-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { embeddingQueueRepository } from "../src/repositories/embeddingQueueRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-eq";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
  getDb().prepare("INSERT OR IGNORE INTO notebooks (id, userId, name) VALUES (?, ?, ?)").run("nb-eq", USER_ID, "NB");
}

function clean() {
  getDb().prepare("DELETE FROM embedding_queue").run();
}

function seedNote(noteId: string) {
  // Insert note (trigger may auto-create queue entry)
  getDb().prepare("INSERT OR IGNORE INTO notes (id, userId, notebookId, title, contentText) VALUES (?, ?, ?, ?, ?)").run(noteId, USER_ID, "nb-eq", "Note", "some content");
  // Clean auto-created queue entry so test can control the state
  getDb().prepare("DELETE FROM embedding_queue WHERE noteId = ?").run(noteId);
}

test("listPendingAsync returns pending items", async () => {
  clean();
  seedBase();
  seedNote("n-p1");
  seedNote("n-p2");
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'pending', 0)").run("n-p1", USER_ID);
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'pending', 0)").run("n-p2", USER_ID);
  const rows = await embeddingQueueRepository.listPendingAsync(3, 10);
  assert.ok(rows.length >= 2);
  clean();
});

test("listPendingAsync respects limit", async () => {
  clean();
  seedBase();
  seedNote("n-lim1");
  seedNote("n-lim2");
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'pending', 0)").run("n-lim1", USER_ID);
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'pending', 0)").run("n-lim2", USER_ID);
  const rows = await embeddingQueueRepository.listPendingAsync(3, 1);
  assert.equal(rows.length, 1);
  clean();
});

test("listPendingAsync skips items with retries >= maxRetries", async () => {
  clean();
  seedBase();
  seedNote("n-retry");
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'pending', 5)").run("n-retry", USER_ID);
  const rows = await embeddingQueueRepository.listPendingAsync(3, 10);
  assert.equal(rows.length, 0);
  clean();
});

test("markDoneAsync sets status to done", async () => {
  clean();
  seedBase();
  seedNote("n-done");
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'processing', 0)").run("n-done", USER_ID);
  await embeddingQueueRepository.markDoneAsync("n-done");
  const row = getDb().prepare("SELECT status, lastError FROM embedding_queue WHERE noteId = ?").get("n-done") as any;
  assert.equal(row.status, "done");
  assert.equal(row.lastError, null);
  clean();
});

test("markSkippedAsync sets status and error message", async () => {
  clean();
  seedBase();
  seedNote("n-skip");
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'pending', 0)").run("n-skip", USER_ID);
  await embeddingQueueRepository.markSkippedAsync("n-skip");
  const row = getDb().prepare("SELECT status, lastError FROM embedding_queue WHERE noteId = ?").get("n-skip") as any;
  assert.equal(row.status, "done");
  assert.ok(row.lastError.includes("skipped"));
  clean();
});

test("markProcessingAsync sets status to processing", async () => {
  clean();
  seedBase();
  seedNote("n-proc");
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'pending', 0)").run("n-proc", USER_ID);
  await embeddingQueueRepository.markProcessingAsync("n-proc");
  const row = getDb().prepare("SELECT status FROM embedding_queue WHERE noteId = ?").get("n-proc") as any;
  assert.equal(row.status, "processing");
  clean();
});

test("updateStatusAsync updates all fields", async () => {
  clean();
  seedBase();
  seedNote("n-upd");
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'pending', 0)").run("n-upd", USER_ID);
  await embeddingQueueRepository.updateStatusAsync("n-upd", "failed", 3, "API error");
  const row = getDb().prepare("SELECT status, retries, lastError FROM embedding_queue WHERE noteId = ?").get("n-upd") as any;
  assert.equal(row.status, "failed");
  assert.equal(row.retries, 3);
  assert.equal(row.lastError, "API error");
  clean();
});

test("deleteByNoteIdAsync removes queue item", async () => {
  clean();
  seedBase();
  seedNote("n-del");
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'pending', 0)").run("n-del", USER_ID);
  await embeddingQueueRepository.deleteByNoteIdAsync("n-del");
  const row = getDb().prepare("SELECT noteId FROM embedding_queue WHERE noteId = ?").get("n-del");
  assert.equal(row, undefined);
  clean();
});

test("countByWhereAsync returns count", async () => {
  clean();
  seedBase();
  seedNote("n-cnt");
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'pending', 0)").run("n-cnt", USER_ID);
  const count = await embeddingQueueRepository.countByWhereAsync("status = ?", ["pending"]);
  assert.ok(count >= 1);
  clean();
});

test("countByStatusAsync returns status groups", async () => {
  clean();
  seedBase();
  seedNote("n-s1");
  seedNote("n-s2");
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'pending', 0)").run("n-s1", USER_ID);
  getDb().prepare("INSERT INTO embedding_queue (noteId, userId, status, retries) VALUES (?, ?, 'done', 0)").run("n-s2", USER_ID);
  const groups = await embeddingQueueRepository.countByStatusAsync("", []);
  assert.ok(groups.length >= 2);
  clean();
});
