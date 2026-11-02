import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Hono } from "hono";
import type Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-folder-sync-detach-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.NOWEN_DATA_DIR = path.join(tmpDir, "data");

let app: Hono;
let getDb: () => Database.Database;
let closeDb: () => void;

const USER_ID = "folder-sync-detach-user";
const NOTEBOOK_ID = "folder-sync-detach-notebook";
const SOURCE_PATH_HASH = "e".repeat(64);

function db(): Database.Database {
  return getDb();
}

function sha(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function post(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const response = await app.request(url, {
    method: "POST",
    headers: {
      "X-User-Id": USER_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test.before(async () => {
  const [routeModule, schemaModule] = await Promise.all([
    import("../src/routes/folder-sync"),
    import("../src/db/schema"),
  ]);
  getDb = schemaModule.getDb;
  closeDb = schemaModule.closeDb;
  app = new Hono();
  app.route("/folder-sync", routeModule.default);

  db().prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)")
    .run(USER_ID, USER_ID, "hash");
  db().prepare("INSERT INTO notebooks (id, userId, name) VALUES (?, ?, ?)")
    .run(NOTEBOOK_ID, USER_ID, "Detached conflicts");
});

test.after(() => {
  closeDb();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows can release handles later */ }
});

test("protect then detach preserves the Nowen edit and removes source tracking", async () => {
  const originalText = "source version one";
  const created = await post("/folder-sync/import-file", {
    filename: "policy.md",
    relativePath: "docs/policy.md",
    sha256: sha(originalText),
    targetNotebookId: NOTEBOOK_ID,
    contentText: originalText,
    sourcePathHash: SOURCE_PATH_HASH,
    conflictPolicy: "protect",
  });
  assert.equal(created.status, 200);
  const noteId = created.json.noteId as string;

  const initial = db().prepare("SELECT content FROM notes WHERE id = ?").get(noteId) as { content: string };
  const edited = initial.content.replace(
    "<!-- nowen-folder-sync:",
    "Nowen-only decision\n\n<!-- nowen-folder-sync:",
  );
  db().prepare("UPDATE notes SET content = ?, contentText = ?, updatedAt = datetime('now') WHERE id = ?")
    .run(edited, "source version one\nNowen-only decision", noteId);

  const conflict = await post("/folder-sync/import-file", {
    filename: "policy.md",
    relativePath: "docs/policy.md",
    sha256: sha("source version two"),
    targetNotebookId: NOTEBOOK_ID,
    contentText: "source version two",
    sourcePathHash: SOURCE_PATH_HASH,
    conflictPolicy: "protect",
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.code, "SYNC_CONFLICT");

  const detached = await post("/folder-sync/source-deleted", {
    sourcePathHash: SOURCE_PATH_HASH,
    policy: "detach",
  });
  assert.equal(detached.status, 200);
  assert.equal(detached.json.action, "detach");
  assert.equal(detached.json.mappingRemoved, true);
  assert.equal(detached.json.noteId, noteId);

  const note = db().prepare("SELECT content, contentText, isTrashed FROM notes WHERE id = ?").get(noteId) as {
    content: string;
    contentText: string;
    isTrashed: number;
  };
  assert.match(note.content, /Nowen-only decision/);
  assert.match(note.contentText, /Nowen-only decision/);
  assert.doesNotMatch(note.content, /nowen-folder-sync:/);
  assert.equal(note.isTrashed, 0);

  const mapping = db().prepare("SELECT COUNT(*) AS count FROM folder_sync_files WHERE sourcePathHash = ?")
    .get(SOURCE_PATH_HASH) as { count: number };
  assert.equal(mapping.count, 0);
});
