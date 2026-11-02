/**
 * mindmapFoldersRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-mindmap-folders-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { mindmapFoldersRepository } from "../src/repositories/mindmapFoldersRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-mf";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
}

function clean() {
  getDb().prepare("DELETE FROM mindmap_folders").run();
}

test("createAsync inserts folder", async () => {
  clean();
  seedBase();
  await mindmapFoldersRepository.createAsync({ id: "mf-1", userId: USER_ID, workspaceId: null, parentId: null, name: "Root" });
  const row = getDb().prepare("SELECT * FROM mindmap_folders WHERE id = ?").get("mf-1") as any;
  assert.ok(row);
  assert.equal(row.name, "Root");
  assert.equal(row.parentId, null);
  clean();
});

test("getByIdAsync returns folder", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name) VALUES (?, ?, ?, ?, ?)").run("mf-find", USER_ID, null, null, "Found");
  const row = await mindmapFoldersRepository.getByIdAsync("mf-find");
  assert.ok(row);
  assert.equal(row.name, "Found");
  clean();
});

test("getByIdAsync returns undefined when not found", async () => {
  clean();
  const row = await mindmapFoldersRepository.getByIdAsync("nonexistent");
  assert.equal(row, undefined);
});

test("listByUserAsync returns folders sorted by sortOrder, name", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name, sortOrder) VALUES (?, ?, ?, ?, ?, ?)").run("mf-z", USER_ID, null, null, "Zebra", 2);
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name, sortOrder) VALUES (?, ?, ?, ?, ?, ?)").run("mf-a", USER_ID, null, null, "Alpha", 1);
  const rows = await mindmapFoldersRepository.listByUserAsync(USER_ID, null);
  assert.ok(rows.length >= 2);
  // sortOrder ASC, then name ASC
  assert.equal(rows[0].id, "mf-a");
  assert.equal(rows[1].id, "mf-z");
  clean();
});

test("listByUserAsync returns empty for user without folders", async () => {
  clean();
  const rows = await mindmapFoldersRepository.listByUserAsync("no-such-user", null);
  assert.equal(rows.length, 0);
});

test("updateNameAsync updates folder name", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name) VALUES (?, ?, ?, ?, ?)").run("mf-upd", USER_ID, null, null, "Old");
  await mindmapFoldersRepository.updateNameAsync("mf-upd", "New");
  const row = getDb().prepare("SELECT name FROM mindmap_folders WHERE id = ?").get("mf-upd") as any;
  assert.equal(row.name, "New");
  clean();
});

test("updateParentIdAsync updates parentId", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name) VALUES (?, ?, ?, ?, ?)").run("mf-parent", USER_ID, null, null, "Parent");
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name) VALUES (?, ?, ?, ?, ?)").run("mf-child", USER_ID, null, null, "Child");
  await mindmapFoldersRepository.updateParentIdAsync("mf-child", "mf-parent");
  const row = getDb().prepare("SELECT parentId FROM mindmap_folders WHERE id = ?").get("mf-child") as any;
  assert.equal(row.parentId, "mf-parent");
  clean();
});

test("updateSortOrderAsync updates sortOrder", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name, sortOrder) VALUES (?, ?, ?, ?, ?, ?)").run("mf-sort", USER_ID, null, null, "Sort", 0);
  await mindmapFoldersRepository.updateSortOrderAsync("mf-sort", 99);
  const row = getDb().prepare("SELECT sortOrder FROM mindmap_folders WHERE id = ?").get("mf-sort") as any;
  assert.equal(row.sortOrder, 99);
  clean();
});

test("getFolderDepthAsync returns 0 for null", async () => {
  clean();
  const depth = await mindmapFoldersRepository.getFolderDepthAsync(null);
  assert.equal(depth, 0);
});

test("getFolderDepthAsync returns correct depth", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name) VALUES (?, ?, ?, ?, ?)").run("mf-l1", USER_ID, null, null, "L1");
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name) VALUES (?, ?, ?, ?, ?)").run("mf-l2", USER_ID, null, "mf-l1", "L2");
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name) VALUES (?, ?, ?, ?, ?)").run("mf-l3", USER_ID, null, "mf-l2", "L3");
  const depth = await mindmapFoldersRepository.getFolderDepthAsync("mf-l3");
  assert.equal(depth, 3);
  clean();
});

test("deleteAsync removes folder and moves children to root", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name) VALUES (?, ?, ?, ?, ?)").run("mf-delp", USER_ID, null, null, "ToDelete");
  getDb().prepare("INSERT INTO mindmap_folders (id, userId, workspaceId, parentId, name) VALUES (?, ?, ?, ?, ?)").run("mf-delc", USER_ID, null, "mf-delp", "Child");
  await mindmapFoldersRepository.deleteAsync("mf-delp");
  const parent = getDb().prepare("SELECT id FROM mindmap_folders WHERE id = ?").get("mf-delp");
  assert.equal(parent, undefined);
  const child = getDb().prepare("SELECT parentId FROM mindmap_folders WHERE id = ?").get("mf-delc") as any;
  assert.equal(child.parentId, null);
  clean();
});
