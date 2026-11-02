/**
 * shareCommentsRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-share-cmt-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { shareCommentsRepository } from "../src/repositories/shareCommentsRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-sc";
const NOTE_ID = "note-sc";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
  getDb().prepare("INSERT OR IGNORE INTO notebooks (id, userId, name) VALUES (?, ?, ?)").run("nb-sc", USER_ID, "NB");
  getDb().prepare("INSERT OR IGNORE INTO notes (id, userId, notebookId, title) VALUES (?, ?, ?, ?)").run(NOTE_ID, USER_ID, "nb-sc", "Note");
}

function clean() {
  getDb().prepare("DELETE FROM share_comments").run();
}

test("createAsync creates comment with userId", async () => {
  clean();
  seedBase();
  await shareCommentsRepository.createAsync({
    id: "c-1", noteId: NOTE_ID, userId: USER_ID, content: "Hello",
  });
  const row = getDb().prepare("SELECT * FROM share_comments WHERE id = ?").get("c-1") as any;
  assert.ok(row);
  assert.equal(row.content, "Hello");
  assert.equal(row.userId, USER_ID);
  assert.equal(row.guestName, null);
  clean();
});

test("createAsync creates guest comment", async () => {
  clean();
  seedBase();
  await shareCommentsRepository.createAsync({
    id: "c-guest", noteId: NOTE_ID, userId: null, guestName: "Guest", content: "Hi",
  });
  const row = getDb().prepare("SELECT * FROM share_comments WHERE id = ?").get("c-guest") as any;
  assert.ok(row);
  assert.equal(row.userId, null);
  assert.equal(row.guestName, "Guest");
  clean();
});

test("getByIdAsync returns comment", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content) VALUES (?, ?, ?, ?)").run("c-find", NOTE_ID, USER_ID, "Found");
  const row = await shareCommentsRepository.getByIdAsync("c-find");
  assert.ok(row);
  assert.equal(row.userId, USER_ID);
  clean();
});

test("getByIdAsync returns undefined when not found", async () => {
  clean();
  const row = await shareCommentsRepository.getByIdAsync("nonexistent");
  assert.equal(row, undefined);
});

test("getResolvedAsync returns resolved status", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content, isResolved) VALUES (?, ?, ?, ?, ?)").run("c-res", NOTE_ID, USER_ID, "R", 1);
  const row = await shareCommentsRepository.getResolvedAsync("c-res");
  assert.ok(row);
  assert.equal(row.isResolved, 1);
  clean();
});

test("updateResolvedAsync updates resolved status", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content, isResolved) VALUES (?, ?, ?, ?, ?)").run("c-updres", NOTE_ID, USER_ID, "U", 0);
  await shareCommentsRepository.updateResolvedAsync("c-updres", 1);
  const row = getDb().prepare("SELECT isResolved FROM share_comments WHERE id = ?").get("c-updres") as any;
  assert.equal(row.isResolved, 1);
  clean();
});

test("deleteAsync removes comment", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content) VALUES (?, ?, ?, ?)").run("c-del", NOTE_ID, USER_ID, "Del");
  await shareCommentsRepository.deleteAsync("c-del");
  const row = getDb().prepare("SELECT id FROM share_comments WHERE id = ?").get("c-del");
  assert.equal(row, undefined);
  clean();
});

test("countByUserAsync returns count", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content) VALUES (?, ?, ?, ?)").run("c-cnt1", NOTE_ID, USER_ID, "A");
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content) VALUES (?, ?, ?, ?)").run("c-cnt2", NOTE_ID, USER_ID, "B");
  const count = await shareCommentsRepository.countByUserAsync(USER_ID);
  assert.ok(count >= 2);
  clean();
});

test("transferOwnershipAsync transfers comments", async () => {
  clean();
  seedBase();
  const newUserId = "user-sc-new";
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(newUserId, newUserId, "hash");
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content) VALUES (?, ?, ?, ?)").run("c-tr", NOTE_ID, USER_ID, "T");
  const transferred = await shareCommentsRepository.transferOwnershipAsync(USER_ID, newUserId);
  assert.ok(transferred >= 1);
  const row = getDb().prepare("SELECT userId FROM share_comments WHERE id = ?").get("c-tr") as any;
  assert.equal(row.userId, newUserId);
  clean();
});

test("listByNoteIdWithUserAsync returns comments with user info", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content) VALUES (?, ?, ?, ?)").run("c-l1", NOTE_ID, USER_ID, "First");
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content) VALUES (?, ?, ?, ?)").run("c-l2", NOTE_ID, USER_ID, "Second");
  const rows = await shareCommentsRepository.listByNoteIdWithUserAsync(NOTE_ID);
  assert.ok(rows.length >= 2);
  assert.ok(rows[0].username);
  clean();
});

test("getByIdWithUserAsync returns comment with user info", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content) VALUES (?, ?, ?, ?)").run("c-gu", NOTE_ID, USER_ID, "GU");
  const row = await shareCommentsRepository.getByIdWithUserAsync("c-gu");
  assert.ok(row);
  assert.ok(row.username);
  clean();
});

test("listByNoteIdWithUserForPublicAsync returns comments with displayName", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content) VALUES (?, ?, ?, ?)").run("c-pub", NOTE_ID, USER_ID, "Pub");
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, guestName, content) VALUES (?, ?, ?, ?, ?)").run("c-pubg", NOTE_ID, null, "GuestUser", "PubG");
  const rows = await shareCommentsRepository.listByNoteIdWithUserForPublicAsync(NOTE_ID);
  assert.ok(rows.length >= 2);
  const userComment = rows.find((r: any) => r.id === "c-pub");
  assert.ok(userComment);
  assert.ok(userComment.displayName);
  const guestComment = rows.find((r: any) => r.id === "c-pubg");
  assert.ok(guestComment);
  assert.equal(guestComment.isGuest, 1);
  clean();
});

test("getByIdWithUserForPublicAsync returns comment with displayName", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO share_comments (id, noteId, userId, content) VALUES (?, ?, ?, ?)").run("c-gup", NOTE_ID, USER_ID, "GUP");
  const row = await shareCommentsRepository.getByIdWithUserForPublicAsync("c-gup");
  assert.ok(row);
  assert.ok(row.displayName);
  clean();
});
