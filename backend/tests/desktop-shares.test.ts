import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { Hono } from "hono";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-shares-"));
process.env.DB_PATH = path.join(dir, "local.db");
process.env.ELECTRON_USER_DATA = dir;
process.env.NOWEN_FNOS_BRIDGE_TOKEN = "test-bridge";

test("desktop public shares publish to the bound server and fail closed (DCC-001 DCC-003 DCC-006 DCC-011)", async t => {
  const { getDb, closeDb } = await import("../src/db/schema");
  const { sharesRouter } = await import("../src/routes/shares");
  const { createProfile, setProfileEnabled } = await import("../src/sync/profile");
  const { saveRemoteCredential, clearRemoteCredential } = await import("../src/sync/credentials");
  const { recordNoteReceipt } = await import("../src/sync/note-receipt");
  const db = getDb();
  db.prepare("INSERT INTO users(id,username,passwordHash) VALUES('local','local','hash'),('other','other','hash')").run();
  db.prepare("INSERT INTO notebooks(id,userId,name) VALUES('book','local','QA')").run();
  const note = { id: "note", title: "QA", content: '{"type":"doc","content":[]}', contentFormat: "tiptap-json", version: 1 };
  db.prepare("INSERT INTO notes(id,userId,notebookId,title,content,contentFormat,version) VALUES('note','local','book',?,?,?,1)").run(note.title, note.content, note.contentFormat);
  const profile = createProfile(db, { name: "NAS", serverUrl: "https://nas.test/app/nowen-note-private", remoteUserId: "remote" });
  setProfileEnabled(db, profile.id, true);
  const credential = { profileId: profile.id, serverUrl: profile.serverUrl, remoteUserId: "remote", localUserId: "local", transport: "fnos-session" as const,
    token: "test." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+3600, userId: "remote" })).toString("base64url") + ".signature" };
  saveRemoteCredential(credential);
  recordNoteReceipt(db, profile.id, "note", note.content, note.contentFormat, 1, "test ACK");
  const app = new Hono(); app.route("/api/shares", sharesRouter);
  const remoteShares = new Map<string, any>(); let offline = false, remoteNote = { ...note }, writes = 0, switchAccount = false;
  let onNoteRead: (()=>void) | null = null;
  const bridge = createServer(async (req, res) => {
    const target = new URL(String(req.headers["x-nowen-target"]));
    assert.equal(target.origin, "https://nas.test"); assert.equal(req.headers.authorization, "Bearer " + credential.token);
    res.setHeader("Content-Type", "application/json"); res.setHeader("Set-Cookie", "private=test");
    if (offline) { res.writeHead(503); res.end('{"error":"offline"}'); return; }
    const chunks=[]; for await(const chunk of req) chunks.push(chunk);
    const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
    const route=target.pathname.slice("/app/nowen-note-private/api".length);
    if(route==="/notes/note") { onNoteRead?.(); res.end(JSON.stringify(remoteNote)); return; }
    if(switchAccount) { setProfileEnabled(db,profile.id,false); }
    if(req.method==="POST") {
      writes++; const value=route.endsWith("import-desktop")?{...body,hasPassword:!!body.passwordHash}:{id:"remote-share",noteId:body.noteId,shareToken:"remote-token",permission:body.permission};
      delete value.passwordHash;remoteShares.set(value.id,value);res.writeHead(201);res.end(JSON.stringify(value));return;
    }
    if(route==="/shares/note/note"||route==="/shares") {res.end(JSON.stringify([...remoteShares.values()]));return;}
    if(route==="/shares/status/batch") {res.end(JSON.stringify(["note"]));return;}
    const id=route.split("/").at(-1)!;
    if(req.method==="PUT") {Object.assign(remoteShares.get(id),body);res.end(JSON.stringify(remoteShares.get(id)));return;}
    if(req.method==="DELETE") {remoteShares.delete(id);res.end('{"success":true}');return;}
    res.end(JSON.stringify(remoteShares.get(id)||{}));
  });
  await new Promise<void>(resolve=>bridge.listen(0,"127.0.0.1",resolve));
  process.env.NOWEN_FNOS_BRIDGE_URL=`http://127.0.0.1:${(bridge.address() as any).port}`;
  const request=(route="",method="GET",body?:any,user="local",mode="jwt")=>app.request("/api/shares"+route,{method,headers:{"X-User-Id":user,"X-Auth-Mode":mode,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try {
    await t.test("creates, lists, updates and revokes on the server without local shadow shares", async()=>{
      const r=await request("","POST",{noteId:"note",permission:"view"});assert.equal(r.status,201);assert.equal(r.headers.get("set-cookie"),null);assert.equal((await r.json()).id,"remote-share");
      assert.equal((db.prepare("SELECT count(*) n FROM shares").get() as any).n,0);
      assert.equal((await (await request("/note/note")).json()).length,1);
      assert.equal((await (await request("/remote-share","PUT",{isActive:0})).json()).isActive,0);
      assert.equal((await request("/remote-share","DELETE")).status,200);assert.equal(remoteShares.size,0);
    });
    await t.test("indexed Markdown metadata matches the server user projection without hiding real edits", async()=>{
      const marker="blk_12345678-1234-1234-1234-123456789abc";
      const indexed="# QA ^"+marker+"\n\n```\ncode ^blk_literal123\n```";
      db.prepare("UPDATE notes SET content=?,contentFormat='markdown' WHERE id='note'").run(indexed);
      db.prepare("INSERT INTO note_blocks_index(blockId,noteId,blockType) VALUES(?,'note','heading')").run(marker);
      recordNoteReceipt(db,profile.id,"note",indexed,"markdown",1,"snapshot");
      remoteNote={...note,contentFormat:"markdown",content:"# QA\n\n```\ncode ^blk_literal123\n```"};
      assert.equal((await request("","POST",{noteId:"note"})).status,201);
      const start=writes;
      remoteNote={...remoteNote,content:"# QA\n\n```\ncode changed\n```"};
      assert.equal((await request("","POST",{noteId:"note"})).status,409);assert.equal(writes,start);
      remoteShares.clear();db.prepare("DELETE FROM note_blocks_index WHERE noteId='note'").run();
      db.prepare("UPDATE notes SET content=?,contentFormat=? WHERE id='note'").run(note.content,note.contentFormat);
      recordNoteReceipt(db,profile.id,"note",note.content,note.contentFormat,1,"test ACK");remoteNote={...note};
    });
    await t.test("missing ACK, stale server content, disabled profile and other identities never publish",async()=>{
      const start=writes;db.prepare("DELETE FROM sync_note_receipts").run();assert.equal((await request("","POST",{noteId:"note"})).status,409);
      recordNoteReceipt(db,profile.id,"note",note.content,note.contentFormat,1,"test ACK");remoteNote={...note,content:"server concurrent edit"};assert.equal((await request("","POST",{noteId:"note"})).status,409);remoteNote={...note};
      assert.equal((await request("","POST",{noteId:"note"},"other")).status,409);
      assert.equal((await request("","POST",{noteId:"note"},"local","api-token")).status,403);
      setProfileEnabled(db,profile.id,false);assert.equal((await request("","POST",{noteId:"note"})).status,409);setProfileEnabled(db,profile.id,true);assert.equal(writes,start);
    });
    await t.test("legacy links are marked unpublished and explicitly retain their original token",async()=>{
      const id="a0000000-0000-4000-8000-000000000001",token="legacy_token_123456789";
      db.prepare("INSERT INTO shares(id,noteId,ownerId,shareToken,shareType,permission) VALUES(?,'note','local',?,'link','view')").run(id,token);
      const list=await (await request("/note/note")).json();assert.equal(list[0].localOnly,true);assert.equal(list[0].password,undefined);
      const r=await request(`/local/${id}/publish`,"POST");assert.equal(r.status,201);assert.equal((await r.json()).shareToken,token);
      const after=await (await request("/note/note")).json();assert.equal(after.length,1);assert.equal(after[0].localOnly,undefined);
      assert.equal((db.prepare("SELECT count(*) n FROM shares").get() as any).n,1,"local recovery record is retained");
      await request(`/${id}`,"DELETE");
      assert.equal((await (await request("/note/note")).json()).length,0,"revoked publications must not reappear as unpublished legacy links");
    });
    await t.test("a profile switch or fresh local edit between verification and publication cannot publish",async()=>{
      const start=writes;
      onNoteRead=()=>setProfileEnabled(db,profile.id,false);
      assert.equal((await request("","POST",{noteId:"note"})).status,409);setProfileEnabled(db,profile.id,true);
      onNoteRead=()=>db.prepare("UPDATE notes SET content='new local draft',version=2 WHERE id='note'").run();
      assert.equal((await request("","POST",{noteId:"note"})).status,409);onNoteRead=null;
      db.prepare("UPDATE notes SET content=?,version=1 WHERE id='note'").run(note.content);
      assert.equal(writes,start);
    });
    await t.test("outages and in-flight account changes cannot report success or fall back to local storage",async()=>{
      const count=(db.prepare("SELECT count(*) n FROM shares").get() as any).n;
      offline=true;assert.equal((await request("","POST",{noteId:"note"})).status,502);offline=false;
      switchAccount=true;assert.equal((await request("/note/note")).status,409);switchAccount=false;setProfileEnabled(db,profile.id,true);
      clearRemoteCredential(profile.id);assert.equal((await request("","POST",{noteId:"note"})).status,409);saveRemoteCredential(credential);
      assert.equal((db.prepare("SELECT count(*) n FROM shares").get() as any).n,count);
    });
  } finally {await new Promise<void>(resolve=>bridge.close(()=>resolve()));closeDb();fs.rmSync(dir,{recursive:true,force:true});}
});
