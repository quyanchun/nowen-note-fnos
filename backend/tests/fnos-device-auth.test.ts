import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Hono } from "hono";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-device-auth-"));
process.env.DB_PATH = path.join(dir, "test.db");
process.env.JWT_SECRET = "isolated-device-authorization-test-secret";
process.env.NOWEN_FNOS_SOCKET = path.join(dir, "app.sock");

test("browser grants bind NAS identity, PKCE, device session and sync-only transport (DCC-006)", async () => {
  const { getDb, closeDb } = await import("../src/db/schema");
  const { dispatchFnosGateway, FNOS_PREFIX } = await import("../src/services/fnos-gateway");
  const { deviceAuthorizationPage, dispatchDeviceGateway, DEVICE_PREFIX, prepareDeviceRealtimeRequest } = await import("../src/services/fnos-device-auth");
  const { verifyLoginToken } = await import("../src/lib/auth-security");
  const { getLinkedFnosUid } = await import("../src/lib/fnos-identity");
  const app = new Hono();
  app.all("/client-authorize", deviceAuthorizationPage);
  app.post("/api/sync/v2/probe", c => c.json({ identity: verifyLoginToken((c.req.header("authorization") || "").slice(7)) }));
  app.get("/api/settings", c => c.text("must not be exposed"));
  const verifier = "v".repeat(43), state = "s".repeat(43);
  const query = new URLSearchParams({ challenge: createHash("sha256").update(verifier).digest("base64url"), state, device: "Test Mac" });
  const url = `http://nas.test${FNOS_PREFIX}/client-authorize?${query}`;
  const headers = { "X-Trim-Userid": "1000", "X-Trim-Username": "owner", "X-Trim-Isadmin": "false" };
  assert.equal((await app.request(`/client-authorize?${query}`, { headers })).status, 401, "forged TCP identity is rejected");
  const page = await dispatchFnosGateway(new Request(url, { headers }), app);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Test Mac/);
  const nonce = html.match(/name="nonce" value="([A-Za-z0-9_-]+)"/)![1];
  const approve = (uid: string, nonceValue = nonce) => dispatchFnosGateway(new Request(url, {
    method: "POST", headers: { ...headers, "X-Trim-Userid": uid, "Content-Type": "application/x-www-form-urlencoded", Origin: "http://nas.test" },
    body: new URLSearchParams({ nonce: nonceValue }),
  }), app);
  assert.equal((await approve("1001")).status, 403, "confirmation is bound to the NAS user who saw it");
  assert.equal((await approve("1000", "forged")).status, 403);
  const approved = await approve("1000");
  assert.equal(approved.status, 200);
  const callback = (await approved.text()).match(/href="(nowen-note-private:[^"]+)"/)![1].replaceAll("&amp;", "&");
  const code = new URL(callback).searchParams.get("code")!;
  assert.equal(new URL(callback).searchParams.get("state"), state);
  assert.equal((await approve("1000")).status, 403, "confirmation is single use");
  const exchange = (proof: string) => dispatchDeviceGateway(new Request(`http://nas.test${DEVICE_PREFIX}/token`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, verifier: proof }),
  }), app);
  assert.equal((await exchange("x".repeat(43))).status, 401, "intercepted code alone grants nothing");
  const exchanged = await exchange(verifier);
  assert.equal(exchanged.status, 200);
  const grant = await exchanged.json() as any;
  assert.match(grant.token, /^nnd_/);
  assert.equal(getLinkedFnosUid(grant.user.id), "1000");
  assert.equal((await exchange(verifier)).status, 401, "authorization code cannot be replayed");
  const call = (route: string, token = grant.token) => dispatchDeviceGateway(new Request(`http://nas.test${DEVICE_PREFIX}${route}`, {
    method: route.endsWith("probe") || route.endsWith("realtime-ticket") ? "POST" : "GET", headers: { Authorization: `Bearer ${token}` },
  }), app);
  assert.equal((await call("/api/sync/v2/probe", "fake")).status, 401);
  const probe = await (await call("/api/sync/v2/probe")).json() as any;
  assert.equal(probe.identity.userId, grant.user.id);
  assert.equal((await call("/api/settings")).status, 404, "device transport cannot expose administration APIs");
  const ticket = await (await call("/realtime-ticket")).json() as any;
  const upgrade: any = { url: `${DEVICE_PREFIX}/ws?ticket=${ticket.ticket}`, headers: { host: "nas.test" } };
  assert.equal(prepareDeviceRealtimeRequest(upgrade), true);
  assert.match(upgrade.url, /^\/ws\?token=/);
  assert.equal(prepareDeviceRealtimeRequest({ url: `${DEVICE_PREFIX}/ws?ticket=${ticket.ticket}`, headers: {} } as any), false);
  const db = getDb();
  const session = db.prepare("SELECT id FROM user_sessions WHERE userId = ?").get(grant.user.id) as any;
  assert.ok(session);
  const stored = db.prepare("SELECT * FROM fnos_device_tokens").all();
  assert.equal(JSON.stringify(stored).includes(grant.token), false, "only a token hash is stored on NAS");
  db.prepare("UPDATE user_sessions SET revokedAt = datetime('now') WHERE id = ?").run(session.id);
  assert.equal((await call("/api/sync/v2/probe")).status, 401, "existing account-security revocation stops synchronization");
  closeDb(); fs.rmSync(dir, { recursive: true, force: true });
});
