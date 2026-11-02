import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-clipboard-"));
process.env.DB_PATH = path.join(dir, "test.db");
process.env.ELECTRON_USER_DATA = dir;
process.env.NOWEN_FNOS_BRIDGE_TOKEN = "fixture-private-bridge";
process.env.JWT_SECRET = "desktop-clipboard-test-signing-secret";

test("desktop clipboard settings belong to the signed-in NAS account and never provide a relay (DCC-001 DCC-003 DCC-006)", async t => {
  const { getDb, closeDb } = await import("../src/db/schema.js");
  const { createProfile, setProfileEnabled } = await import("../src/sync/profile.js");
  const { saveRemoteCredential, clearRemoteCredential } = await import("../src/sync/credentials.js");
  const service = await import("../src/services/desktop-clipboard.js");
  const { clipboardSettingsSchema } = await import("../src/services/clipboard-integration.js");
  const db = getDb();
  db.prepare("INSERT INTO users(id,username,passwordHash) VALUES('local-owner','owner','unused'),('local-other','other','unused')").run();
  const serverUrl = "https://nas.test/app/nowen-note-private";
  const profile = createProfile(db, { name: "NAS", serverUrl, remoteUserId: "remote-owner" });
  setProfileEnabled(db, profile.id, true);
  const noteToken = "fixture." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+3600, userId: "remote-owner" })).toString("base64url") + ".signature";
  const credential = { profileId: profile.id, serverUrl, token: noteToken, remoteUserId: "remote-owner", localUserId: "local-owner", transport: "fnos-session" as const, refreshToken: "fixture-refresh" };
  saveRemoteCredential(credential);
  let token = "ncc_" + "A".repeat(43), revoked = false, unavailable = false, missing = false;
  let settings = clipboardSettingsSchema.parse({ enabled: true, excludeKeywords: ["excluded"] });
  const calls: Array<{ target: string; method?: string; authorization?: string; body: any }> = [];
  const bridge = createServer(async (req, res) => {
    assert.equal(req.headers["x-nowen-bridge"], "fixture-private-bridge");
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const target = String(req.headers["x-nowen-target"]);
    calls.push({ target, method: req.method, authorization: req.headers.authorization, body });
    assert(target.startsWith(serverUrl + "/api/"));
    res.setHeader("Content-Type", "application/json"); res.setHeader("Set-Cookie", "must-not-escape=secret");
    if (missing) { res.writeHead(404); res.end('not found'); return; }
    if (unavailable) { res.writeHead(503); res.end(JSON.stringify({ code: "NETWORK_UNAVAILABLE", error: "synthetic offline" })); return; }
    const route = target.slice(serverUrl.length);
    if (route.startsWith("/api/clipboard-settings") || route === "/api/notebooks") {
      assert.equal(req.headers.authorization, "Bearer " + noteToken);
      if (route === "/api/notebooks") res.end(JSON.stringify([{id:"nas-folder",name:"NAS folder"},{id:"team",name:"team",workspaceId:"team"}]));
      else if (route.endsWith("/token/rotate")) { token="ncc_"+"B".repeat(43);revoked=false;res.end(JSON.stringify({token})); }
      else if (route.endsWith("/token") && req.method === "DELETE") {revoked=true;res.end('{"success":true}');}
      else if (route.endsWith("/token")) res.end(JSON.stringify({token}));
      else {if(req.method==="PUT")settings=body;res.end(JSON.stringify({settings,tokenSet:!revoked}));}
    } else {
      if (revoked || req.headers.authorization !== "Bearer " + token) {res.writeHead(401);res.end('{"code":"CLIPBOARD_TOKEN_INVALID"}');return;}
      if (route.endsWith("/policy")) res.end(JSON.stringify({enabled:true}));
      else if (req.method === "POST") {res.writeHead(202);res.end(JSON.stringify({id:"nas-job",requestId:body.requestId,status:"queued",originalContent:body.content}));}
      else res.end(JSON.stringify({id:"nas-job",status:"completed",originalContent:"source",result:{noteId:"nas-note",version:7}}));
    }
  });
  await new Promise<void>(resolve => bridge.listen(0,"127.0.0.1",resolve));
  process.env.NOWEN_FNOS_BRIDGE_URL = `http://127.0.0.1:${(bridge.address() as any).port}`;
  try {
    await t.test("advertises NAS directly and reads only the current account's folders", async()=>{
      const state=await service.desktopClipboardSettings("local-owner");
      assert.equal(state.endpoint,serverUrl+"/api/clipboard/captures");
      assert.equal(state.serverEndpoint,state.endpoint);
      assert.deepEqual(state.folders,[{id:"nas-folder",name:"NAS folder"}]);
      await assert.rejects(service.desktopClipboardSettings("local-other"));
    });
    await t.test("copy and rotation use NAS without creating a local Token binding",async()=>{
      assert.equal((await service.copyDesktopClipboardToken("local-owner")).token,token);
      const old=token;await service.copyDesktopClipboardToken("local-owner",true);assert.notEqual(token,old);
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='desktop_clipboard_bindings'").get(),undefined);
    });
    await t.test("settings changes and revocation apply to NAS, including both modes",async()=>{
      await service.saveDesktopClipboardSettings("local-owner",{...settings,minChars:20,integrationMode:"standalone",standaloneUrl:"https://notes.example"});
      assert.equal(settings.minChars,20);assert.equal(settings.integrationMode,"standalone");
      await service.revokeDesktopClipboardToken("local-owner");assert.equal(revoked,true);
      assert(calls.every(c=>c.target.includes("/api/clipboard-settings")||c.target.endsWith("/api/notebooks")));
      assert.equal((db.prepare("SELECT count(*) n FROM notes").get() as any).n,0);
    });
    await t.test("missing fnOS gateway explains the app entry instead of reporting a disconnected NAS", async()=>{
      missing=true;
      await assert.rejects(service.desktopClipboardLogs("local-owner",0), /HTTP 404.*飞牛应用中心/);
      missing=false;
    });
    await t.test("direct sync manages server clipboard settings and logs without the fnOS bridge",async()=>{
      const original=globalThis.fetch;
      const direct=createProfile(db,{name:"Direct",serverUrl:"https://notes.test",remoteUserId:"remote-owner"});
      setProfileEnabled(db,profile.id,false);setProfileEnabled(db,direct.id,true);
      saveRemoteCredential({...credential,profileId:direct.id,serverUrl:direct.serverUrl,transport:"direct"});
      const count=calls.length;
      globalThis.fetch=(async(url:string,init:RequestInit)=>{
        assert(url.startsWith("https://notes.test/api/"));
        assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer "+noteToken);
        assert.equal(new Headers(init?.headers).has("X-Nowen-Bridge"),false);
        return Response.json(url.endsWith("/notebooks")?[{id:"direct-folder",name:"direct"}]:url.includes("/logs")?{items:[]}:{settings,tokenSet:true});
      }) as typeof fetch;
      try {
        const state=await service.desktopClipboardSettings("local-owner");assert.equal(state.endpoint,"https://notes.test/api/clipboard/captures");
        assert.deepEqual((await service.desktopClipboardLogs("local-owner",0)).items,[]);
        await assert.rejects(service.desktopClipboardSettings("local-other"));assert.equal(calls.length,count);
      }finally {globalThis.fetch=original;setProfileEnabled(db,direct.id,false);setProfileEnabled(db,profile.id,true);}
    });
    await t.test("log mutations use the active NAS account with encoded IDs, never capture relay",async()=>{
      for(const action of ["delete","force","undo"] as const){await service.desktopClipboardLogAction("local-owner","request/id with space",action);const call=calls.at(-1)!;assert.equal(call.target,serverUrl+"/api/clipboard-settings/logs/request%2Fid%20with%20space"+(action==="delete"?"":"/"+action));assert.equal(call.method,action==="delete"?"DELETE":"POST");}
      const count=calls.length;await assert.rejects(service.desktopClipboardLogAction("local-other","anything","force"));assert.equal(calls.length,count);
    });
    await t.test("NAS outage and logout do not fall back to a different account",async()=>{
      unavailable=true;await assert.rejects(service.desktopClipboardSettings("local-owner"));unavailable=false;
      clearRemoteCredential(profile.id);const count=calls.length;
      await assert.rejects(service.copyDesktopClipboardToken("local-owner"));assert.equal(calls.length,count);
    });
  } finally {await new Promise<void>(resolve=>bridge.close(()=>resolve()));closeDb();fs.rmSync(dir,{recursive:true,force:true});}
});
