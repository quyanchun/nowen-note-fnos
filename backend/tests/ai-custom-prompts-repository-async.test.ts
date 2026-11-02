/**
 * aiCustomPromptsRepository async 方法行为测试
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-ai-prompts-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { aiCustomPromptsRepository } from "../src/repositories/aiCustomPromptsRepository";
import { getDb } from "../src/db/schema";

const USER_ID = "user-ai";

function seedBase() {
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(USER_ID, USER_ID, "hash");
}

function clean() {
  getDb().prepare("DELETE FROM ai_custom_prompts").run();
}

test("createAsync inserts prompt", async () => {
  clean();
  seedBase();
  await aiCustomPromptsRepository.createAsync({ id: "p-1", userId: USER_ID, name: "My Prompt", prompt: "Hello" });
  const row = getDb().prepare("SELECT * FROM ai_custom_prompts WHERE id = ?").get("p-1") as any;
  assert.ok(row);
  assert.equal(row.name, "My Prompt");
  assert.equal(row.prompt, "Hello");
  assert.equal(row.usageCount, 0);
  clean();
});

test("listByUserAsync returns prompts sorted by usageCount DESC", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO ai_custom_prompts (id, userId, name, prompt, usageCount) VALUES (?, ?, ?, ?, ?)").run("p-a", USER_ID, "A", "a", 5);
  getDb().prepare("INSERT INTO ai_custom_prompts (id, userId, name, prompt, usageCount) VALUES (?, ?, ?, ?, ?)").run("p-b", USER_ID, "B", "b", 10);
  const rows = await aiCustomPromptsRepository.listByUserAsync(USER_ID);
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].id, "p-b"); // higher usageCount first
  clean();
});

test("listByUserAsync returns empty for user without prompts", async () => {
  clean();
  const rows = await aiCustomPromptsRepository.listByUserAsync("no-such-user");
  assert.equal(rows.length, 0);
});

test("getByIdAndUserAsync returns prompt", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO ai_custom_prompts (id, userId, name, prompt, usageCount) VALUES (?, ?, ?, ?, ?)").run("p-find", USER_ID, "Found", "f", 0);
  const row = await aiCustomPromptsRepository.getByIdAndUserAsync("p-find", USER_ID);
  assert.ok(row);
  assert.equal(row.name, "Found");
  clean();
});

test("getByIdAndUserAsync returns undefined for wrong user", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO ai_custom_prompts (id, userId, name, prompt, usageCount) VALUES (?, ?, ?, ?, ?)").run("p-wrong", USER_ID, "W", "w", 0);
  const row = await aiCustomPromptsRepository.getByIdAndUserAsync("p-wrong", "other");
  assert.equal(row, undefined);
  clean();
});

test("updateByIdAndUserAsync updates name", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO ai_custom_prompts (id, userId, name, prompt, usageCount) VALUES (?, ?, ?, ?, ?)").run("p-upd", USER_ID, "Old", "o", 0);
  await aiCustomPromptsRepository.updateByIdAndUserAsync("p-upd", USER_ID, { name: "New" });
  const row = getDb().prepare("SELECT name FROM ai_custom_prompts WHERE id = ?").get("p-upd") as any;
  assert.equal(row.name, "New");
  clean();
});

test("updateByIdAndUserAsync with empty patch is no-op", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO ai_custom_prompts (id, userId, name, prompt, usageCount) VALUES (?, ?, ?, ?, ?)").run("p-nop", USER_ID, "Same", "s", 0);
  await aiCustomPromptsRepository.updateByIdAndUserAsync("p-nop", USER_ID, {});
  const row = getDb().prepare("SELECT name FROM ai_custom_prompts WHERE id = ?").get("p-nop") as any;
  assert.equal(row.name, "Same");
  clean();
});

test("deleteByIdAndUserAsync returns true when deleted", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO ai_custom_prompts (id, userId, name, prompt, usageCount) VALUES (?, ?, ?, ?, ?)").run("p-del", USER_ID, "Del", "d", 0);
  const result = await aiCustomPromptsRepository.deleteByIdAndUserAsync("p-del", USER_ID);
  assert.equal(result, true);
  const row = getDb().prepare("SELECT id FROM ai_custom_prompts WHERE id = ?").get("p-del");
  assert.equal(row, undefined);
  clean();
});

test("deleteByIdAndUserAsync returns false when not found", async () => {
  clean();
  const result = await aiCustomPromptsRepository.deleteByIdAndUserAsync("no-such", USER_ID);
  assert.equal(result, false);
});

test("touchUsageAsync increments usageCount and returns true", async () => {
  clean();
  seedBase();
  getDb().prepare("INSERT INTO ai_custom_prompts (id, userId, name, prompt, usageCount) VALUES (?, ?, ?, ?, ?)").run("p-touch", USER_ID, "Touch", "t", 0);
  const result = await aiCustomPromptsRepository.touchUsageAsync("p-touch", USER_ID);
  assert.equal(result, true);
  const row = getDb().prepare("SELECT usageCount, lastUsedAt FROM ai_custom_prompts WHERE id = ?").get("p-touch") as any;
  assert.equal(row.usageCount, 1);
  assert.ok(row.lastUsedAt);
  clean();
});

test("touchUsageAsync returns false when not found", async () => {
  clean();
  const result = await aiCustomPromptsRepository.touchUsageAsync("no-such", USER_ID);
  assert.equal(result, false);
});
