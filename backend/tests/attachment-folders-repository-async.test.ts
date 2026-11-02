/**
 * attachmentFoldersRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-att-folders-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { attachmentFoldersRepository } from "../src/repositories/attachmentFoldersRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-af";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
}

function clean() {
  getDb().prepare("DELETE FROM attachment_folders").run();
}

test("createAsync inserts folder", async () => {
  clean();
  seedBase();
  await attachmentFoldersRepository.createAsync({ id: "af-1", userId: USER_ID, name: "Photos", parentId: null });
  const row = getDb().prepare("SELECT * FROM attachment_folders WHERE id = ?").get("af-1") as any;
  assert.ok(row);
  assert.equal(row.name, "Photos");
  assert.equal(row.parentId, null);
  clean();
});

test("listByUserAsync returns folders", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)").run("af-a", USER_ID, "Zebra", null);
  getDb().prepare("INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)").run("af-b", USER_ID, "Alpha", null);
  const rows = await attachmentFoldersRepository.listByUserAsync(USER_ID);
  assert.ok(rows.length >= 2);
  // ORDER BY name COLLATE NOCASE
  const names = rows.map((r: any) => r.name);
  assert.ok(names.indexOf("Alpha") < names.indexOf("Zebra"));
  clean();
});

test("listByUserAsync returns empty for user without folders", async () => {
  clean();
  const rows = await attachmentFoldersRepository.listByUserAsync("no-such-user");
  assert.equal(rows.length, 0);
});

test("getByIdAsync returns folder", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)").run("af-find", USER_ID, "Found", null);
  const row = await attachmentFoldersRepository.getByIdAsync("af-find", USER_ID);
  assert.ok(row);
  assert.equal(row.id, "af-find");
  clean();
});

test("getByIdAsync returns undefined for wrong user", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)").run("af-other", USER_ID, "Other", null);
  const row = await attachmentFoldersRepository.getByIdAsync("af-other", "wrong-user");
  assert.equal(row, undefined);
  clean();
});

test("existsByNameAsync detects duplicate", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)").run("af-dup", USER_ID, "Dup", null);
  const exists = await attachmentFoldersRepository.existsByNameAsync(USER_ID, "Dup", null);
  assert.equal(exists, true);
  clean();
});

test("existsByNameAsync excludes self on update", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)").run("af-exc", USER_ID, "Exc", null);
  const exists = await attachmentFoldersRepository.existsByNameAsync(USER_ID, "Exc", null, "af-exc");
  assert.equal(exists, false);
  clean();
});

test("parentExistsAsync returns true for valid parent", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)").run("af-par", USER_ID, "Parent", null);
  const exists = await attachmentFoldersRepository.parentExistsAsync("af-par", USER_ID);
  assert.equal(exists, true);
  clean();
});

test("parentExistsAsync returns false for wrong user", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)").run("af-p2", USER_ID, "P2", null);
  const exists = await attachmentFoldersRepository.parentExistsAsync("af-p2", "wrong-user");
  assert.equal(exists, false);
  clean();
});

test("updateNameAsync updates folder name", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)").run("af-upd", USER_ID, "Old", null);
  await attachmentFoldersRepository.updateNameAsync("af-upd", "New");
  const row = getDb().prepare("SELECT name FROM attachment_folders WHERE id = ?").get("af-upd") as any;
  assert.equal(row.name, "New");
  clean();
});

test("deleteAsync removes folder", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)").run("af-del", USER_ID, "Del", null);
  await attachmentFoldersRepository.deleteAsync("af-del");
  const row = getDb().prepare("SELECT id FROM attachment_folders WHERE id = ?").get("af-del");
  assert.equal(row, undefined);
  clean();
});
