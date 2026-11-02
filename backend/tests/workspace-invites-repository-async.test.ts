/**
 * workspaceInvitesRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-ws-inv-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { workspaceInvitesRepository } from "../src/repositories/workspaceInvitesRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-wi";
const WS_ID = "ws-wi";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
  getDb().prepare("INSERT OR IGNORE INTO workspaces (id, name, ownerId) VALUES (?, ?, ?)").run(WS_ID, "Workspace", USER_ID);
}

function clean() {
  getDb().prepare("DELETE FROM workspace_invites").run();
}

test("createAsync inserts invite", async () => {
  clean();
  seedBase();
  await workspaceInvitesRepository.createAsync({
    id: "inv-1", workspaceId: WS_ID, code: "ABC123",
    role: "viewer", maxUses: 10, expiresAt: null, createdBy: USER_ID,
  });
  const row = getDb().prepare("SELECT * FROM workspace_invites WHERE id = ?").get("inv-1") as any;
  assert.ok(row);
  assert.equal(row.code, "ABC123");
  assert.equal(row.role, "viewer");
  assert.equal(row.maxUses, 10);
  assert.equal(row.useCount, 0);
  clean();
});

test("getByIdAsync returns invite", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO workspace_invites (id, workspaceId, code, role, maxUses, useCount, expiresAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("inv-find", WS_ID, "FIND1", "editor", 5, 0, null, USER_ID);
  const row = await workspaceInvitesRepository.getByIdAsync("inv-find");
  assert.ok(row);
  assert.equal(row.code, "FIND1");
  clean();
});

test("getByIdAsync returns undefined when not found", async () => {
  clean();
  const row = await workspaceInvitesRepository.getByIdAsync("nonexistent");
  assert.equal(row, undefined);
});

test("listByWorkspaceAsync returns invites sorted by createdAt DESC", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO workspace_invites (id, workspaceId, code, role, maxUses, useCount, expiresAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("inv-a", WS_ID, "AAA", "viewer", 10, 0, null, USER_ID);
  getDb().prepare("INSERT INTO workspace_invites (id, workspaceId, code, role, maxUses, useCount, expiresAt, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+1 hour'))").run("inv-b", WS_ID, "BBB", "editor", 20, 0, null, USER_ID);
  const rows = await workspaceInvitesRepository.listByWorkspaceAsync(WS_ID);
  assert.ok(rows.length >= 2);
  // createdAt DESC: inv-b should be first
  assert.equal(rows[0].id, "inv-b");
  clean();
});

test("listByWorkspaceAsync returns empty for workspace without invites", async () => {
  clean();
  const rows = await workspaceInvitesRepository.listByWorkspaceAsync("no-such-ws");
  assert.equal(rows.length, 0);
});

test("getByCodeAsync returns invite", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO workspace_invites (id, workspaceId, code, role, maxUses, useCount, expiresAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("inv-code", WS_ID, "CODE1", "viewer", 10, 0, null, USER_ID);
  const row = await workspaceInvitesRepository.getByCodeAsync("CODE1");
  assert.ok(row);
  assert.equal(row.id, "inv-code");
  clean();
});

test("getByCodeAsync returns undefined when not found", async () => {
  clean();
  const row = await workspaceInvitesRepository.getByCodeAsync("NOPE");
  assert.equal(row, undefined);
});

test("deleteAsync removes invite", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO workspace_invites (id, workspaceId, code, role, maxUses, useCount, expiresAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("inv-del", WS_ID, "DEL1", "viewer", 10, 0, null, USER_ID);
  await workspaceInvitesRepository.deleteAsync("inv-del", WS_ID);
  const row = getDb().prepare("SELECT id FROM workspace_invites WHERE id = ?").get("inv-del");
  assert.equal(row, undefined);
  clean();
});

test("deleteAsync with wrong workspaceId is no-op", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO workspace_invites (id, workspaceId, code, role, maxUses, useCount, expiresAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("inv-dnw", WS_ID, "DNW1", "viewer", 10, 0, null, USER_ID);
  await workspaceInvitesRepository.deleteAsync("inv-dnw", "wrong-ws");
  const row = getDb().prepare("SELECT id FROM workspace_invites WHERE id = ?").get("inv-dnw");
  assert.ok(row);
  clean();
});

test("incrementUseCountAsync increments useCount", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO workspace_invites (id, workspaceId, code, role, maxUses, useCount, expiresAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("inv-inc", WS_ID, "INC1", "viewer", 10, 0, null, USER_ID);
  await workspaceInvitesRepository.incrementUseCountAsync("inv-inc");
  const row = getDb().prepare("SELECT useCount FROM workspace_invites WHERE id = ?").get("inv-inc") as any;
  assert.equal(row.useCount, 1);
  await workspaceInvitesRepository.incrementUseCountAsync("inv-inc");
  const row2 = getDb().prepare("SELECT useCount FROM workspace_invites WHERE id = ?").get("inv-inc") as any;
  assert.equal(row2.useCount, 2);
  clean();
});

test("transferOwnershipAsync transfers invites", async () => {
  clean();
  seedBase();
  const newUserId = "user-wi-new";
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(newUserId, newUserId, "hash");
  getDb().prepare("INSERT INTO workspace_invites (id, workspaceId, code, role, maxUses, useCount, expiresAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("inv-tr", WS_ID, "TR1", "viewer", 10, 0, null, USER_ID);
  const transferred = await workspaceInvitesRepository.transferOwnershipAsync(USER_ID, newUserId);
  assert.ok(transferred >= 1);
  const row = getDb().prepare("SELECT createdBy FROM workspace_invites WHERE id = ?").get("inv-tr") as any;
  assert.equal(row.createdBy, newUserId);
  clean();
});
