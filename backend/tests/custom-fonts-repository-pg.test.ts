/**
 * customFontsRepository PostgreSQL 双库测试（PG-PILOT-02）
 *
 * 需要 TEST_PG_DATABASE_URL 环境变量。
 * 无 TEST_PG_DATABASE_URL 时全部 skip。
 *
 * 启动：
 *   docker compose -f docker-compose.postgres.yml up -d
 *   $env:TEST_PG_DATABASE_URL="postgres://nowen:nowen_dev_password@localhost:5432/nowen_note_test"
 */

import assert from "node:assert/strict";
import test from "node:test";
import { hasPg, getPgPool, initPgSchema, cleanTable, closePgPool } from "./helpers/pg-test-db";

// Skip all tests if no PostgreSQL available
const skip = !hasPg;

function seedFont(pool: import("pg").Pool, overrides: Record<string, unknown> = {}) {
  const id = overrides.id ?? `font-${Date.now()}`;
  const name = overrides.name ?? "Test Font";
  const fileName = overrides.fileName ?? `test-${Date.now()}.woff2`;
  const format = overrides.format ?? "woff2";
  const fileSize = overrides.fileSize ?? 1024;
  return { id, name, fileName, format, fileSize };
}

test("PG: createAsync inserts font", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "custom_fonts");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createCustomFontsRepository } = await import("../src/repositories/customFontsRepository");
  const repo = createCustomFontsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.createAsync({
    id: "f-create",
    name: "Created",
    fileName: "created.woff2",
    format: "woff2",
    fileSize: 2048,
  });

  const row = await repo.getByIdAsync("f-create");
  assert.ok(row);
  assert.equal(row.name, "Created");
  assert.equal(row.fileName, "created.woff2");
  assert.equal(row.fileSize, 2048);
  assert.ok(row.createdAt);

  await cleanTable(pool, "custom_fonts");
  await closePgPool(pool);
});

test("PG: getAllAsync returns all fonts ordered by createdAt DESC", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "custom_fonts");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createCustomFontsRepository } = await import("../src/repositories/customFontsRepository");
  const repo = createCustomFontsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.createAsync({ id: "f1", name: "Alpha", fileName: "alpha.woff2", format: "woff2", fileSize: 1024 });
  // 小延迟确保排序可验证
  await new Promise((r) => setTimeout(r, 50));
  await repo.createAsync({ id: "f2", name: "Beta", fileName: "beta.woff2", format: "woff2", fileSize: 2048 });

  const rows = await repo.getAllAsync();
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].id, "f2");
  assert.equal(rows[1].id, "f1");
  assert.ok(rows[0].fileSize !== undefined);

  await cleanTable(pool, "custom_fonts");
  await closePgPool(pool);
});

test("PG: getListAsync returns fonts without fileSize", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "custom_fonts");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createCustomFontsRepository } = await import("../src/repositories/customFontsRepository");
  const repo = createCustomFontsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.createAsync({ id: "f-list", name: "ListFont", fileName: "list.woff2", format: "woff2", fileSize: 1024 });

  const rows = await repo.getListAsync();
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].id, "f-list");
  assert.equal((rows[0] as any).fileSize, undefined);

  await cleanTable(pool, "custom_fonts");
  await closePgPool(pool);
});

test("PG: getByIdAsync returns font by id", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "custom_fonts");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createCustomFontsRepository } = await import("../src/repositories/customFontsRepository");
  const repo = createCustomFontsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.createAsync({ id: "f-find", name: "FindMe", fileName: "find.woff2", format: "woff2", fileSize: 1024 });

  const row = await repo.getByIdAsync("f-find");
  assert.ok(row);
  assert.equal(row.id, "f-find");
  assert.equal(row.name, "FindMe");
  assert.equal(row.fileName, "find.woff2");

  await cleanTable(pool, "custom_fonts");
  await closePgPool(pool);
});

test("PG: getByIdAsync returns undefined when not found", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createCustomFontsRepository } = await import("../src/repositories/customFontsRepository");
  const repo = createCustomFontsRepository(new PostgresAdapter(pool), "NOW()");

  const row = await repo.getByIdAsync("nonexistent");
  assert.equal(row, undefined);

  await closePgPool(pool);
});

test("PG: getByIdForDownloadAsync returns download fields", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "custom_fonts");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createCustomFontsRepository } = await import("../src/repositories/customFontsRepository");
  const repo = createCustomFontsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.createAsync({ id: "f-dl", name: "Download", fileName: "dl.woff2", format: "woff2", fileSize: 1024 });

  const row = await repo.getByIdForDownloadAsync("f-dl");
  assert.ok(row);
  assert.equal(row.id, "f-dl");
  assert.equal(row.fileName, "dl.woff2");
  assert.equal(row.format, "woff2");
  assert.equal((row as any).name, undefined);

  await cleanTable(pool, "custom_fonts");
  await closePgPool(pool);
});

test("PG: getByFileNameAsync returns font by fileName", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "custom_fonts");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createCustomFontsRepository } = await import("../src/repositories/customFontsRepository");
  const repo = createCustomFontsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.createAsync({ id: "f-fn", name: "ByFile", fileName: "unique-file.woff2", format: "woff2", fileSize: 1024 });

  const row = await repo.getByFileNameAsync("unique-file.woff2");
  assert.ok(row);
  assert.equal(row.id, "f-fn");

  await cleanTable(pool, "custom_fonts");
  await closePgPool(pool);
});

test("PG: getIdByFileNameAsync returns only id", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "custom_fonts");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createCustomFontsRepository } = await import("../src/repositories/customFontsRepository");
  const repo = createCustomFontsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.createAsync({ id: "f-id", name: "IdOnly", fileName: "id-only.woff2", format: "woff2", fileSize: 1024 });

  const id = await repo.getIdByFileNameAsync("id-only.woff2");
  assert.equal(id, "f-id");

  const missing = await repo.getIdByFileNameAsync("no-such-file.woff2");
  assert.equal(missing, undefined);

  await cleanTable(pool, "custom_fonts");
  await closePgPool(pool);
});

test("PG: existsByFileNameAsync returns true when exists", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "custom_fonts");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createCustomFontsRepository } = await import("../src/repositories/customFontsRepository");
  const repo = createCustomFontsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.createAsync({ id: "f-ex", name: "Exists", fileName: "exists.woff2", format: "woff2", fileSize: 1024 });

  const exists = await repo.existsByFileNameAsync("exists.woff2");
  assert.equal(exists, true);

  await cleanTable(pool, "custom_fonts");
  await closePgPool(pool);
});

test("PG: existsByFileNameAsync returns false when not exists", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createCustomFontsRepository } = await import("../src/repositories/customFontsRepository");
  const repo = createCustomFontsRepository(new PostgresAdapter(pool), "NOW()");

  const exists = await repo.existsByFileNameAsync("no-such.woff2");
  assert.equal(exists, false);

  await closePgPool(pool);
});

test("PG: deleteAsync removes font", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "custom_fonts");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createCustomFontsRepository } = await import("../src/repositories/customFontsRepository");
  const repo = createCustomFontsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.createAsync({ id: "f-del", name: "ToDelete", fileName: "del.woff2", format: "woff2", fileSize: 1024 });

  await repo.deleteAsync("f-del");

  const row = await repo.getByIdAsync("f-del");
  assert.equal(row, undefined);

  await cleanTable(pool, "custom_fonts");
  await closePgPool(pool);
});
