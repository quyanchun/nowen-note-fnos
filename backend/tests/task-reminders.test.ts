import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import crypto from "crypto";

/**
 * Test the reminder scanning logic by replicating the SQL + logic
 * from task-reminders.ts scanDueReminders().
 * We test against an in-memory SQLite DB to verify the SQL is correct.
 */

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, email TEXT,
      passwordHash TEXT, role TEXT DEFAULT 'user', isDemo INTEGER DEFAULT 0,
      personalExportEnabled INTEGER DEFAULT 1, personalImportEnabled INTEGER DEFAULT 1,
      displayName TEXT, avatarUrl TEXT, createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, workspaceId TEXT,
      title TEXT NOT NULL, isCompleted INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 2, dueDate TEXT, dueAt TEXT,
      noteId TEXT, parentId TEXT, sortOrder INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE task_reminders (
      id TEXT PRIMARY KEY, taskId TEXT NOT NULL, userId TEXT NOT NULL,
      offsetMinutes INTEGER NOT NULL DEFAULT 30, enabled INTEGER NOT NULL DEFAULT 1,
      lastNotifiedAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_task_reminders_task ON task_reminders(taskId);
    CREATE INDEX idx_task_reminders_enabled ON task_reminders(enabled);
  `);
  return db;
}

function insertUser(db: Database.Database, id: string) {
  db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run(id, id);
}

function insertTask(db: Database.Database, opts: {
  id: string; userId: string; title: string;
  isCompleted?: number; dueDate?: string | null; dueAt?: string | null;
  parentId?: string | null;
}) {
  db.prepare(
    "INSERT INTO tasks (id, userId, title, isCompleted, dueDate, dueAt, parentId) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(opts.id, opts.userId, opts.title, opts.isCompleted ?? 0, opts.dueDate ?? null, opts.dueAt ?? null, opts.parentId ?? null);
}

function insertReminder(db: Database.Database, opts: {
  id: string; taskId: string; userId: string;
  offsetMinutes?: number; enabled?: number; lastNotifiedAt?: string | null;
}) {
  db.prepare(
    "INSERT INTO task_reminders (id, taskId, userId, offsetMinutes, enabled, lastNotifiedAt) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(opts.id, opts.taskId, opts.userId, opts.offsetMinutes ?? 30, opts.enabled ?? 1, opts.lastNotifiedAt ?? null);
}

/** Replicate scanDueReminders logic against test DB */
function scanDue(db: Database.Database) {
  const rows = db.prepare(`
    SELECT r.id AS reminderId, r.taskId, r.userId, r.offsetMinutes, r.lastNotifiedAt,
           t.title AS taskTitle, t.dueAt, t.dueDate, t.isCompleted
    FROM task_reminders r
    JOIN tasks t ON t.id = r.taskId
    WHERE r.enabled = 1 AND t.isCompleted = 0 AND (t.dueAt IS NOT NULL OR t.dueDate IS NOT NULL)
  `).all() as any[];

  const now = Date.now();
  const pending: any[] = [];

  for (const row of rows) {
    const dueStr = row.dueAt || (row.dueDate ? row.dueDate + "T23:59:59" : null);
    if (!dueStr) continue;
    const dueMs = new Date(dueStr).getTime();
    const reminderMs = dueMs - row.offsetMinutes * 60 * 1000;
    if (reminderMs > now) continue;
    if (row.lastNotifiedAt) {
      const lastNotifiedMs = new Date(row.lastNotifiedAt).getTime();
      if (lastNotifiedMs >= reminderMs) continue;
    }
    pending.push({ reminderId: row.reminderId, taskId: row.taskId });
  }
  return pending;
}

test("reminder: task with dueDate in the past triggers reminder", () => {
  const db = createTestDb();
  insertUser(db, "u1");
  insertTask(db, { id: "t1", userId: "u1", title: "Overdue task", dueDate: "2020-01-01" });
  insertReminder(db, { id: "r1", taskId: "t1", userId: "u1", offsetMinutes: 0 });

  const result = scanDue(db);
  assert.equal(result.length, 1);
  assert.equal(result[0].taskId, "t1");
});

test("reminder: task with dueDate today + offsetMinutes=0 triggers (dueDate + T23:59:59 > now is false)", () => {
  const db = createTestDb();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  insertUser(db, "u1");
  insertTask(db, { id: "t1", userId: "u1", title: "Today task", dueDate: todayStr });
  insertReminder(db, { id: "r1", taskId: "t1", userId: "u1", offsetMinutes: 0 });

  const result = scanDue(db);
  // dueDate + T23:59:59 = today 23:59:59, which is in the future
  // So reminder time = today 23:59:59 - 0 = today 23:59:59 > now
  // Should NOT trigger yet
  assert.equal(result.length, 0);
});

test("reminder: completed task does not trigger", () => {
  const db = createTestDb();
  insertUser(db, "u1");
  insertTask(db, { id: "t1", userId: "u1", title: "Done", isCompleted: 1, dueDate: "2020-01-01" });
  insertReminder(db, { id: "r1", taskId: "t1", userId: "u1" });

  assert.equal(scanDue(db).length, 0);
});

test("reminder: disabled reminder does not trigger", () => {
  const db = createTestDb();
  insertUser(db, "u1");
  insertTask(db, { id: "t1", userId: "u1", title: "Task", dueDate: "2020-01-01" });
  insertReminder(db, { id: "r1", taskId: "t1", userId: "u1", enabled: 0 });

  assert.equal(scanDue(db).length, 0);
});

test("reminder: already notified does not trigger again (idempotent)", () => {
  const db = createTestDb();
  insertUser(db, "u1");
  insertTask(db, { id: "t1", userId: "u1", title: "Task", dueDate: "2020-01-01" });
  // lastNotifiedAt is recent (after the reminder time)
  insertReminder(db, { id: "r1", taskId: "t1", userId: "u1", offsetMinutes: 0, lastNotifiedAt: "2030-01-01T00:00:00" });

  assert.equal(scanDue(db).length, 0);
});

test("reminder: dueAt precision - task due at specific past time triggers", () => {
  const db = createTestDb();
  insertUser(db, "u1");
  insertTask(db, { id: "t1", userId: "u1", title: "Precise", dueAt: "2020-01-01T10:00" });
  insertReminder(db, { id: "r1", taskId: "t1", userId: "u1", offsetMinutes: 0 });

  const result = scanDue(db);
  assert.equal(result.length, 1);
});

test("reminder: offsetMinutes works - 30min before due", () => {
  const db = createTestDb();
  insertUser(db, "u1");
  // due 10 minutes from now, offset 30 min => reminder was due 20 min ago
  const dueAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  insertTask(db, { id: "t1", userId: "u1", title: "Soon", dueAt });
  insertReminder(db, { id: "r1", taskId: "t1", userId: "u1", offsetMinutes: 30 });

  const result = scanDue(db);
  assert.equal(result.length, 1);
});

test("reminder: offsetMinutes works - 30min before due but not yet due", () => {
  const db = createTestDb();
  insertUser(db, "u1");
  // due 40 minutes from now, offset 30 min => reminder in 10 min, should NOT trigger
  const dueAt = new Date(Date.now() + 40 * 60 * 1000).toISOString();
  insertTask(db, { id: "t1", userId: "u1", title: "Later", dueAt });
  insertReminder(db, { id: "r1", taskId: "t1", userId: "u1", offsetMinutes: 30 });

  assert.equal(scanDue(db).length, 0);
});

test("reminder: deleting task cascades to reminders", () => {
  const db = createTestDb();
  insertUser(db, "u1");
  insertTask(db, { id: "t1", userId: "u1", title: "Delete me", dueDate: "2020-01-01" });
  insertReminder(db, { id: "r1", taskId: "t1", userId: "u1" });

  // Verify reminder exists
  const before = db.prepare("SELECT * FROM task_reminders WHERE taskId = ?").all("t1");
  assert.equal(before.length, 1);

  // Delete task
  db.prepare("DELETE FROM tasks WHERE id = ?").run("t1");

  // Verify reminder is gone (CASCADE)
  const after = db.prepare("SELECT * FROM task_reminders WHERE taskId = ?").all("t1");
  assert.equal(after.length, 0);
});

test("reminder: marking as notified prevents re-trigger", () => {
  const db = createTestDb();
  insertUser(db, "u1");
  insertTask(db, { id: "t1", userId: "u1", title: "Task", dueDate: "2020-01-01" });
  insertReminder(db, { id: "r1", taskId: "t1", userId: "u1", offsetMinutes: 0 });

  // First scan should find it
  assert.equal(scanDue(db).length, 1);

  // Mark as notified
  db.prepare("UPDATE task_reminders SET lastNotifiedAt = datetime('now') WHERE id = ?").run("r1");

  // Second scan should NOT find it
  assert.equal(scanDue(db).length, 0);
});

test("reminder: no dueDate or dueAt = no trigger", () => {
  const db = createTestDb();
  insertUser(db, "u1");
  insertTask(db, { id: "t1", userId: "u1", title: "No deadline" });
  insertReminder(db, { id: "r1", taskId: "t1", userId: "u1" });

  assert.equal(scanDue(db).length, 0);
});
