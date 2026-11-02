/**
 * noteTagsRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-note-tags-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { noteTagsRepository } from "../src/repositories/noteTagsRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-nt";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
  getDb().prepare("INSERT OR IGNORE INTO notebooks (id, userId, name) VALUES (?, ?, ?)").run("nb-nt", USER_ID, "NB");
  getDb().prepare("INSERT OR IGNORE INTO notes (id, userId, notebookId, title) VALUES (?, ?, ?, ?)").run("n-nt", USER_ID, "nb-nt", "Note");
  getDb().prepare("INSERT OR IGNORE INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("t1", USER_ID, null, "Tag1", "#f00");
  getDb().prepare("INSERT OR IGNORE INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("t2", USER_ID, null, "Tag2", "#0f0");
  getDb().prepare("INSERT OR IGNORE INTO tags (id, userId, workspaceId, name, color) VALUES (?, ?, ?, ?, ?)").run("t3", USER_ID, null, "Tag3", "#00f");
}

function clean() {
  getDb().prepare("DELETE FROM note_tags").run();
}

test("addTagToNoteAsync adds binding", async () => {
  clean();
  seedBase();
  await noteTagsRepository.addTagToNoteAsync("n-nt", "t1");
  const rows = getDb().prepare("SELECT * FROM note_tags WHERE noteId = ? AND tagId = ?").all("n-nt", "t1");
  assert.equal(rows.length, 1);
  clean();
});

test("addTagToNoteAsync ignores duplicate", async () => {
  clean();
  seedBase();
  await noteTagsRepository.addTagToNoteAsync("n-nt", "t1");
  await noteTagsRepository.addTagToNoteAsync("n-nt", "t1"); // duplicate
  const rows = getDb().prepare("SELECT * FROM note_tags WHERE noteId = ? AND tagId = ?").all("n-nt", "t1");
  assert.equal(rows.length, 1);
  clean();
});

test("removeTagFromNoteAsync removes binding", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO note_tags (noteId, tagId) VALUES (?, ?)").run("n-nt", "t1");
  await noteTagsRepository.removeTagFromNoteAsync("n-nt", "t1");
  const rows = getDb().prepare("SELECT * FROM note_tags WHERE noteId = ? AND tagId = ?").all("n-nt", "t1");
  assert.equal(rows.length, 0);
  clean();
});

test("removeTagFromNoteAsync no-op when not exists", async () => {
  clean();
  seedBase();
  await noteTagsRepository.removeTagFromNoteAsync("n-nt", "t1"); // no-op
  // should not throw
  clean();
});

test("listTagsByNoteIdAsync returns tags", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO note_tags (noteId, tagId) VALUES (?, ?)").run("n-nt", "t1");
  getDb().prepare("INSERT INTO note_tags (noteId, tagId) VALUES (?, ?)").run("n-nt", "t2");
  const tags = await noteTagsRepository.listTagsByNoteIdAsync("n-nt");
  assert.equal(tags.length, 2);
  const names = tags.map((t: any) => t.name).sort();
  assert.deepEqual(names, ["Tag1", "Tag2"]);
  clean();
});

test("listTagsByNoteIdAsync returns empty for note without tags", async () => {
  clean();
  const tags = await noteTagsRepository.listTagsByNoteIdAsync("n-nt");
  assert.equal(tags.length, 0);
});

test("listNoteIdsByTagFilterAsync OR mode", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT OR IGNORE INTO notes (id, userId, notebookId, title) VALUES (?, ?, ?, ?)").run("n2", USER_ID, "nb-nt", "Note2");
  getDb().prepare("INSERT INTO note_tags (noteId, tagId) VALUES (?, ?)").run("n-nt", "t1");
  getDb().prepare("INSERT INTO note_tags (noteId, tagId) VALUES (?, ?)").run("n2", "t2");
  const ids = await noteTagsRepository.listNoteIdsByTagFilterAsync(["t1", "t2"], "or");
  assert.ok(ids.includes("n-nt"));
  assert.ok(ids.includes("n2"));
  clean();
});

test("listNoteIdsByTagFilterAsync AND mode", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO note_tags (noteId, tagId) VALUES (?, ?)").run("n-nt", "t1");
  getDb().prepare("INSERT INTO note_tags (noteId, tagId) VALUES (?, ?)").run("n-nt", "t2");
  const ids = await noteTagsRepository.listNoteIdsByTagFilterAsync(["t1", "t2"], "and");
  assert.ok(ids.includes("n-nt"));
  assert.equal(ids.length, 1);
  clean();
});

test("listNoteIdsByTagFilterAsync empty array returns empty", async () => {
  clean();
  const ids = await noteTagsRepository.listNoteIdsByTagFilterAsync([]);
  assert.deepEqual(ids, []);
});
