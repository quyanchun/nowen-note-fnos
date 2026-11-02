/**
 * noteYupdatesRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-note-yupd-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { noteYupdatesRepository } from "../src/repositories/noteYupdatesRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-yu";
const NOTE_ID = "note-yu";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
  getDb().prepare("INSERT OR IGNORE INTO notebooks (id, userId, name) VALUES (?, ?, ?)").run("nb-yu", USER_ID, "NB");
  getDb().prepare("INSERT OR IGNORE INTO notes (id, userId, notebookId, title) VALUES (?, ?, ?, ?)").run(NOTE_ID, USER_ID, "nb-yu", "Note");
}

function clean() {
  getDb().prepare("DELETE FROM note_yupdates").run();
}

test("createAsync inserts update and returns lastInsertRowid", async () => {
  clean();
  seedBase();
  const id1 = await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("update1"));
  assert.ok(id1 > 0);
  const id2 = await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("update2"));
  assert.ok(id2 > id1); // auto-increment
  clean();
});

test("listAfterIdAsync returns updates after specified id", async () => {
  clean();
  seedBase();
  const id1 = await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("u1"));
  const id2 = await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("u2"));
  const id3 = await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("u3"));
  const rows = await noteYupdatesRepository.listAfterIdAsync(NOTE_ID, id1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, id2);
  assert.equal(rows[1].id, id3);
  clean();
});

test("listAfterIdAsync returns empty for note without updates", async () => {
  clean();
  const rows = await noteYupdatesRepository.listAfterIdAsync("no-such-note", 0);
  assert.equal(rows.length, 0);
});

test("getMaxIdAsync returns max id", async () => {
  clean();
  seedBase();
  await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("u1"));
  const id2 = await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("u2"));
  const row = await noteYupdatesRepository.getMaxIdAsync(NOTE_ID);
  assert.ok(row);
  assert.equal(row.maxId, id2);
  clean();
});

test("getMaxIdAsync returns undefined for note without updates", async () => {
  clean();
  const row = await noteYupdatesRepository.getMaxIdAsync("no-such-note");
  assert.ok(row);
  assert.equal(row.maxId, null);
});

test("deleteUpToAsync deletes updates up to specified id", async () => {
  clean();
  seedBase();
  const id1 = await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("u1"));
  const id2 = await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("u2"));
  const id3 = await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("u3"));
  await noteYupdatesRepository.deleteUpToAsync(NOTE_ID, id2);
  const rows = await noteYupdatesRepository.listAfterIdAsync(NOTE_ID, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id3);
  clean();
});

test("deleteByNoteIdAsync deletes all updates for note", async () => {
  clean();
  seedBase();
  await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("u1"));
  await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("u2"));
  await noteYupdatesRepository.deleteByNoteIdAsync(NOTE_ID);
  const rows = await noteYupdatesRepository.listAfterIdAsync(NOTE_ID, 0);
  assert.equal(rows.length, 0);
  clean();
});

test("transferOwnershipAsync transfers updates", async () => {
  clean();
  seedBase();
  const newUserId = "user-yu-new";
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(newUserId, newUserId, "hash");
  await noteYupdatesRepository.createAsync(NOTE_ID, USER_ID, Buffer.from("u1"));
  const transferred = await noteYupdatesRepository.transferOwnershipAsync(USER_ID, newUserId);
  assert.ok(transferred >= 1);
  clean();
});
