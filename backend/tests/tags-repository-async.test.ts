/**
 * tagsRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-tags-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { tagsRepository } from "../src/repositories/tagsRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-tags";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
}

function clean() {
  getDb().prepare("DELETE FROM note_tags").run();
  getDb().prepare("DELETE FROM tags").run();
}

test("createAsync inserts tag", async () => {
  clean();
  seedBase();
  await tagsRepository.createAsync({ id: "tag-1", userId: USER_ID, workspaceId: null, name: "Work", color: "#f00" });
  const row = getDb().prepare("SELECT * FROM tags WHERE id = ?").get("tag-1") as any;
  assert.ok(row);
  assert.equal(row.name, "Work");
  assert.equal(row.color, "#f00");
  clean();
});

test("getByIdAsync returns tag", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("tag-find", USER_ID, null, "Found", "#0f0");
  const row = await tagsRepository.getByIdAsync("tag-find");
  assert.ok(row);
  assert.equal(row.name, "Found");
  clean();
});

test("getByIdAsync returns undefined when not found", async () => {
  clean();
  const row = await tagsRepository.getByIdAsync("nonexistent");
  assert.equal(row, undefined);
});

test("getOwnerAsync returns owner", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("tag-own", USER_ID, null, "Own", "#00f");
  const row = await tagsRepository.getOwnerAsync("tag-own");
  assert.ok(row);
  assert.equal(row.userId, USER_ID);
  clean();
});

test("getByIdWithCountAsync returns tag with noteCount", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("tag-cnt", USER_ID, null, "Cnt", "#fff");
  const row = await tagsRepository.getByIdWithCountAsync("tag-cnt");
  assert.ok(row);
  assert.equal(row.noteCount, 0);
  clean();
});

test("listByUserAsync returns user tags", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("tag-a", USER_ID, null, "Alpha", "#a00");
  getDb().prepare("INSERT INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("tag-b", USER_ID, null, "Beta", "#b00");
  const rows = await tagsRepository.listByUserAsync(USER_ID, null, true);
  assert.ok(rows.length >= 2);
  // ORDER BY name ASC
  const names = rows.map((r: any) => r.name);
  assert.ok(names.indexOf("Alpha") < names.indexOf("Beta"));
  clean();
});

test("updateByIdAsync updates name", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("tag-upd", USER_ID, null, "Old", "#000");
  await tagsRepository.updateByIdAsync("tag-upd", { name: "New" });
  const row = getDb().prepare("SELECT name FROM tags WHERE id = ?").get("tag-upd") as any;
  assert.equal(row.name, "New");
  clean();
});

test("updateByIdAsync with empty patch is no-op", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("tag-nop", USER_ID, null, "Same", "#111");
  await tagsRepository.updateByIdAsync("tag-nop", {});
  const row = getDb().prepare("SELECT name FROM tags WHERE id = ?").get("tag-nop") as any;
  assert.equal(row.name, "Same");
  clean();
});

test("deleteByIdAsync removes tag", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("tag-del", USER_ID, null, "Del", "#222");
  await tagsRepository.deleteByIdAsync("tag-del");
  const row = getDb().prepare("SELECT id FROM tags WHERE id = ?").get("tag-del");
  assert.equal(row, undefined);
  clean();
});

test("deleteTagLinksAsync removes note_tags", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("tag-lnk", USER_ID, null, "Lnk", "#333");
  getDb().prepare("INSERT OR IGNORE INTO notebooks (id, userId, name) VALUES (?, ?, ?)").run("nb-t", USER_ID, "NB");
  getDb().prepare("INSERT OR IGNORE INTO notes (id, userId, notebookId, title) VALUES (?, ?, ?, ?)").run("n-t", USER_ID, "nb-t", "Note");
  getDb().prepare("INSERT INTO note_tags (noteId, tagId) VALUES (?, ?)").run("n-t", "tag-lnk");
  await tagsRepository.deleteTagLinksAsync("tag-lnk");
  const links = getDb().prepare("SELECT * FROM note_tags WHERE tagId = ?").all("tag-lnk");
  assert.equal(links.length, 0);
  clean();
});
