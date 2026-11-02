import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-note-icons-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

const OWNER_ID = "note-icon-owner";
const OTHER_ID = "note-icon-other";
const NOTEBOOK_ID = "note-icon-notebook";
const NOTE_ID = "note-icon-note";

let app: Hono;
let getDb: () => Database.Database;
let closeDb: () => void;

function db() {
  return getDb();
}

async function requestJson(userId: string, method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: {
      "X-User-Id": userId,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test.before(async () => {
  const [routeModule, schemaModule] = await Promise.all([
    import("../src/routes/user-preferences"),
    import("../src/db/schema"),
  ]);

  app = new Hono();
  app.route("/user-preferences", routeModule.default);
  getDb = schemaModule.getDb;
  closeDb = schemaModule.closeDb;

  db().prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)")
    .run(OWNER_ID, OWNER_ID, "hash");
  db().prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)")
    .run(OTHER_ID, OTHER_ID, "hash");
  db().prepare("INSERT INTO notebooks (id, userId, name) VALUES (?, ?, ?)")
    .run(NOTEBOOK_ID, OWNER_ID, "Icons");
  db().prepare("INSERT INTO notes (id, userId, notebookId, title) VALUES (?, ?, ?, ?)")
    .run(NOTE_ID, OWNER_ID, NOTEBOOK_ID, "Icon note");
});

test.after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("owner can set, batch-read, and remove a note icon", async () => {
  const saved = await requestJson(
    OWNER_ID,
    "PUT",
    `/user-preferences/note-icons/${NOTE_ID}`,
    { icon: "📝" },
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.json.icon, "📝");

  const listed = await requestJson(
    OWNER_ID,
    "GET",
    `/user-preferences/note-icons?ids=${NOTE_ID},missing-note`,
  );
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.json.icons, { [NOTE_ID]: "📝" });

  const removed = await requestJson(
    OWNER_ID,
    "PUT",
    `/user-preferences/note-icons/${NOTE_ID}`,
    { icon: null },
  );
  assert.equal(removed.status, 200);
  assert.equal(removed.json.icon, null);

  const afterRemove = await requestJson(
    OWNER_ID,
    "GET",
    `/user-preferences/note-icons?ids=${NOTE_ID}`,
  );
  assert.deepEqual(afterRemove.json.icons, {});
});

test("unauthorized users cannot read or update personal note icons", async () => {
  await requestJson(
    OWNER_ID,
    "PUT",
    `/user-preferences/note-icons/${NOTE_ID}`,
    { icon: "🔒" },
  );

  const listed = await requestJson(
    OTHER_ID,
    "GET",
    `/user-preferences/note-icons?ids=${NOTE_ID}`,
  );
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.json.icons, {});

  const update = await requestJson(
    OTHER_ID,
    "PUT",
    `/user-preferences/note-icons/${NOTE_ID}`,
    { icon: "❌" },
  );
  assert.equal(update.status, 403);
  assert.equal(update.json.code, "FORBIDDEN");
});

test("locked notes reject icon changes", async () => {
  db().prepare("UPDATE notes SET isLocked = 1 WHERE id = ?").run(NOTE_ID);
  const response = await requestJson(
    OWNER_ID,
    "PUT",
    `/user-preferences/note-icons/${NOTE_ID}`,
    { icon: "🔐" },
  );
  assert.equal(response.status, 403);
  assert.equal(response.json.code, "NOTE_LOCKED");
  db().prepare("UPDATE notes SET isLocked = 0 WHERE id = ?").run(NOTE_ID);
});

test("invalid icons are rejected without overwriting stored data", async () => {
  await requestJson(
    OWNER_ID,
    "PUT",
    `/user-preferences/note-icons/${NOTE_ID}`,
    { icon: "✅" },
  );

  const response = await requestJson(
    OWNER_ID,
    "PUT",
    `/user-preferences/note-icons/${NOTE_ID}`,
    { icon: "x".repeat(33) },
  );
  assert.equal(response.status, 400);
  assert.equal(response.json.code, "INVALID_NOTE_ICON");

  const listed = await requestJson(
    OWNER_ID,
    "GET",
    `/user-preferences/note-icons?ids=${NOTE_ID}`,
  );
  assert.deepEqual(listed.json.icons, { [NOTE_ID]: "✅" });
});
