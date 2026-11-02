import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Hono } from "hono";
import type Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-folder-sync-policy-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.NOWEN_DATA_DIR = path.join(tmpDir, "data");

let app: Hono;
let getDb: () => Database.Database;
let closeDb: () => void;

const USER_ID = "folder-sync-policy-user";
const NOTEBOOK_ID = "folder-sync-policy-notebook";

function db(): Database.Database {
  return getDb();
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function postJson(url: string, body: unknown): Promise<{ status: number; json: any }> {
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

function importPayload(sourcePathHash: string, relativePath: string, contentText: string, conflictPolicy?: string) {
  return {
    filename: path.posix.basename(relativePath),
    relativePath,
    sha256: hash(contentText),
    targetNotebookId: NOTEBOOK_ID,
    contentText,
    sourcePathHash,
    conflictPolicy,
  };
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
    .run(NOTEBOOK_ID, USER_ID, "Synchronized");
});

test.after(() => {
  closeDb();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may release handles later */ }
});

test("protect blocks silent overwrite and copy preserves the edited Nowen note", async () => {
  const sourcePathHash = "a".repeat(64);
  const created = await postJson(
    "/folder-sync/import-file",
    importPayload(sourcePathHash, "docs/spec.md", "source version one"),
  );
  assert.equal(created.status, 200);
  assert.equal(created.json.created, true);
  const trackedNoteId = created.json.noteId as string;
  const initial = db().prepare("SELECT content FROM notes WHERE id = ?").get(trackedNoteId) as { content: string };
  const manuallyEdited = initial.content.replace(
    "<!-- nowen-folder-sync:",
    "manual Nowen edit\n\n<!-- nowen-folder-sync:",
  );

  db().prepare(`
    UPDATE notes
       SET content = ?, contentText = ?, updatedAt = datetime('now')
     WHERE id = ?
  `).run(manuallyEdited, "source version one\nmanual Nowen edit", trackedNoteId);

  const protectedResult = await postJson(
    "/folder-sync/import-file",
    importPayload(sourcePathHash, "docs/spec.md", "source version two", "protect"),
  );
  assert.equal(protectedResult.status, 409);
  assert.equal(protectedResult.json.code, "SYNC_CONFLICT");
  const protectedNote = db().prepare("SELECT content FROM notes WHERE id = ?").get(trackedNoteId) as { content: string };
  assert.match(protectedNote.content, /manual Nowen edit/);

  const copiedResult = await postJson(
    "/folder-sync/import-file",
    importPayload(sourcePathHash, "docs/spec.md", "source version two", "copy"),
  );
  assert.equal(copiedResult.status, 200);
  assert.equal(copiedResult.json.updated, true);
  assert.ok(copiedResult.json.conflictCopyNoteId);

  const tracked = db().prepare("SELECT content FROM notes WHERE id = ?").get(trackedNoteId) as { content: string };
  assert.match(tracked.content, /source version two/);
  assert.match(tracked.content, /contentHash=/);

  const copy = db().prepare("SELECT content FROM notes WHERE id = ?").get(copiedResult.json.conflictCopyNoteId) as { content: string };
  assert.match(copy.content, /manual Nowen edit/);
  assert.doesNotMatch(copy.content, /nowen-folder-sync:/);
});

test("rename with unchanged bytes updates the mapping and reuses the same note", async () => {
  const sourcePathHash = "d".repeat(64);
  const sourceContent = "same bytes after rename";
  const created = await postJson(
    "/folder-sync/import-file",
    importPayload(sourcePathHash, "old/report.md", sourceContent),
  );
  assert.equal(created.status, 200);

  const renamed = await postJson(
    "/folder-sync/import-file",
    importPayload(sourcePathHash, "renamed/report-final.md", sourceContent),
  );
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.updated, true);
  assert.equal(renamed.json.noteId, created.json.noteId);

  const mapping = db().prepare(`
    SELECT relativePath, filename, noteId FROM folder_sync_files WHERE sourcePathHash = ?
  `).get(sourcePathHash) as { relativePath: string; filename: string; noteId: string };
  assert.equal(mapping.relativePath, "renamed/report-final.md");
  assert.equal(mapping.filename, "report-final.md");
  assert.equal(mapping.noteId, created.json.noteId);

  const note = db().prepare("SELECT title, content FROM notes WHERE id = ?").get(created.json.noteId) as { title: string; content: string };
  assert.equal(note.title, "report-final");
  assert.match(note.content, /renamed%2Freport-final.md/);
  const count = db().prepare("SELECT COUNT(*) AS count FROM notes WHERE id = ?").get(created.json.noteId) as { count: number };
  assert.equal(count.count, 1);
});

test("detach keeps note content but removes tracking metadata and mapping", async () => {
  const sourcePathHash = "b".repeat(64);
  const created = await postJson(
    "/folder-sync/import-file",
    importPayload(sourcePathHash, "docs/detach.md", "keep this content"),
  );
  assert.equal(created.status, 200);

  const detached = await postJson("/folder-sync/source-deleted", {
    sourcePathHash,
    policy: "detach",
  });
  assert.equal(detached.status, 200);
  assert.equal(detached.json.action, "detach");
  assert.equal(detached.json.mappingRemoved, true);

  const note = db().prepare("SELECT content, isTrashed FROM notes WHERE id = ?").get(created.json.noteId) as { content: string; isTrashed: number };
  assert.match(note.content, /keep this content/);
  assert.doesNotMatch(note.content, /nowen-folder-sync:/);
  assert.equal(note.isTrashed, 0);
  const mapping = db().prepare("SELECT COUNT(*) AS count FROM folder_sync_files WHERE sourcePathHash = ?").get(sourcePathHash) as { count: number };
  assert.equal(mapping.count, 0);
});

test("trash policy moves a deleted source note to the recycle bin", async () => {
  const sourcePathHash = "c".repeat(64);
  const created = await postJson(
    "/folder-sync/import-file",
    importPayload(sourcePathHash, "docs/trash.md", "trash source"),
  );
  assert.equal(created.status, 200);

  const trashed = await postJson("/folder-sync/source-deleted", {
    sourcePathHash,
    policy: "trash",
  });
  assert.equal(trashed.status, 200);
  assert.equal(trashed.json.action, "trash");

  const note = db().prepare("SELECT isTrashed FROM notes WHERE id = ?").get(created.json.noteId) as { isTrashed: number };
  assert.equal(note.isTrashed, 1);
});
