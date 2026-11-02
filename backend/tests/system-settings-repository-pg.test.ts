/**
 * systemSettingsRepository PostgreSQL 双库测试（PG-PILOT-01）
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

test("PG: setAsync and getAsync", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "system_settings");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createSystemSettingsRepository } = await import("../src/repositories/systemSettingsRepository");
  const repo = createSystemSettingsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.setAsync("theme", "dark");
  const result = await repo.getAsync("theme");
  assert.ok(result);
  assert.equal(result.key, "theme");
  assert.equal(result.value, "dark");
  assert.ok(result.updatedAt);

  await cleanTable(pool, "system_settings");
  await closePgPool(pool);
});

test("PG: setAsync upsert updates existing", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "system_settings");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createSystemSettingsRepository } = await import("../src/repositories/systemSettingsRepository");
  const repo = createSystemSettingsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.setAsync("theme", "dark");
  await repo.setAsync("theme", "light");
  const result = await repo.getAsync("theme");
  assert.ok(result);
  assert.equal(result.value, "light");

  await cleanTable(pool, "system_settings");
  await closePgPool(pool);
});

test("PG: setManyAsync batch upsert", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "system_settings");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createSystemSettingsRepository } = await import("../src/repositories/systemSettingsRepository");
  const repo = createSystemSettingsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.setManyAsync([
    { key: "a", value: "1" },
    { key: "b", value: "2" },
    { key: "c", value: "3" },
  ]);

  const all = await repo.getAllAsync();
  assert.equal(all.length, 3);

  await cleanTable(pool, "system_settings");
  await closePgPool(pool);
});

test("PG: getManyAsync with IN clause", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "system_settings");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createSystemSettingsRepository } = await import("../src/repositories/systemSettingsRepository");
  const repo = createSystemSettingsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.setManyAsync([
    { key: "x", value: "10" },
    { key: "y", value: "20" },
    { key: "z", value: "30" },
  ]);

  const results = await repo.getManyAsync(["x", "z"]);
  assert.equal(results.length, 2);
  const keys = results.map((r) => r.key).sort();
  assert.deepEqual(keys, ["x", "z"]);

  await cleanTable(pool, "system_settings");
  await closePgPool(pool);
});

test("PG: getManyAsync empty returns empty", { skip }, async () => {
  const pool = await getPgPool()!;
  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createSystemSettingsRepository } = await import("../src/repositories/systemSettingsRepository");
  const repo = createSystemSettingsRepository(new PostgresAdapter(pool), "NOW()");

  const results = await repo.getManyAsync([]);
  assert.deepEqual(results, []);

  await closePgPool(pool);
});

test("PG: getAllAsync returns all", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "system_settings");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createSystemSettingsRepository } = await import("../src/repositories/systemSettingsRepository");
  const repo = createSystemSettingsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.setManyAsync([{ key: "a", value: "1" }, { key: "b", value: "2" }]);
  const all = await repo.getAllAsync();
  assert.equal(all.length, 2);

  await cleanTable(pool, "system_settings");
  await closePgPool(pool);
});

test("PG: getByPrefixAsync", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "system_settings");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createSystemSettingsRepository } = await import("../src/repositories/systemSettingsRepository");
  const repo = createSystemSettingsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.setManyAsync([
    { key: "theme.dark", value: "1" },
    { key: "theme.light", value: "2" },
    { key: "lang.en", value: "3" },
  ]);

  const themes = await repo.getByPrefixAsync("theme");
  assert.equal(themes.length, 2);

  await cleanTable(pool, "system_settings");
  await closePgPool(pool);
});

test("PG: getByPrefixesAsync", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "system_settings");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createSystemSettingsRepository } = await import("../src/repositories/systemSettingsRepository");
  const repo = createSystemSettingsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.setManyAsync([
    { key: "theme.dark", value: "1" },
    { key: "lang.en", value: "2" },
    { key: "other.x", value: "3" },
  ]);

  const results = await repo.getByPrefixesAsync(["theme", "lang"]);
  assert.equal(results.length, 2);

  await cleanTable(pool, "system_settings");
  await closePgPool(pool);
});

test("PG: deleteAsync", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "system_settings");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createSystemSettingsRepository } = await import("../src/repositories/systemSettingsRepository");
  const repo = createSystemSettingsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.setAsync("theme", "dark");
  await repo.deleteAsync("theme");
  const result = await repo.getAsync("theme");
  assert.equal(result, undefined);

  await cleanTable(pool, "system_settings");
  await closePgPool(pool);
});

test("PG: deleteManyAsync", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "system_settings");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createSystemSettingsRepository } = await import("../src/repositories/systemSettingsRepository");
  const repo = createSystemSettingsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.setManyAsync([{ key: "a", value: "1" }, { key: "b", value: "2" }, { key: "c", value: "3" }]);
  await repo.deleteManyAsync(["a", "c"]);
  const all = await repo.getAllAsync();
  assert.equal(all.length, 1);
  assert.equal(all[0].key, "b");

  await cleanTable(pool, "system_settings");
  await closePgPool(pool);
});

test("PG: deleteByPrefixAsync", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanTable(pool, "system_settings");

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createSystemSettingsRepository } = await import("../src/repositories/systemSettingsRepository");
  const repo = createSystemSettingsRepository(new PostgresAdapter(pool), "NOW()");

  await repo.setManyAsync([
    { key: "theme.dark", value: "1" },
    { key: "theme.light", value: "2" },
    { key: "lang.en", value: "3" },
  ]);

  await repo.deleteByPrefixAsync("theme");
  const all = await repo.getAllAsync();
  assert.equal(all.length, 1);
  assert.equal(all[0].key, "lang.en");

  await cleanTable(pool, "system_settings");
  await closePgPool(pool);
});
