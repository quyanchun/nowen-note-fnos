/**
 * noteVersionsRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-note-ver-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { noteVersionsRepository } from "../src/repositories/noteVersionsRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-nv";
const NOTE_ID = "note-nv";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
  getDb().prepare("INSERT OR IGNORE INTO notebooks (id, userId, name) VALUES (?, ?, ?)").run("nb-nv", USER_ID, "NB");
  getDb().prepare("INSERT OR IGNORE INTO notes (id, userId, notebookId, title) VALUES (?, ?, ?, ?)").run(NOTE_ID, USER_ID, "nb-nv", "Note");
}

function clean() {
  getDb().prepare("DELETE FROM note_versions").run();
}

test("createAsync inserts version", async () => {
  clean();
  seedBase();
  await noteVersionsRepository.createAsync({
    id: "v-1", noteId: NOTE_ID, userId: USER_ID,
    title: "V1", content: "{}", contentText: "text",
    version: 1, changeType: "edit",
  });
  const row = getDb().prepare("SELECT * FROM note_versions WHERE id = ?").get("v-1") as any;
  assert.ok(row);
  assert.equal(row.version, 1);
  assert.equal(row.changeType, "edit");
  clean();
});

test("createAsync stores contentFormat for markdown versions", async () => {
  clean();
  seedBase();
  await noteVersionsRepository.createAsync({
    id: "v-md", noteId: NOTE_ID, userId: USER_ID,
    title: "Markdown", content: "# Title", contentText: "Title",
    contentFormat: "markdown",
    version: 1, changeType: "edit",
  });
  const row = await noteVersionsRepository.getByIdAndNoteIdAsync("v-md", NOTE_ID);
  assert.ok(row);
  assert.equal(row.contentFormat, "markdown");
  clean();
});

test("createAsync with changeSummary", async () => {
  clean();
  seedBase();
  await noteVersionsRepository.createAsync({
    id: "v-cs", noteId: NOTE_ID, userId: USER_ID,
    title: "V", content: "{}", contentText: "t",
    version: 1, changeType: "edit", changeSummary: "summary",
  });
  const row = getDb().prepare("SELECT changeSummary FROM note_versions WHERE id = ?").get("v-cs") as any;
  assert.equal(row.changeSummary, "summary");
  clean();
});

test("createAsync with createdAt", async () => {
  clean();
  seedBase();
  await noteVersionsRepository.createAsync({
    id: "v-ca", noteId: NOTE_ID, userId: USER_ID,
    title: "V", content: "{}", contentText: "t",
    version: 1, changeType: "edit", createdAt: "2025-01-01T00:00:00",
  });
  const row = getDb().prepare("SELECT createdAt FROM note_versions WHERE id = ?").get("v-ca") as any;
  assert.equal(row.createdAt, "2025-01-01T00:00:00");
  clean();
});

test("createAsync with both changeSummary and createdAt", async () => {
  clean();
  seedBase();
  await noteVersionsRepository.createAsync({
    id: "v-both", noteId: NOTE_ID, userId: USER_ID,
    title: "V", content: "{}", contentText: "t",
    version: 1, changeType: "edit", changeSummary: "s", createdAt: "2025-06-01T00:00:00",
  });
  const row = getDb().prepare("SELECT changeSummary, createdAt FROM note_versions WHERE id = ?").get("v-both") as any;
  assert.equal(row.changeSummary, "s");
  assert.equal(row.createdAt, "2025-06-01T00:00:00");
  clean();
});

test("listByNoteIdAsync returns versions sorted by version DESC", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-a", NOTE_ID, USER_ID, "V1", "{}", "t", 1, "edit");
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-b", NOTE_ID, USER_ID, "V2", "{}", "t", 2, "edit");
  const rows = await noteVersionsRepository.listByNoteIdAsync(NOTE_ID, 10, 0);
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].version, 2); // DESC
  assert.equal(rows[1].version, 1);
  clean();
});

test("listByNoteIdAsync returns empty for note without versions", async () => {
  clean();
  const rows = await noteVersionsRepository.listByNoteIdAsync("no-such-note", 10, 0);
  assert.equal(rows.length, 0);
});

test("countByNoteIdAsync returns count", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-c1", NOTE_ID, USER_ID, "V1", "{}", "t", 1, "edit");
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-c2", NOTE_ID, USER_ID, "V2", "{}", "t", 2, "edit");
  const count = await noteVersionsRepository.countByNoteIdAsync(NOTE_ID);
  assert.equal(count, 2);
  clean();
});

test("getByIdAndNoteIdAsync returns version", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-find", NOTE_ID, USER_ID, "V", "{}", "t", 1, "edit");
  const row = await noteVersionsRepository.getByIdAndNoteIdAsync("v-find", NOTE_ID);
  assert.ok(row);
  assert.equal(row.version, 1);
  clean();
});

test("getByIdAndNoteIdAsync returns undefined for wrong noteId", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-wrong", NOTE_ID, USER_ID, "V", "{}", "t", 1, "edit");
  const row = await noteVersionsRepository.getByIdAndNoteIdAsync("v-wrong", "other-note");
  assert.equal(row, undefined);
  clean();
});

test("getLastEditByNoteIdAsync returns last edit version", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("v-e1", NOTE_ID, USER_ID, "V1", "{}", "t", 1, "edit", "2025-01-01");
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("v-e2", NOTE_ID, USER_ID, "V2", "{}", "t", 2, "edit", "2025-06-01");
  const row = await noteVersionsRepository.getLastEditByNoteIdAsync(NOTE_ID);
  assert.ok(row);
  assert.equal(row.createdAt, "2025-06-01"); // latest
  clean();
});

test("deleteByNoteIdAsync deletes all versions for note", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-d1", NOTE_ID, USER_ID, "V1", "{}", "t", 1, "edit");
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-d2", NOTE_ID, USER_ID, "V2", "{}", "t", 2, "edit");
  const deleted = await noteVersionsRepository.deleteByNoteIdAsync(NOTE_ID);
  assert.equal(deleted, 2);
  clean();
});

test("listByNoteIdsAsync returns versions for multiple notes", async () => {
  clean();
  seedBase();
  const noteId2 = "note-nv2";
  getDb().prepare("INSERT OR IGNORE INTO notes (id, userId, notebookId, title) VALUES (?, ?, ?, ?)").run(noteId2, USER_ID, "nb-nv", "Note2");
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-m1", NOTE_ID, USER_ID, "V1", "{}", "t", 1, "edit");
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-m2", noteId2, USER_ID, "V2", "{}", "t", 1, "edit");
  const rows = await noteVersionsRepository.listByNoteIdsAsync([NOTE_ID, noteId2]);
  assert.equal(rows.length, 2);
  clean();
});

test("listByNoteIdsAsync with empty array returns empty", async () => {
  clean();
  const rows = await noteVersionsRepository.listByNoteIdsAsync([]);
  assert.deepEqual(rows, []);
});

test("countByUserAsync returns count", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-cu", NOTE_ID, USER_ID, "V", "{}", "t", 1, "edit");
  const count = await noteVersionsRepository.countByUserAsync(USER_ID);
  assert.ok(count >= 1);
  clean();
});

test("transferOwnershipAsync transfers versions", async () => {
  clean();
  seedBase();
  const newUserId = "user-nv-new";
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(newUserId, newUserId, "hash");
  getDb().prepare("INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("v-tr", NOTE_ID, USER_ID, "V", "{}", "t", 1, "edit");
  const transferred = await noteVersionsRepository.transferOwnershipAsync(USER_ID, newUserId);
  assert.ok(transferred >= 1);
  clean();
});
