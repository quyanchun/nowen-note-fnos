import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../src/db/migrations";

function createLegacyDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      passwordHash TEXT NOT NULL
    );

    CREATE TABLE notebooks (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      parentId TEXT,
      name TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    INSERT INTO users (id, username, passwordHash)
    VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');

    INSERT INTO notebooks (id, userId, parentId, name)
    VALUES
      ('nb-1', 'user-1', NULL, 'Alice root'),
      ('nb-2', 'user-1', 'nb-1', 'Alice child'),
      ('nb-3', 'user-2', NULL, 'Bob root');
  `);
  return db;
}

test("notebook members migration creates owner memberships for existing notebooks", () => {
  const migration = MIGRATIONS.find((m) => m.name === "notebook-members");
  assert.ok(migration, "notebook-members migration should be registered");

  const db = createLegacyDb();
  migration.up(db);

  const members = db
    .prepare(
      `SELECT notebookId, userId, role, status, invitedBy
       FROM notebook_members
       ORDER BY notebookId`,
    )
    .all();

  assert.deepEqual(members, [
    {
      notebookId: "nb-1",
      userId: "user-1",
      role: "owner",
      status: "active",
      invitedBy: null,
    },
    {
      notebookId: "nb-2",
      userId: "user-1",
      role: "owner",
      status: "active",
      invitedBy: null,
    },
    {
      notebookId: "nb-3",
      userId: "user-2",
      role: "owner",
      status: "active",
      invitedBy: null,
    },
  ]);

  assert.throws(
    () => {
      db.prepare(
        `INSERT INTO notebook_members (id, notebookId, userId, role, status)
         VALUES ('duplicate', 'nb-1', 'user-1', 'viewer', 'active')`,
      ).run();
    },
    /UNIQUE constraint failed/,
  );

  db.close();
});
