import { envelope } from "../../frontend/src/lib/encryptedNotes/__tests__/fixtures/envelope-v1.json";
import { ensureSearchNotebookExclusionsTable } from "../src/services/searchNotebookExclusions";
import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { getDb, closeDb } from "../src/db/schema";
import searchRouter from "../src/routes/search";
import { initVecStore, upsertVectors } from "../src/services/vec-store";
import { setUserAISettings } from "../src/services/user-ai-settings";

const owner = "semantic-owner";
const app = new Hono().route("/search", searchRouter);
const originalFetch = globalThis.fetch;
let calls = 0;
let fail = false;
let duringEmbedding: (() => void) | undefined;
async function query(q: string, extra = "&semantic=1", user = owner) {
  const response = await app.request(`/search?q=${encodeURIComponent(q)}${extra}`, { headers: { "X-User-Id": user } });
  return { status: response.status, rows: await response.json() as any[] };
}
test.before(() => {
  const db = getDb();
  ensureSearchNotebookExclusionsTable(db);
  for (const user of [owner, "semantic-other"]) {
    db.prepare("INSERT INTO users(id,username,passwordHash) VALUES(?,?,'hash')").run(user, user);
    db.prepare("INSERT INTO notebooks(id,userId,name) VALUES(?,?,?)").run(user, user, user);
  }
  db.prepare("INSERT INTO notebooks(id,userId,name) VALUES('excluded',?,'Excluded')").run(owner);
  const insert = db.prepare("INSERT INTO notes(id,userId,notebookId,title,content,contentText,contentFormat) VALUES(?,?,?,?,?,?,'markdown')");
  initVecStore();
  const embedding = db.prepare("INSERT INTO note_embeddings(noteId,userId,chunkIndex,chunkText,vectorJson,model,dim) VALUES(?,?,0,?,?,'test',2)");
  const fixtures = [
    ["near", owner, owner, "旅行清单", "带上雨伞和雨衣，避免淋湿。", [1, 0]],
    ["far", owner, owner, "雨天出门", "今天下午会下雨", [0, 1]],
    ["stale", owner, owner, "已修改正文", "当前可见文字 <script>alert(1)</script>", [0.8, 0.1]],
    ["excluded-note", owner, "excluded", "隐藏的分类", "不可返回此目录", [1, 0]],
    ["other-note", "semantic-other", "semantic-other", "其他账号", "其他账号的私密正文", [1, 0]],
    ["trash", owner, owner, "已删除", "回收站正文", [1, 0]],
    [envelope.objectId, owner, owner, "加密笔记", "旧明文禁止出现", [1, 0]],
  ] as const;
  for (const [id, user, notebook, title, body, vector] of fixtures) {
    if (id === envelope.objectId) db.prepare("INSERT INTO notes(id,userId,notebookId,title,content,contentText,contentFormat) VALUES(?,?,?,?,?,'','encrypted-note-v1')").run(id, user, notebook, title, JSON.stringify(envelope));
    else insert.run(id, user, notebook, title, body, body);
    if (id === envelope.objectId) {
      assert.throws(() => embedding.run(id, user, body, JSON.stringify(vector)), /ENCRYPTED_NOTE_DERIVED_CONTENT_FORBIDDEN/);
      continue;
    }
    const row = embedding.run(id, user, id === "stale" ? "SECRET旧正文不应泄漏" : body, JSON.stringify(vector));
    upsertVectors([{ rowid: Number(row.lastInsertRowid), vector: [...vector] }]);
  }
  db.prepare("UPDATE notes SET isTrashed=1 WHERE id='trash'").run();
  db.prepare("INSERT INTO user_search_notebook_exclusions(userId,notebookId,includeDescendants) VALUES(?,'excluded',1)").run(owner);
  setUserAISettings(owner, [
    { key: "ai_embedding_url", value: "https://embedding.example/v1" },
    { key: "ai_embedding_model", value: "test" },
    { key: "ai_embedding_key", value: "synthetic-key" },
  ]);
  globalThis.fetch = (async () => {
    calls++; duringEmbedding?.();
    return new Response(JSON.stringify(fail ? { error: "unavailable" } : { data: [{ index: 0, embedding: [1, 0] }] }), { status: fail ? 503 : 200 });
  }) as typeof fetch;
});
test.after(() => { globalThis.fetch = originalFetch; closeDb(); });

test("semantic-only search ranks by real vector distance without inventing keyword matches", async () => {
  const { status, rows } = await query("如何防止被淋湿");
  assert.equal(status, 200); assert.equal(rows[0].id, "near");
  assert.equal(rows[0].retrieval, "vector"); assert.equal(rows[0].matchCount, 0);
  assert.equal(rows[0].matchedField, "semantic"); assert.equal(rows[0].semanticDistance, 0);
  assert.equal(rows[0].score, undefined); assert.equal(rows[0].semanticRelevance, 1); assert.ok(rows.at(-1).semanticRelevance < 1);
});
test("hybrid results deduplicate, highlight keywords, escape HTML and never expose old chunks", async () => {
  const { rows } = await query("雨天"); const row = rows.find(r => r.id === "far");
  assert.equal(rows.filter(r => r.id === row.id).length, 1);
  assert.equal(row.retrieval, "hybrid"); assert.ok(row.titleHtml.includes("<mark>雨天</mark>"));
  const stale = rows.find(r => r.id === "stale");
  assert.ok(!stale.snippetHtml.includes("<script>")); assert.ok(!stale.snippetHtml.includes("SECRET"));
  assert.ok(stale.snippetHtml.includes("当前可见文字"));
});
test("vector results enforce account/workspace, trash, encryption and excluded folders (DCC-006)", async () => {
  const ids = (await query("如何防止被淋湿")).rows.map(r => r.id);
  for (const id of ["excluded-note", "other-note", "trash", envelope.objectId]) assert.ok(!ids.includes(id), id);
  assert.equal((await query("如何防止被淋湿", "&semantic=1&workspaceId=unauthorized")).status, 403);
  assert.ok((await query("如何防止被淋湿", "&semantic=1&includeExcluded=1")).rows.some(r => r.id === "excluded-note"));
});
test("ordinary search does not call embeddings or invent a similarity percentage", async () => {
  const before = calls; const { rows } = await query("雨天", "");
  assert.equal(calls, before); assert.equal(rows[0].id, "far"); assert.equal(rows[0].semanticRelevance, undefined);
});
test("embedding failure keeps keyword search usable", async () => {
  fail = true;
  try { const { rows } = await query("雨天"); assert.equal(rows[0].id, "far"); assert.equal(rows[0].semanticRelevance, undefined); }
  finally { fail = false; }
});
test("deletion during inference cannot return an earlier keyword body (DCC-006)", async () => {
  duringEmbedding = () => { getDb().prepare("UPDATE notes SET isTrashed=1 WHERE id='far'").run(); };
  try { assert.ok(!(await query("雨天")).rows.some(r => r.id === "far")); }
  finally { duringEmbedding = undefined; }
});
