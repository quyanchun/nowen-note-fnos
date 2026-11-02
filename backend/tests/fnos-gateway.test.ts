import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-fnos-test-"));
process.env.DB_PATH = path.join(directory, "test.db");
process.env.JWT_SECRET = "fnos-gateway-isolated-test-signing-secret";

test("fnOS SSO binds transport, account and writes to the current NAS identity (DCC-006)", async () => {
  const { getDb, closeDb } = await import("../src/db/schema");
  const { default: auth } = await import("../src/routes/auth");
  const { dispatchFnosGateway, FNOS_PREFIX } = await import("../src/services/fnos-gateway");
  const { verifyLoginToken } = await import("../src/lib/auth-security");
  const { default: bcrypt } = await import("bcryptjs");
  const { getFnosAccount, parseFnosIdentity } = await import("../src/lib/fnos-identity");
  const app = new Hono();
  app.route("/api/auth", auth);
  let writes = 0;
  app.post("/api/probe", (c) => {
    const identity = verifyLoginToken((c.req.header("Authorization") || "").slice(7));
    if (!identity) return c.json({ error: "unauthorized" }, 401);
    writes += 1; return c.json({ userId: identity.userId });
  });
  const header = (uid: string, admin = false) => ({ "X-Trim-Userid": uid, "X-Trim-Username": `nas_${uid}`, "X-Trim-Isadmin": String(admin) });
  const gateway = (uid: string, endpoint = "/api/auth/fnos", extra: Record<string, string> = {}, admin = false) =>
    dispatchFnosGateway(new Request(`http://nas.test${FNOS_PREFIX}${endpoint}`, { method: "POST", headers: { ...header(uid, admin), ...extra } }), app);

  const forged = await app.request("/api/auth/fnos", { method: "POST", headers: header("1000", true) });
  assert.equal(forged.status, 401, "ordinary HTTP cannot assert NAS identity");
  const missing = await dispatchFnosGateway(new Request(`http://nas.test${FNOS_PREFIX}/api/auth/fnos`, { method: "POST" }), app);
  assert.equal(missing.status, 401);
  assert.equal(parseFnosIdentity(new Headers({ ...header("1000"), "X-Trim-Userid": "1000,1001" })), null);
  assert.equal(parseFnosIdentity(new Headers({ ...header("1000"), "X-Trim-Isadmin": "1" })), null);

  const db = getDb();
  assert.equal((await gateway("1002", "/api/probe")).status, 401, "NAS session alone must not log into notes");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM users").get() as any).n, 0, "opening an unauthenticated API must not provision a NAS account");
  db.prepare("INSERT INTO users (id, username, passwordHash, role) VALUES (?, ?, ?, 'user')")
    .run("local-password-user", "independent", bcrypt.hashSync("isolated-test-password", 10));
  const localLogin = await dispatchFnosGateway(new Request(`http://nas.test${FNOS_PREFIX}/api/auth/login`, {
    method: "POST", headers: { ...header("1000"), "Content-Type": "application/json" },
    body: JSON.stringify({ username: "independent", password: "isolated-test-password" }),
  }), app);
  assert.equal(localLogin.status, 200);
  const local = await localLogin.json() as any;
  const localWrite = await gateway("1000", "/api/probe", { Authorization: `Bearer ${local.token}` });
  assert.equal(localWrite.status, 200, "independent password accounts work through the NAS gateway");
  assert.equal((await localWrite.json() as any).userId, "local-password-user");
  const localRefresh = await dispatchFnosGateway(new Request(`http://nas.test${FNOS_PREFIX}/api/auth/refresh`, {
    method: "POST", headers: { ...header("1000"), "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: local.refreshToken }),
  }), app);
  assert.equal(localRefresh.status, 200, "independent accounts can refresh their own sessions");
  writes = 0;
  db.prepare("INSERT INTO users (id, username, passwordHash, role) VALUES ('existing-local', 'fnos_1000', 'unused', 'admin')").run();
  const a = await (await gateway("1000", undefined, {}, true)).json() as any;
  assert.notEqual(a.user.id, "existing-local", "same-name local accounts are never taken over");
  assert.equal(a.user.role, "admin");
  const repeated = await (await gateway("1000", undefined, { Authorization: `Bearer ${a.token}` }, true)).json() as any;
  assert.equal(repeated.user.id, a.user.id);
  assert.equal(repeated.token, a.token, "second tabs reuse a valid token");
  const nativeLogin = async (deviceId: string) => (await (await dispatchFnosGateway(new Request(`http://nas.test${FNOS_PREFIX}/api/auth/fnos`, {
    method: "POST", headers: { ...header("1000", true), "Content-Type": "application/json" }, body: JSON.stringify({ deviceId }),
  }), app)).json()) as any;
  const native = await nativeLogin("synthetic-native-device-a");
  const nativeAgain = await nativeLogin("synthetic-native-device-a");
  const otherNative = await nativeLogin("synthetic-native-device-b");
  assert.notEqual(verifyLoginToken(native.token)?.jti, verifyLoginToken(a.token)?.jti, "native revocation must not revoke the browser session");
  assert.equal(verifyLoginToken(native.token)?.jti, verifyLoginToken(nativeAgain.token)?.jti);
  assert.notEqual(verifyLoginToken(native.token)?.jti, verifyLoginToken(otherNative.token)?.jti);

  assert.equal((db.prepare("SELECT COUNT(*) n FROM notes WHERE userId = ?").get(a.user.id) as any).n, 0, "new NAS accounts remain empty");

  const b = await (await gateway("1001")).json() as any;
  assert.notEqual(b.user.id, a.user.id);
  assert.equal(b.user.role, "user");
  const crossIdentityRefresh = await dispatchFnosGateway(new Request(`http://nas.test${FNOS_PREFIX}/api/auth/refresh`, {
    method: "POST", headers: { ...header("1001"), "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: a.refreshToken }),
  }), app);
  assert.equal(crossIdentityRefresh.status, 401, "refresh tokens cannot cross NAS identities");
  const stale = await gateway("1001", "/api/probe", { Authorization: `Bearer ${a.token}` });
  assert.equal(stale.status, 401, "late writes from the previous NAS user fail closed");
  assert.equal(writes, 0);
  assert.equal((await gateway("1001", "/api/probe", { Origin: "https://hostile.test" })).status, 403);
  assert.equal(writes, 0);
  assert.equal((await gateway("1001", "/api/probe", { Authorization: `Bearer ${b.token}`, Origin: "http://nas.test" })).status, 200);
  assert.equal(writes, 1);
  assert.equal((await gateway("1001", "/api/probe", { "Sec-Fetch-Site": "cross-site" })).status, 403);
  const wrongPrefix = await dispatchFnosGateway(new Request("http://nas.test/api/auth/fnos", { method: "POST", headers: header("1000") }), app);
  assert.equal(wrongPrefix.status, 404);

  const demoted = getFnosAccount({ uid: "1000", username: "renamed", isAdmin: false });
  assert.equal(demoted.id, a.user.id);
  assert.equal(demoted.role, "user");
  assert.equal(demoted.displayName, "renamed");
  closeDb();
  assert.equal(getFnosAccount({ uid: "1000", username: "renamed", isAdmin: false }).id, a.user.id, "mapping survives database reopen");
  getDb().prepare("UPDATE users SET isDisabled = 1 WHERE id = ?").run(b.user.id);
  assert.equal((await gateway("1001")).status, 403, "disabled application accounts stay disabled");
  closeDb();
});
