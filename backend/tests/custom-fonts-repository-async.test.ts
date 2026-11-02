/**
 * customFontsRepository async 方法行为测试
 *
 * 验证 async 方法与同步方法行为等价。
 * 使用临时 DB_PATH，不访问真实用户数据。
 */

import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// 设置临时数据库路径（在 import repository 之前）
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-custom-fonts-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { customFontsRepository } from "../src/repositories/customFontsRepository";
import { getDb } from "../src/db/schema";

function seedFont(overrides: Partial<{ id: string; name: string; fileName: string; format: string; fileSize: number }> = {}) {
  const id = overrides.id ?? `font-${Date.now()}`;
  const name = overrides.name ?? "Test Font";
  const fileName = overrides.fileName ?? `test-${Date.now()}.woff2`;
  const format = overrides.format ?? "woff2";
  const fileSize = overrides.fileSize ?? 1024;
  getDb().prepare(
    `INSERT INTO custom_fonts (id, name, fileName, format, fileSize, createdAt)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(id, name, fileName, format, fileSize);
  return { id, name, fileName, format, fileSize };
}

function cleanFonts() {
  getDb().prepare("DELETE FROM custom_fonts").run();
}

test("getAllAsync returns all fonts ordered by createdAt DESC", async () => {
  cleanFonts();
  // 使用不同秒数确保排序可验证
  getDb().prepare(
    `INSERT INTO custom_fonts (id, name, fileName, format, fileSize, createdAt)
     VALUES (?, ?, ?, ?, ?, datetime('now', '-10 seconds'))`,
  ).run("f1", "Alpha", "alpha.woff2", "woff2", 1024);
  getDb().prepare(
    `INSERT INTO custom_fonts (id, name, fileName, format, fileSize, createdAt)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run("f2", "Beta", "beta.woff2", "woff2", 2048);

  const rows = await customFontsRepository.getAllAsync();
  assert.ok(rows.length >= 2);
  // 最新在前
  assert.equal(rows[0].id, "f2");
  assert.equal(rows[1].id, "f1");
  assert.ok(rows[0].fileSize !== undefined);

  cleanFonts();
});

test("getListAsync returns fonts without fileSize", async () => {
  cleanFonts();
  seedFont({ id: "f1", name: "Alpha", fileName: "alpha.woff2" });

  const rows = await customFontsRepository.getListAsync();
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].id, "f1");
  assert.equal((rows[0] as any).fileSize, undefined);

  cleanFonts();
});

test("getByIdAsync returns font by id", async () => {
  cleanFonts();
  const font = seedFont({ id: "f-find", name: "FindMe", fileName: "find.woff2" });

  const row = await customFontsRepository.getByIdAsync("f-find");
  assert.ok(row);
  assert.equal(row.id, "f-find");
  assert.equal(row.name, "FindMe");
  assert.equal(row.fileName, "find.woff2");

  cleanFonts();
});

test("getByIdAsync returns undefined when not found", async () => {
  cleanFonts();
  const row = await customFontsRepository.getByIdAsync("nonexistent");
  assert.equal(row, undefined);
});

test("getByIdForDownloadAsync returns download fields", async () => {
  cleanFonts();
  seedFont({ id: "f-dl", name: "Download", fileName: "dl.woff2", format: "woff2" });

  const row = await customFontsRepository.getByIdForDownloadAsync("f-dl");
  assert.ok(row);
  assert.equal(row.id, "f-dl");
  assert.equal(row.fileName, "dl.woff2");
  assert.equal(row.format, "woff2");
  assert.equal((row as any).name, undefined);

  cleanFonts();
});

test("getByFileNameAsync returns font by fileName", async () => {
  cleanFonts();
  seedFont({ id: "f-fn", name: "ByFile", fileName: "unique-file.woff2" });

  const row = await customFontsRepository.getByFileNameAsync("unique-file.woff2");
  assert.ok(row);
  assert.equal(row.id, "f-fn");

  cleanFonts();
});

test("getIdByFileNameAsync returns only id", async () => {
  cleanFonts();
  seedFont({ id: "f-id", name: "IdOnly", fileName: "id-only.woff2" });

  const id = await customFontsRepository.getIdByFileNameAsync("id-only.woff2");
  assert.equal(id, "f-id");

  const missing = await customFontsRepository.getIdByFileNameAsync("no-such-file.woff2");
  assert.equal(missing, undefined);

  cleanFonts();
});

test("createAsync inserts font", async () => {
  cleanFonts();
  await customFontsRepository.createAsync({
    id: "f-create",
    name: "Created",
    fileName: "created.woff2",
    format: "woff2",
    fileSize: 2048,
  });

  const row = getDb().prepare("SELECT * FROM custom_fonts WHERE id = ?").get("f-create") as any;
  assert.ok(row);
  assert.equal(row.name, "Created");
  assert.equal(row.fileSize, 2048);

  cleanFonts();
});

test("deleteAsync removes font", async () => {
  cleanFonts();
  seedFont({ id: "f-del", name: "ToDelete", fileName: "del.woff2" });

  await customFontsRepository.deleteAsync("f-del");

  const row = getDb().prepare("SELECT id FROM custom_fonts WHERE id = ?").get("f-del");
  assert.equal(row, undefined);
});

test("existsByFileNameAsync returns true when exists", async () => {
  cleanFonts();
  seedFont({ id: "f-ex", name: "Exists", fileName: "exists.woff2" });

  const exists = await customFontsRepository.existsByFileNameAsync("exists.woff2");
  assert.equal(exists, true);

  cleanFonts();
});

test("existsByFileNameAsync returns false when not exists", async () => {
  cleanFonts();
  const exists = await customFontsRepository.existsByFileNameAsync("no-such.woff2");
  assert.equal(exists, false);
});
