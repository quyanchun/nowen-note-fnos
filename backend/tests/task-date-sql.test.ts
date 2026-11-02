import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  taskOverdueConditionSql,
  taskTodayConditionSql,
} from "../src/lib/taskDateSql";

process.env.TZ = "Asia/Shanghai";

type TaskInput = {
  id: string;
  dueDate?: string | null;
  dueAt?: string | null;
  isCompleted?: number;
};

function withTasks(rows: TaskInput[]) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      dueDate TEXT,
      dueAt TEXT,
      isCompleted INTEGER NOT NULL DEFAULT 0
    )
  `);
  const insert = db.prepare("INSERT INTO tasks (id, dueDate, dueAt, isCompleted) VALUES (?, ?, ?, ?)");
  for (const row of rows) {
    insert.run(row.id, row.dueDate ?? null, row.dueAt ?? null, row.isCompleted ?? 0);
  }
  return db;
}

test("task date SQL treats dueDate-only today as today but not overdue", () => {
  const db = withTasks([{ id: "today", dueDate: "2026-07-03" }]);

  const todayCount = db
    .prepare(`SELECT COUNT(*) AS count FROM tasks WHERE ${taskTodayConditionSql("date('2026-07-03')")}`)
    .get() as { count: number };
  const overdueCount = db
    .prepare(`SELECT COUNT(*) AS count FROM tasks WHERE ${taskOverdueConditionSql("datetime('2026-07-03 12:00:00')")}`)
    .get() as { count: number };

  assert.equal(todayCount.count, 1);
  assert.equal(overdueCount.count, 0);
  db.close();
});

test("task date SQL treats yesterday dueDate as overdue", () => {
  const db = withTasks([{ id: "yesterday", dueDate: "2026-07-02" }]);

  const overdueCount = db
    .prepare(`SELECT COUNT(*) AS count FROM tasks WHERE ${taskOverdueConditionSql("datetime('2026-07-03 12:00:00')")}`)
    .get() as { count: number };

  assert.equal(overdueCount.count, 1);
  db.close();
});

test("task date SQL compares dueAt as datetime instead of raw text", () => {
  const db = withTasks([
    { id: "earlier", dueAt: "2026-07-03T10:00" },
    { id: "later", dueAt: "2026-07-03T13:00" },
    { id: "done", dueAt: "2026-07-03T09:00", isCompleted: 1 },
  ]);

  const rows = db
    .prepare(`SELECT id FROM tasks WHERE ${taskOverdueConditionSql("datetime('2026-07-03 12:00:00')")} ORDER BY id`)
    .all() as Array<{ id: string }>;

  assert.deepEqual(rows.map((row) => row.id), ["earlier"]);
  db.close();
});
