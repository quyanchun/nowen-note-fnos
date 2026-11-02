/**
 * taskAttachmentsRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-task-att-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { taskAttachmentsRepository } from "../src/repositories/taskAttachmentsRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-ta";
const TASK_ID = "task-ta";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
  getDb().prepare("INSERT OR IGNORE INTO tasks (id, userId, title) VALUES (?, ?, ?)").run(TASK_ID, USER_ID, "Task");
}

function clean() {
  getDb().prepare("DELETE FROM task_attachments").run();
}

test("createAsync inserts attachment", async () => {
  clean();
  seedBase();
  await taskAttachmentsRepository.createAsync({
    id: "att-1", taskId: TASK_ID, userId: USER_ID, workspaceId: null,
    filename: "file.txt", mimeType: "text/plain", size: 100, path: "/tmp/file.txt",
  });
  const row = getDb().prepare("SELECT * FROM task_attachments WHERE id = ?").get("att-1") as any;
  assert.ok(row);
  assert.equal(row.filename, "file.txt");
  assert.equal(row.mimeType, "text/plain");
  clean();
});

test("getByIdAsync returns attachment", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_attachments (id, taskId, userId, filename, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?, ?)").run("att-find", TASK_ID, USER_ID, "doc.pdf", "application/pdf", 500, "/tmp/doc.pdf");
  const row = await taskAttachmentsRepository.getByIdAsync("att-find");
  assert.ok(row);
  assert.equal(row.filename, "doc.pdf");
  assert.equal(row.mimeType, "application/pdf");
  clean();
});

test("getByIdAsync returns undefined when not found", async () => {
  clean();
  const row = await taskAttachmentsRepository.getByIdAsync("nonexistent");
  assert.equal(row, undefined);
});

test("getByIdForPermissionAsync returns userId", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_attachments (id, taskId, userId, filename, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?, ?)").run("att-perm", TASK_ID, USER_ID, "x.txt", "text/plain", 10, "/x");
  const row = await taskAttachmentsRepository.getByIdForPermissionAsync("att-perm");
  assert.ok(row);
  assert.equal(row.userId, USER_ID);
  clean();
});

test("getByIdForDeleteAsync returns full record", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_attachments (id, taskId, userId, filename, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?, ?)").run("att-delinfo", TASK_ID, USER_ID, "y.txt", "text/plain", 20, "/y");
  const row = await taskAttachmentsRepository.getByIdForDeleteAsync("att-delinfo");
  assert.ok(row);
  assert.equal(row.taskId, TASK_ID);
  assert.equal(row.path, "/y");
  clean();
});

test("updateTaskAssociationAsync updates taskId", async () => {
  clean();
  seedBase();
  const newTaskId = "task-ta-new";
  getDb().prepare("INSERT OR IGNORE INTO tasks (id, userId, title) VALUES (?, ?, ?)").run(newTaskId, USER_ID, "New Task");
  getDb().prepare("INSERT INTO task_attachments (id, taskId, userId, filename, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?, ?)").run("att-reassoc", TASK_ID, USER_ID, "z.txt", "text/plain", 30, "/z");
  await taskAttachmentsRepository.updateTaskAssociationAsync("att-reassoc", newTaskId, null);
  const row = getDb().prepare("SELECT taskId FROM task_attachments WHERE id = ?").get("att-reassoc") as any;
  assert.equal(row.taskId, newTaskId);
  clean();
});

test("deleteAsync removes attachment", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_attachments (id, taskId, userId, filename, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?, ?)").run("att-del", TASK_ID, USER_ID, "d.txt", "text/plain", 40, "/d");
  await taskAttachmentsRepository.deleteAsync("att-del");
  const row = getDb().prepare("SELECT id FROM task_attachments WHERE id = ?").get("att-del");
  assert.equal(row, undefined);
  clean();
});

test("listAllForBackupAsync returns all attachments", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_attachments (id, taskId, userId, filename, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?, ?)").run("att-b1", TASK_ID, USER_ID, "a.txt", "text/plain", 10, "/a");
  getDb().prepare("INSERT INTO task_attachments (id, taskId, userId, filename, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?, ?)").run("att-b2", TASK_ID, USER_ID, "b.txt", "text/plain", 20, "/b");
  const rows = await taskAttachmentsRepository.listAllForBackupAsync();
  assert.ok(rows.length >= 2);
  clean();
});

test("listAllPathsAsync returns all paths", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_attachments (id, taskId, userId, filename, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?, ?)").run("att-p1", TASK_ID, USER_ID, "c.txt", "text/plain", 10, "/c");
  getDb().prepare("INSERT INTO task_attachments (id, taskId, userId, filename, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?, ?)").run("att-p2", TASK_ID, USER_ID, "d.txt", "text/plain", 20, "/d");
  const paths = await taskAttachmentsRepository.listAllPathsAsync();
  assert.ok(paths.includes("/c"));
  assert.ok(paths.includes("/d"));
  clean();
});
