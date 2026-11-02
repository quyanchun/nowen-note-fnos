/**
 * noteTagsRepository PostgreSQL 双库测试（PG-PILOT-04）
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
import { hasPg, getPgPool, initPgSchema, closePgPool } from "./helpers/pg-test-db";

// Skip all tests if no PostgreSQL available
const skip = !hasPg;

const USER_ID = "user-pg-tags";
const NB_ID = "nb-pg-tags";
const NOTE_ID = "note-pg-tags";
const NOTE_ID_2 = "note-pg-tags-2";
const TAG_ID_1 = "tag-pg-1";
const TAG_ID_2 = "tag-pg-2";
const TAG_ID_3 = "tag-pg-3";

/** 创建 FK 依赖数据 */
async function seedBase(pool: import("pg").Pool) {
  await pool.query(`INSERT INTO users (id, username, "passwordHash") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [USER_ID, USER_ID, "hash"]);
  await pool.query(`INSERT INTO notebooks (id, "userId", name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [NB_ID, USER_ID, "Test NB"]);
  await pool.query(`INSERT INTO notes (id, "userId", "notebookId", title) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [NOTE_ID, USER_ID, NB_ID, "Test Note"]);
  await pool.query(`INSERT INTO notes (id, "userId", "notebookId", title) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [NOTE_ID_2, USER_ID, NB_ID, "Note 2"]);
  await pool.query(`INSERT INTO tags (id, "userId", name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [TAG_ID_1, USER_ID, "Tag 1"]);
  await pool.query(`INSERT INTO tags (id, "userId", name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [TAG_ID_2, USER_ID, "Tag 2"]);
  await pool.query(`INSERT INTO tags (id, "userId", name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [TAG_ID_3, USER_ID, "Tag 3"]);
}

/** 清理测试数据 */
async function cleanAll(pool: import("pg").Pool) {
  await pool.query("DELETE FROM note_tags");
  await pool.query("DELETE FROM tags WHERE id IN ($1, $2, $3)", [TAG_ID_1, TAG_ID_2, TAG_ID_3]);
  await pool.query("DELETE FROM notes WHERE id IN ($1, $2)", [NOTE_ID, NOTE_ID_2]);
  await pool.query("DELETE FROM notebooks WHERE id = $1", [NB_ID]);
  await pool.query("DELETE FROM users WHERE id = $1", [USER_ID]);
}

test("PG: addTagToNoteAsync adds note-tag relation", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanAll(pool);
  await seedBase(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createNoteTagsRepository } = await import("../src/repositories/noteTagsRepository");
  const repo = createNoteTagsRepository(
    new PostgresAdapter(pool), "INSERT", 'ON CONFLICT ("noteId", "tagId") DO NOTHING'
  );

  await repo.addTagToNoteAsync(NOTE_ID, TAG_ID_1);
  const tags = await repo.listTagsByNoteIdAsync(NOTE_ID);
  assert.equal(tags.length, 1);
  assert.equal(tags[0].id, TAG_ID_1);

  await cleanAll(pool);
  await closePgPool(pool);
});

test("PG: addTagToNoteAsync duplicate is idempotent", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanAll(pool);
  await seedBase(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createNoteTagsRepository } = await import("../src/repositories/noteTagsRepository");
  const repo = createNoteTagsRepository(
    new PostgresAdapter(pool), "INSERT", 'ON CONFLICT ("noteId", "tagId") DO NOTHING'
  );

  await repo.addTagToNoteAsync(NOTE_ID, TAG_ID_1);
  await repo.addTagToNoteAsync(NOTE_ID, TAG_ID_1); // 重复添加不报错
  const tags = await repo.listTagsByNoteIdAsync(NOTE_ID);
  assert.equal(tags.length, 1);

  await cleanAll(pool);
  await closePgPool(pool);
});

test("PG: removeTagFromNoteAsync removes relation", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanAll(pool);
  await seedBase(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createNoteTagsRepository } = await import("../src/repositories/noteTagsRepository");
  const repo = createNoteTagsRepository(
    new PostgresAdapter(pool), "INSERT", 'ON CONFLICT ("noteId", "tagId") DO NOTHING'
  );

  await repo.addTagToNoteAsync(NOTE_ID, TAG_ID_1);
  await repo.removeTagFromNoteAsync(NOTE_ID, TAG_ID_1);
  const tags = await repo.listTagsByNoteIdAsync(NOTE_ID);
  assert.equal(tags.length, 0);

  await cleanAll(pool);
  await closePgPool(pool);
});

test("PG: removeTagFromNoteAsync no-op when not exists", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanAll(pool);
  await seedBase(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createNoteTagsRepository } = await import("../src/repositories/noteTagsRepository");
  const repo = createNoteTagsRepository(
    new PostgresAdapter(pool), "INSERT", 'ON CONFLICT ("noteId", "tagId") DO NOTHING'
  );

  // 不报错
  await repo.removeTagFromNoteAsync(NOTE_ID, "nonexistent");

  await cleanAll(pool);
  await closePgPool(pool);
});

test("PG: listTagsByNoteIdAsync returns tags for note", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanAll(pool);
  await seedBase(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createNoteTagsRepository } = await import("../src/repositories/noteTagsRepository");
  const repo = createNoteTagsRepository(
    new PostgresAdapter(pool), "INSERT", 'ON CONFLICT ("noteId", "tagId") DO NOTHING'
  );

  await repo.addTagToNoteAsync(NOTE_ID, TAG_ID_1);
  await repo.addTagToNoteAsync(NOTE_ID, TAG_ID_2);
  const tags = await repo.listTagsByNoteIdAsync(NOTE_ID);
  assert.equal(tags.length, 2);
  const tagIds = tags.map(t => t.id).sort();
  assert.deepEqual(tagIds, [TAG_ID_1, TAG_ID_2].sort());

  await cleanAll(pool);
  await closePgPool(pool);
});

test("PG: listTagsByNoteIdAsync returns empty for note without tags", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanAll(pool);
  await seedBase(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createNoteTagsRepository } = await import("../src/repositories/noteTagsRepository");
  const repo = createNoteTagsRepository(
    new PostgresAdapter(pool), "INSERT", 'ON CONFLICT ("noteId", "tagId") DO NOTHING'
  );

  const tags = await repo.listTagsByNoteIdAsync(NOTE_ID);
  assert.equal(tags.length, 0);

  await cleanAll(pool);
  await closePgPool(pool);
});

test("PG: listNoteIdsByTagFilterAsync OR mode returns matching notes", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanAll(pool);
  await seedBase(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createNoteTagsRepository } = await import("../src/repositories/noteTagsRepository");
  const repo = createNoteTagsRepository(
    new PostgresAdapter(pool), "INSERT", 'ON CONFLICT ("noteId", "tagId") DO NOTHING'
  );

  await repo.addTagToNoteAsync(NOTE_ID, TAG_ID_1);
  await repo.addTagToNoteAsync(NOTE_ID_2, TAG_ID_2);

  const noteIds = await repo.listNoteIdsByTagFilterAsync([TAG_ID_1, TAG_ID_2], "or");
  assert.equal(noteIds.length, 2);
  assert.ok(noteIds.includes(NOTE_ID));
  assert.ok(noteIds.includes(NOTE_ID_2));

  await cleanAll(pool);
  await closePgPool(pool);
});

test("PG: listNoteIdsByTagFilterAsync AND mode returns notes with all tags", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanAll(pool);
  await seedBase(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createNoteTagsRepository } = await import("../src/repositories/noteTagsRepository");
  const repo = createNoteTagsRepository(
    new PostgresAdapter(pool), "INSERT", 'ON CONFLICT ("noteId", "tagId") DO NOTHING'
  );

  await repo.addTagToNoteAsync(NOTE_ID, TAG_ID_1);
  await repo.addTagToNoteAsync(NOTE_ID, TAG_ID_2);
  await repo.addTagToNoteAsync(NOTE_ID_2, TAG_ID_1);

  const noteIds = await repo.listNoteIdsByTagFilterAsync([TAG_ID_1, TAG_ID_2], "and");
  assert.equal(noteIds.length, 1);
  assert.equal(noteIds[0], NOTE_ID);

  await cleanAll(pool);
  await closePgPool(pool);
});

test("PG: listNoteIdsByTagFilterAsync empty input returns empty", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanAll(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createNoteTagsRepository } = await import("../src/repositories/noteTagsRepository");
  const repo = createNoteTagsRepository(
    new PostgresAdapter(pool), "INSERT", 'ON CONFLICT ("noteId", "tagId") DO NOTHING'
  );

  const noteIds = await repo.listNoteIdsByTagFilterAsync([]);
  assert.equal(noteIds.length, 0);

  await closePgPool(pool);
});

test("PG: camelCase fields work correctly in PostgreSQL", { skip }, async () => {
  const pool = await getPgPool()!;
  await initPgSchema(pool);
  await cleanAll(pool);
  await seedBase(pool);

  const { PostgresAdapter } = await import("../src/db/postgresAdapter");
  const { createNoteTagsRepository } = await import("../src/repositories/noteTagsRepository");
  const repo = createNoteTagsRepository(
    new PostgresAdapter(pool), "INSERT", 'ON CONFLICT ("noteId", "tagId") DO NOTHING'
  );

  // 测试 camelCase 字段在 PG 下正确工作
  await repo.addTagToNoteAsync(NOTE_ID, TAG_ID_1);
  const tags = await repo.listTagsByNoteIdAsync(NOTE_ID);
  assert.equal(tags.length, 1);
  assert.equal(tags[0].id, TAG_ID_1);
  assert.equal(tags[0].userId, USER_ID);

  await cleanAll(pool);
  await closePgPool(pool);
});
