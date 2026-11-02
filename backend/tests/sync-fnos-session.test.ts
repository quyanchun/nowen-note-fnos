import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-fnos-session-"));
process.env.ELECTRON_USER_DATA = dir;
process.env.NOWEN_FNOS_BRIDGE_URL = "http://127.0.0.1:12345";
process.env.NOWEN_FNOS_BRIDGE_TOKEN = "test-bridge-capability";
const jwt = (id: string, exp: number) => `header.${Buffer.from(JSON.stringify({ userId: id, exp })).toString("base64url")}.test`;
test("NAS session fallback binds owner/state and refuses cancellation (DCC-006)", async () => {
  const auth = await import("../src/sync/browser-auth");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url: string) => {
    if (url.endsWith("/health")) return new Response("not found", { status: 404 });
    return Response.json({ token: "note-token", refreshToken: "note-refresh", user: { id: "nas-user" } });
  }) as typeof fetch;
  try {
    const started = await auth.beginBrowserAuthorization("local", "https://nas.example/", "Mac");
    assert.equal(started.transport, "fnos-session");
    const input = { requestId: started.requestId, state: started.state };
    const activate = () => { calls++; return {}; };
    await assert.rejects(auth.finishNativeAuthorization("other", input, "test-device", activate));
    await assert.rejects(auth.finishNativeAuthorization("local", { ...input, state: "wrong" }, "test-device", activate));
    await auth.finishNativeAuthorization("local", input, "test-device", activate);
    assert.equal(calls, 1);
    await assert.rejects(auth.finishNativeAuthorization("local", input, "test-device", activate));
    const next = await auth.beginBrowserAuthorization("local", "https://nas.example/", "Mac");
    auth.cancelBrowserAuthorization("local", next.requestId);
    await assert.rejects(auth.finishNativeAuthorization("local", { requestId: next.requestId, state: next.state }, "test-device", activate));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
test("NAS refresh remains scoped to the existing remote identity and profile (DCC-006)", async () => {
  const { saveRemoteCredential, freshRemoteCredential, getRemoteCredential, clearRemoteCredential } = await import("../src/sync/credentials");
  const original = globalThis.fetch;
  const initial = { profileId: "profile", serverUrl: "https://nas.example/app/nowen-note-private", token: jwt("nas-user", 1), refreshToken: "refresh", transport: "fnos-session" as const, remoteUserId: "nas-user" };
  saveRemoteCredential(initial);
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    assert.equal(url, process.env.NOWEN_FNOS_BRIDGE_URL);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("X-Nowen-Bridge"), process.env.NOWEN_FNOS_BRIDGE_TOKEN);
    assert.equal(headers.get("X-Nowen-Target"), initial.serverUrl + "/api/auth/refresh");
    return Response.json({ token: jwt("other-user", Date.now() / 1000 + 900) });
  }) as typeof fetch;
  try {
    await assert.rejects(freshRemoteCredential("profile", initial.serverUrl));
    assert.equal(getRemoteCredential("profile")?.token, initial.token);
    globalThis.fetch = (async () => Response.json({ token: jwt("nas-user", Date.now() / 1000 + 900) })) as typeof fetch;
    const refreshed = await freshRemoteCredential("profile", initial.serverUrl);
    assert.equal(refreshed.refreshToken, "refresh", "non-rotating refresh responses preserve the existing refresh token");
    await assert.rejects(freshRemoteCredential("profile", "https://other.example"));
    clearRemoteCredential("profile");
    await assert.rejects(freshRemoteCredential("profile", initial.serverUrl));
  } finally { globalThis.fetch = original;  }
});

test("desktop runtime never selects a historical administrator in a multi-account database (DCC-006)", async () => {
  const { getDb, closeDb } = await import("../src/db/schema");
  const { resolveLocalUserId } = await import("../src/sync/runtime");
  const db = getDb();
  db.prepare("INSERT INTO users (id,username,passwordHash,role,createdAt) VALUES ('old-admin','admin','hash','admin','2020-01-01'),('actual-desktop','desktop','hash','admin','2026-01-01')").run();
  assert.equal(resolveLocalUserId(db), "actual-desktop");
  db.prepare("UPDATE users SET isDisabled=1 WHERE id='actual-desktop'").run();
  assert.equal(resolveLocalUserId(db), null);
  closeDb();
});

test("direct service credentials renew without the NAS bridge and reject foreign identity (DCC-006)", async () => {
  const {saveRemoteCredential,freshRemoteCredential,getRemoteCredential,scopedFetch} = await import("../src/sync/credentials");
  const original=globalThis.fetch;
  const initial={profileId:"direct",serverUrl:"https://notes.example",token:jwt("note-user",1),refreshToken:"direct-refresh",transport:"direct" as const,remoteUserId:"note-user",localUserId:"local"};
  saveRemoteCredential(initial);
  let requests=0;
  globalThis.fetch=(async (url:string,init:RequestInit)=>{
    requests++; assert.equal(url,initial.serverUrl+"/api/auth/refresh");
    assert.equal(new Headers(init.headers).has("X-Nowen-Bridge"),false);
    assert.deepEqual(JSON.parse(String(init.body)),{refreshToken:"direct-refresh"});
    return Response.json({token:jwt("note-user",Date.now()/1000+900),refreshToken:"rotated"});
  }) as typeof fetch;
  try {
    const [a,b]=await Promise.all([freshRemoteCredential("direct",initial.serverUrl),freshRemoteCredential("direct",initial.serverUrl)]);
    assert.equal(requests,1);assert.equal(a.token,b.token);assert.equal(a.refreshToken,"rotated");
    assert.equal(getRemoteCredential("direct")?.transport,"direct");
    await assert.rejects(scopedFetch("direct",initial.serverUrl)("https://other.example/api/notes"));
    saveRemoteCredential(initial);
    globalThis.fetch=(async()=>Response.json({token:jwt("other-user",Date.now()/1000+900)})) as typeof fetch;
    await assert.rejects(freshRemoteCredential("direct",initial.serverUrl));
    assert.equal(getRemoteCredential("direct")?.token,initial.token);
    saveRemoteCredential(initial);
    const renewed=jwt("note-user",Date.now()/1000+900);
    globalThis.fetch=(async()=>Response.json({token:renewed})) as typeof fetch;
    const {SyncRealtimeSubscription}=await import("../src/sync/realtime");
    let connectedUrl="";
    class Socket {readyState=1;constructor(url:string){connectedUrl=url;}close(){this.readyState=3;}}
    const subscription=new SyncRealtimeSubscription({serverUrl:initial.serverUrl,token:initial.token,credentialProfileId:"direct",
      onNotice:()=>{},webSocketImpl:Socket as unknown as typeof WebSocket,scheduler:{setTimeout:()=>0,clearTimeout:()=>{}}});
    subscription.start();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(new URL(connectedUrl).searchParams.get("token"),renewed,"realtime reconnect must use the refreshed direct-service credential");
    subscription.stop();
  } finally {globalThis.fetch=original;}
});

test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
