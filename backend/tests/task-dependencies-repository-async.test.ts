/**
 * taskDependenciesRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-task-dep-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { taskDependenciesRepository } from "../src/repositories/taskDependenciesRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-td";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
  getDb().prepare("INSERT OR IGNORE INTO tasks (id, userId, title) VALUES (?, ?, ?)").run("t1", USER_ID, "Task 1");
  getDb().prepare("INSERT OR IGNORE INTO tasks (id, userId, title) VALUES (?, ?, ?)").run("t2", USER_ID, "Task 2");
  getDb().prepare("INSERT OR IGNORE INTO tasks (id, userId, title) VALUES (?, ?, ?)").run("t3", USER_ID, "Task 3");
}

function clean() {
  getDb().prepare("DELETE FROM task_dependencies").run();
}

test("createAsync inserts dependency", async () => {
  clean();
  seedBase();
  await taskDependenciesRepository.createAsync({
    id: "dep-1", userId: USER_ID, workspaceId: null,
    predecessorTaskId: "t1", successorTaskId: "t2", type: "finish_to_start",
  });
  const row = getDb().prepare("SELECT * FROM task_dependencies WHERE id = ?").get("dep-1") as any;
  assert.ok(row);
  assert.equal(row.predecessorTaskId, "t1");
  assert.equal(row.successorTaskId, "t2");
  assert.equal(row.type, "finish_to_start");
  clean();
});

test("getByIdAsync returns dependency", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-find", USER_ID, null, "t1", "t2", "finish_to_start");
  const row = await taskDependenciesRepository.getByIdAsync("dep-find");
  assert.ok(row);
  assert.equal(row.predecessorTaskId, "t1");
  clean();
});

test("getByIdAsync returns undefined when not found", async () => {
  clean();
  const row = await taskDependenciesRepository.getByIdAsync("nonexistent");
  assert.equal(row, undefined);
});

test("listSuccessorsAsync returns successor task ids", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-s1", USER_ID, null, "t1", "t2", "finish_to_start");
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-s2", USER_ID, null, "t1", "t3", "finish_to_start");
  const successors = await taskDependenciesRepository.listSuccessorsAsync("t1");
  assert.ok(successors.includes("t2"));
  assert.ok(successors.includes("t3"));
  assert.equal(successors.length, 2);
  clean();
});

test("listSuccessorsAsync returns empty for task without successors", async () => {
  clean();
  const successors = await taskDependenciesRepository.listSuccessorsAsync("no-such-task");
  assert.deepEqual(successors, []);
});

test("listByTaskAsync returns dependencies involving task", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-lt1", USER_ID, null, "t1", "t2", "finish_to_start");
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-lt2", USER_ID, null, "t2", "t3", "finish_to_start");
  const rows = await taskDependenciesRepository.listByTaskAsync("t2", USER_ID, null);
  assert.ok(rows.length >= 2); // t2 appears as both successor and predecessor
  clean();
});

test("listByWorkspaceAsync returns all workspace dependencies", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-lw1", USER_ID, null, "t1", "t2", "finish_to_start");
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-lw2", USER_ID, null, "t2", "t3", "finish_to_start");
  const rows = await taskDependenciesRepository.listByWorkspaceAsync(USER_ID, null);
  assert.ok(rows.length >= 2);
  clean();
});

test("existsAsync returns true when dependency exists", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-ex", USER_ID, null, "t1", "t2", "finish_to_start");
  const exists = await taskDependenciesRepository.existsAsync("t1", "t2", "finish_to_start");
  assert.equal(exists, true);
  clean();
});

test("existsAsync returns false when dependency does not exist", async () => {
  clean();
  const exists = await taskDependenciesRepository.existsAsync("t1", "t2", "finish_to_start");
  assert.equal(exists, false);
});

test("deleteAsync removes dependency", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-del", USER_ID, null, "t1", "t2", "finish_to_start");
  await taskDependenciesRepository.deleteAsync("dep-del");
  const row = getDb().prepare("SELECT id FROM task_dependencies WHERE id = ?").get("dep-del");
  assert.equal(row, undefined);
  clean();
});

test("deleteByTaskIdsAsync removes all dependencies involving task ids", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-dbt1", USER_ID, null, "t1", "t2", "finish_to_start");
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-dbt2", USER_ID, null, "t2", "t3", "finish_to_start");
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-dbt3", USER_ID, null, "t3", "t1", "finish_to_start");
  await taskDependenciesRepository.deleteByTaskIdsAsync(["t1", "t2"]);
  // dep-dbt1 involves t1 and t2 -> deleted
  // dep-dbt2 involves t2 -> deleted
  // dep-dbt3 involves t1 -> deleted
  const rows = getDb().prepare("SELECT * FROM task_dependencies").all();
  assert.equal(rows.length, 0);
  clean();
});

test("deleteByTaskIdsAsync with empty array is no-op", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO task_dependencies (id, userId, workspaceId, predecessorTaskId, successorTaskId, type) VALUES (?, ?, ?, ?, ?, ?)").run("dep-eno", USER_ID, null, "t1", "t2", "finish_to_start");
  await taskDependenciesRepository.deleteByTaskIdsAsync([]);
  const rows = getDb().prepare("SELECT * FROM task_dependencies").all();
  assert.equal(rows.length, 1);
  clean();
});
