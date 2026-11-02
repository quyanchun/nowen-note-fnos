import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../src/db/migrations";

test("notebook share links migration creates token-backed links", () => {
  const migration = MIGRATIONS.find((m) => m.name === "notebook-share-links");
  assert.ok(migration, "notebook-share-links migration should be registered");

  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL
    );

    CREATE TABLE notebooks (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    INSERT INTO users (id, username, passwordHash) VALUES ('owner', 'owner', 'hash');
    INSERT INTO notebooks (id, userId, name) VALUES ('nb-1', 'owner', 'Notebook');
  `);

  migration.up(db);

  db.prepare(
    `INSERT INTO notebook_share_links
       (id, notebookId, token, role, enabled, createdBy)
     VALUES ('link-1', 'nb-1', 'token-1', 'viewer', 1, 'owner')`,
  ).run();

  const link = db
    .prepare("SELECT notebookId, token, role, enabled, createdBy FROM notebook_share_links")
    .get();
  assert.deepEqual(link, {
    notebookId: "nb-1",
    token: "token-1",
    role: "viewer",
    enabled: 1,
    createdBy: "owner",
  });

  assert.throws(
    () => {
      db.prepare(
        `INSERT INTO notebook_share_links
           (id, notebookId, token, role, enabled, createdBy)
         VALUES ('link-2', 'nb-1', 'token-1', 'viewer', 1, 'owner')`,
      ).run();
    },
    /UNIQUE constraint failed/,
  );

  db.close();
});
