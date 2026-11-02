import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-web-auth-test-"));
process.env.DB_PATH = path.join(directory, "test.db");
process.env.JWT_SECRET = "isolated-web-login-test-secret-long-enough";
process.env.NOWEN_WEB_PUBLIC_URL = "http://nas.test:3504/";
process.env.NOWEN_FNOS_PORTAL_URL = "http://nas.test/";

test("independent NAS web entry binds approval to browser, account and single use (DCC-006)", async t => {
  const { getDb, closeDb } = await import("../src/db/schema");
  const { default: auth } = await import("../src/routes/auth");
  const { dispatchFnosGateway } = await import("../src/services/fnos-gateway");
  const { verifyLoginToken, bumpTokenVersion } = await import("../src/lib/auth-security");
  const { fnosWebOptions } = await import("../src/services/fnos-web-auth");
  const db = getDb(), app = new Hono(); app.route("/api/auth", auth);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("invalid token")) as typeof fetch;
  const web = "http://nas.test:3504", portal = "http://nas.test";
  let sequence = 0;
  const post = (endpoint: string, body: unknown, cookie = "", origin = web) => app.request(web + "/api/auth/web/" + endpoint, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie, "X-Real-IP": `test-${++sequence}` }, body: JSON.stringify(body) });
  const start = async () => {
    const response = await post("start", {}); assert.equal(response.status, 200);
    const body = await response.json() as any;
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(response.headers.get("set-cookie")!, /SameSite=Lax/i);
    assert.equal(body.portalUrl, portal + "/");
    assert.ok(!body.portalUrl.includes(body.proof));
    return { ...body, cookie };
  };
  const authorize = async (attempt: any, uid = "1000", extra: Record<string, string> = {}) => {
    const url = portal + "/app/nowen-note-private/api/auth/web/authorize?requestId=" + attempt.id;
    const headers = { Cookie: attempt.cookie, "X-Trim-Userid": uid, "X-Trim-Username": `nas_${uid}`, "X-Trim-Isadmin": "false", ...extra };
    const page = await dispatchFnosGateway(new Request(url, { headers }), app);
    assert.equal(page.status, 200, await page.clone().text());
    assert.deepEqual(await page.clone().json(), { authorized: true });
    return page;
  };
  let userId = "";
  await t.test("options expose only fixed public origins and reject unsafe configuration", async () => {
    assert.deepEqual(await (await app.request("/api/auth/web/options")).json(), { enabled: true, webOrigin: web, portalOrigin: portal });
    for (const value of ["http://other.test/", "https://nas.test/", "http://nas.test/?redirect=evil", "http://name:secret@nas.test/"]) {
      process.env.NOWEN_FNOS_PORTAL_URL = value; assert.equal(fnosWebOptions(), null);
    }
    process.env.NOWEN_FNOS_PORTAL_URL = portal + "/";
  });
  await t.test("start rejects absent/cross-site origins and never trusts a callback URL", async () => {
    assert.equal((await post("start", {}, "", "http://evil.test")).status, 403);
    assert.equal((await app.request("/api/auth/web/start", { method: "POST" })).status, 403);
    const r = await post("start", { callback: "http://evil.test" });
    assert.equal(new URL((await r.json() as any).portalUrl).origin, portal);
  });
  await t.test("pending login requires both browser binding and polling proof", async () => {
    const a = await start();
    assert.equal((await post("poll", a)).status, 410);
    assert.equal((await post("poll", { id: a.id }, a.cookie)).status, 403);
    assert.equal((await post("poll", { id: a.id, proof: "x".repeat(43) }, a.cookie)).status, 410);
    assert.equal((await post("poll", a, a.cookie, "http://evil.test")).status, 403);
    assert.equal((await (await post("poll", a, a.cookie)).json() as any).status, "waiting");
  });
  await t.test("ordinary HTTP headers cannot approve a NAS identity", async () => {
    const a = await start();
    const response = await app.request(web + "/api/auth/web/authorize?requestId=" + a.id, { headers: { Cookie: a.cookie, "X-Trim-Userid": "1000", "X-Trim-Username": "forged", "X-Trim-Isadmin": "true" } });
    assert.equal(response.status, 401);
  });
  await t.test("NAS login rejects a different browser, cross-site navigation and forged POST", async () => {
    const a = await start(), b = await start();
    const url = portal + "/app/nowen-note-private/api/auth/web/authorize?requestId=" + a.id;
    const headers = { Cookie: b.cookie, "X-Trim-Userid": "1000", "X-Trim-Username": "nas_1000", "X-Trim-Isadmin": "false" };
    assert.equal((await dispatchFnosGateway(new Request(url, { headers }), app)).status, 410);
    headers.Cookie = a.cookie;
    assert.equal((await dispatchFnosGateway(new Request(url, { headers: { ...headers, "Sec-Fetch-Site": "cross-site" } }), app)).status, 403);
    assert.equal((await dispatchFnosGateway(new Request(url, { method: "POST", headers: { ...headers, Origin: portal } }), app)).status, 404);
  });
  await t.test("confirmed NAS approval logs into its existing account exactly once", async () => {
    const a = await start(); assert.equal((await authorize(a)).status, 200);
    const result = await (await post("poll", a, a.cookie)).json() as any;
    assert.equal(result.status, "connected"); userId = result.login.user.id;
    assert.equal(verifyLoginToken(result.login.token)?.userId, userId);
    assert.ok(result.login.refreshToken); assert.ok(!result.login.user.passwordHash);
    assert.equal((await post("poll", a, a.cookie)).status, 410);
    const b = await start(); await authorize(b);
    assert.equal((await (await post("poll", b, b.cookie)).json() as any).login.user.id, userId);
  });
  await t.test("another NAS account never receives the previous user's identity", async () => {
    const a = await start(); await authorize(a, "1001");
    const result = await (await post("poll", a, a.cookie)).json() as any;
    assert.notEqual(result.login.user.id, userId);
  });
  await t.test("NAS session is verified at its fixed gateway and concurrent polls consume it once", async () => {
    const a = await start();
    let probes = 0;
    globalThis.fetch = (async (input: any, init: any) => {
      probes++;
      const url = new URL(String(input));
      assert.equal(url.origin, portal);
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.Cookie, a.cookie);
      assert.equal(init.headers.Authorization, undefined);
      await Promise.resolve();
      return dispatchFnosGateway(new Request(url, { headers: { Cookie: a.cookie, "X-Trim-Userid": "1000", "X-Trim-Username": "nas_1000", "X-Trim-Isadmin": "false" } }), app);
    }) as typeof fetch;
    const before = (db.prepare("SELECT count(*) n FROM user_sessions").get() as any).n;
    const responses = await Promise.all([post("poll", a, a.cookie), post("poll", a, a.cookie)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 410]);
    assert.equal(probes, 1);
    assert.equal((db.prepare("SELECT count(*) n FROM user_sessions").get() as any).n, before + 1);
    globalThis.fetch = (async () => new Response("invalid token")) as typeof fetch;
  });
  await t.test("revocation or disabling between approval and poll blocks login", async () => {
    const a = await start(); await authorize(a); bumpTokenVersion(db, userId);
    assert.equal((await post("poll", a, a.cookie)).status, 403);
    const b = await start(); await authorize(b); db.prepare("UPDATE users SET isDisabled=1 WHERE id=?").run(userId);
    assert.equal((await post("poll", b, b.cookie)).status, 403);
    db.prepare("UPDATE users SET isDisabled=0 WHERE id=?").run(userId);
  });
  await t.test("role changes after approval cannot restore obsolete privileges", async () => {
    const a = await start(); await authorize(a); db.prepare("UPDATE users SET role='admin' WHERE id=?").run(userId);
    assert.equal((await post("poll", a, a.cookie)).status, 403);
    db.prepare("UPDATE users SET role='user' WHERE id=?").run(userId);
  });
  await t.test("cancel and expiry leave no reusable authorization", async () => {
    const a = await start(); assert.equal((await post("cancel", a, a.cookie)).status, 200);
    assert.equal((await post("poll", a, a.cookie)).status, 410);
    const b = await start(), now = Date.now;
    try { Date.now = () => now() + 301000; assert.equal((await post("poll", b, b.cookie)).status, 410); }
    finally { Date.now = now; }
  });
  globalThis.fetch = originalFetch;
  closeDb(); fs.rmSync(directory, { recursive: true, force: true });
});
