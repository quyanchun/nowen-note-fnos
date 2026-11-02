import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";

const require = createRequire(import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-private-media-"));
process.env.DB_PATH = path.join(dir, "test.db");
process.env.ELECTRON_USER_DATA = dir;
process.env.JWT_SECRET = "local-security-regression-secret-long-enough";
let close: (() => void) | undefined;
test.after(() => { close?.(); fs.rmSync(dir, { recursive: true, force: true }); });

test("DCC-006: private media capabilities are file-bound, session-bound and revocable", async () => {
  const { getDb, closeDb } = await import("../src/db/schema"); close = closeDb;
  const { signLoginToken } = await import("../src/lib/auth-security");
  const { resolvePrivateMediaIdentity, privateMediaAccessResponse } = require("../src/lib/private-media-access") as typeof import("../src/lib/private-media-access");
  const db = getDb();
  db.prepare("INSERT INTO users(id,username,passwordHash,tokenVersion) VALUES ('owner','owner','hash',0)").run();
  db.prepare("INSERT INTO user_sessions(id,userId) VALUES ('session','owner')").run();
  const login = signLoginToken({ userId: "owner", username: "owner", tokenVersion: 0, jti: "session" });
  const app = new Hono();
  for (const kind of ["task", "diary"] as const) app.get(`/${kind}/:id`, c => {
    const id = c.req.param("id");
    const identity = resolvePrivateMediaIdentity(c, kind, id);
    if (!identity) return c.json({ error: "denied" }, 404);
    if (c.req.query("access") === "1") return privateMediaAccessResponse(c, kind, id, identity);
    return c.text("synthetic-media");
  });
  assert.equal((await app.request("/task/a")).status, 404);
  assert.equal((await app.request("/task/a", { headers: { "X-User-Id": "owner" } })).status, 404);
  const minted = await app.request("/task/a?access=1", { headers: { Authorization: `Bearer ${login}` } });
  assert.equal(minted.status, 200);
  assert.match(minted.headers.get("Cache-Control") || "", /no-store/);
  const { url } = await minted.json() as { url: string };
  const query = new URL(url, "http://local").search;
  assert.equal((await app.request(`/task/a${query}`)).status, 200);
  assert.equal((await app.request(`/task/b${query}`)).status, 404);
  assert.equal((await app.request(`/diary/a${query}`)).status, 404);
  assert.equal((await app.request(`/task/a${query}&access=1`)).status, 404);
  assert.equal((await app.request(`/task/a${query}tampered`)).status, 404);
  const { getFnosAccount } = require("../src/lib/fnos-identity") as typeof import("../src/lib/fnos-identity");
  getFnosAccount({ uid: "1000", username: "nas_owner", isAdmin: false });
  db.prepare("INSERT INTO fnos_identities(uid,userId) VALUES ('2000','owner')").run();
  const { dispatchFnosGateway, FNOS_PREFIX } = require("../src/services/fnos-gateway") as typeof import("../src/services/fnos-gateway");
  const gatewayMedia = (uid: string) => dispatchFnosGateway(new Request(`http://nas.test${FNOS_PREFIX}/task/a${query}`, {
    headers: { "X-Trim-Userid": uid, "X-Trim-Username": `nas_${uid}`, "X-Trim-Isadmin": "false" },
  }), app);
  assert.equal((await gatewayMedia("2000")).status, 200);
  assert.equal((await gatewayMedia("2001")).status, 404, "media capabilities cannot cross NAS identities");
  db.prepare("UPDATE user_sessions SET revokedAt = datetime('now') WHERE id = 'session'").run();
  assert.equal((await app.request(`/task/a${query}`)).status, 404);
  db.prepare("UPDATE user_sessions SET revokedAt = NULL WHERE id = 'session'").run();
  db.prepare("UPDATE users SET isDisabled = 1 WHERE id = 'owner'").run();
  assert.equal((await app.request(`/task/a${query}`)).status, 404);
});

test("pre-JWT attachment checks retain persisted notebook grants", async () => {
  const { getDb } = await import("../src/db/schema");
  const { initApiTokensTable, hashApiToken } = await import("../src/lib/api-tokens");
  const { canApiTokenReadAttachment } = await import("../src/middleware/api-token-resource-scope");
  const db = getDb(); initApiTokensTable(db);
  for (const id of ["allowed", "private"]) {
    db.prepare("INSERT INTO notebooks(id,userId,name) VALUES (?, 'owner', ?)").run(id, id);
    db.prepare("INSERT INTO notes(id,userId,notebookId,title,content) VALUES (?, 'owner', ?, ?, '')").run(`note-${id}`, id, id);
    db.prepare("INSERT INTO attachments(id,noteId,userId,filename,mimeType,size,path) VALUES (?,?,'owner','test.txt','text/plain',1,'test.txt')").run(`file-${id}`, `note-${id}`);
  }
  db.prepare("INSERT INTO api_tokens(id,userId,name,tokenHash,scopes,resourceMode) VALUES ('pat','owner','restricted',?,?,'restricted')")
    .run(hashApiToken("nkn_test"), JSON.stringify(["notes:read"]));
  db.prepare("INSERT INTO api_token_resources(id,tokenId,resourceType,resourceId,permission,includeDescendants) VALUES ('grant','pat','notebook','allowed','read',0)").run();
  const token = { tokenId: "pat", userId: "owner", scopes: ["notes:read" as const], resourceMode: "restricted" as const };
  assert.equal(canApiTokenReadAttachment(token, "file-allowed"), true);
  assert.equal(canApiTokenReadAttachment(token, "file-private"), false);
  assert.equal(canApiTokenReadAttachment({ ...token, scopes: [] }, "file-allowed"), false);
  db.prepare("DELETE FROM api_token_resources WHERE tokenId = 'pat'").run();
  assert.equal(canApiTokenReadAttachment(token, "file-allowed"), false);
});
