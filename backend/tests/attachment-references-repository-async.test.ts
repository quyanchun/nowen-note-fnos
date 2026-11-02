/**
 * attachmentReferencesRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-att-refs-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { attachmentReferencesRepository } from "../src/repositories/attachmentReferencesRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-ar";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
  getDb().prepare("INSERT OR IGNORE INTO notebooks (id, userId, name) VALUES (?, ?, ?)").run("nb-ar", USER_ID, "NB");
  getDb().prepare("INSERT OR IGNORE INTO notes (id, userId, notebookId, title) VALUES (?, ?, ?, ?)").run("n-ar", USER_ID, "nb-ar", "Note");
  getDb().prepare("INSERT OR IGNORE INTO attachments (id, noteId, userId, filename, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?, ?)").run("att-ar", "n-ar", USER_ID, "f.txt", "text/plain", 100, "/f.txt");
  getDb().prepare("INSERT OR IGNORE INTO attachments (id, noteId, userId, filename, mimeType, size, path) VALUES (?, ?, ?, ?, ?, ?, ?)").run("att-ar2", "n-ar", USER_ID, "f2.txt", "text/plain", 200, "/f2.txt");
}

function clean() {
  getDb().prepare("DELETE FROM attachment_references").run();
}

test("listByNoteIdAsync returns attachment ids", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_references (attachmentId, noteId) VALUES (?, ?)").run("att-ar", "n-ar");
  getDb().prepare("INSERT INTO attachment_references (attachmentId, noteId) VALUES (?, ?)").run("att-ar2", "n-ar");
  const ids = await attachmentReferencesRepository.listByNoteIdAsync("n-ar");
  assert.ok(ids.includes("att-ar"));
  assert.ok(ids.includes("att-ar2"));
  assert.equal(ids.length, 2);
  clean();
});

test("listByNoteIdAsync returns empty for note without references", async () => {
  clean();
  const ids = await attachmentReferencesRepository.listByNoteIdAsync("no-such-note");
  assert.deepEqual(ids, []);
});

test("addReferencesAsync adds references", async () => {
  clean();
  seedBase();
  await attachmentReferencesRepository.addReferencesAsync("n-ar", ["att-ar", "att-ar2"]);
  const ids = await attachmentReferencesRepository.listByNoteIdAsync("n-ar");
  assert.equal(ids.length, 2);
  clean();
});

test("addReferencesAsync with empty array is no-op", async () => {
  clean();
  seedBase();
  await attachmentReferencesRepository.addReferencesAsync("n-ar", []);
  const ids = await attachmentReferencesRepository.listByNoteIdAsync("n-ar");
  assert.equal(ids.length, 0);
});

test("addReferencesAsync ignores duplicates", async () => {
  clean();
  seedBase();
  await attachmentReferencesRepository.addReferencesAsync("n-ar", ["att-ar"]);
  await attachmentReferencesRepository.addReferencesAsync("n-ar", ["att-ar"]); // duplicate
  const ids = await attachmentReferencesRepository.listByNoteIdAsync("n-ar");
  assert.equal(ids.length, 1);
  clean();
});

test("removeReferencesAsync removes specified references", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_references (attachmentId, noteId) VALUES (?, ?)").run("att-ar", "n-ar");
  getDb().prepare("INSERT INTO attachment_references (attachmentId, noteId) VALUES (?, ?)").run("att-ar2", "n-ar");
  const removed = await attachmentReferencesRepository.removeReferencesAsync("n-ar", ["att-ar"]);
  assert.equal(removed, 1);
  const ids = await attachmentReferencesRepository.listByNoteIdAsync("n-ar");
  assert.deepEqual(ids, ["att-ar2"]);
  clean();
});

test("removeReferencesAsync with empty array returns 0", async () => {
  clean();
  const removed = await attachmentReferencesRepository.removeReferencesAsync("n-ar", []);
  assert.equal(removed, 0);
});

test("isReferencedByNoteAsync returns true when referenced", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_references (attachmentId, noteId) VALUES (?, ?)").run("att-ar", "n-ar");
  const result = await attachmentReferencesRepository.isReferencedByNoteAsync("att-ar", "n-ar");
  assert.equal(result, true);
  clean();
});

test("isReferencedByNoteAsync returns false when not referenced", async () => {
  clean();
  const result = await attachmentReferencesRepository.isReferencedByNoteAsync("att-ar", "n-ar");
  assert.equal(result, false);
});

test("isReferencedAsync returns true when referenced by any note", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO attachment_references (attachmentId, noteId) VALUES (?, ?)").run("att-ar", "n-ar");
  const result = await attachmentReferencesRepository.isReferencedAsync("att-ar");
  assert.equal(result, true);
  clean();
});

test("isReferencedAsync returns false when not referenced", async () => {
  clean();
  const result = await attachmentReferencesRepository.isReferencedAsync("att-ar");
  assert.equal(result, false);
});
