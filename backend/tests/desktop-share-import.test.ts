import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Hono } from "hono";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"desktop-share-import-"));
process.env.DB_PATH=path.join(dir,"server.db");delete process.env.ELECTRON_USER_DATA;

test("server explicitly publishes legacy desktop shares without changing link or credentials (DCC-001 DCC-006)",async t=>{
  const {getDb,closeDb}=await import("../src/db/schema");
  const {sharesRouter,sharedRouter}=await import("../src/routes/shares");
  const db=getDb(), app=new Hono();app.route("/api/shares",sharesRouter);app.route("/api/shared",sharedRouter);
  db.prepare("INSERT INTO users(id,username,passwordHash) VALUES('owner','owner','hash'),('other','other','hash')").run();
  db.prepare("INSERT INTO notebooks(id,userId,name) VALUES('book','owner','QA')").run();
  db.prepare("INSERT INTO notes(id,userId,notebookId,title,content,contentFormat) VALUES('note','owner','book','QA','{}','tiptap-json')").run();
  const encrypted=JSON.parse(fs.readFileSync(new URL('../../frontend/src/lib/encryptedNotes/__tests__/fixtures/envelope-v1.json',import.meta.url),'utf8')).envelope;
  db.prepare("INSERT INTO notes(id,userId,notebookId,title,content,contentFormat) VALUES('encrypted','owner','book','Secret',?,'encrypted-note-v1')").run(JSON.stringify(encrypted));
  const value={id:"a0000000-0000-4000-8000-000000000001",noteId:"note",shareToken:"old_public_link_123456789",permission:"view",passwordHash:await bcrypt.hash("test-password",4),expiresAt:null,maxViews:10,isActive:1,expectedNoteVersion:1};
  const publish=(body:any=value,user="owner",mode="jwt")=>app.request("/api/shares/import-desktop",{method:"POST",headers:{"Content-Type":"application/json","X-User-Id":user,"X-Auth-Mode":mode},body:JSON.stringify(body)});
  try {
    await t.test("anonymous, other account, API tokens and malformed credentials cannot publish",async()=>{
      assert.equal((await publish(value,"")).status,403);assert.equal((await publish(value,"other")).status,403);
      assert.equal((await publish(value,"owner","api-token")).status,403);
      assert.equal((await publish({...value,passwordHash:"plaintext"})).status,400);
      assert.equal((await publish({...value,noteId:"encrypted"})).status,400);
      assert.equal((await publish({...value,expectedNoteVersion:2})).status,409);
      assert.equal((db.prepare("SELECT count(*) n FROM shares").get() as any).n,0);
    });
    await t.test("publish and replay preserve URL/password, expose no hash and create only one row",async()=>{
      for(let i=0;i<2;i++) {
        const r=await publish();assert.equal(r.status,200);const data=await r.json();assert.equal(data.shareToken,value.shareToken);assert.equal(data.hasPassword,true);assert.equal(data.password,undefined);assert.equal(data.passwordHash,undefined);
      }
      assert.equal((db.prepare("SELECT count(*) n FROM shares").get() as any).n,1);
      assert.equal((db.prepare("SELECT password FROM shares WHERE id=?").get(value.id) as any).password,value.passwordHash);
      const info=await app.request('/api/shared/'+value.shareToken);assert.equal(info.status,200);
      assert.equal((await app.request('/api/shared/'+value.shareToken+'/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'wrong'})})).status,403);
      assert.equal((await app.request('/api/shared/'+value.shareToken+'/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})})).status,200);
    });
    await t.test("colliding identity cannot overwrite published settings and revocation remains effective",async()=>{
      const r=await publish({...value,id:"b0000000-0000-4000-8000-000000000001"});assert.equal(r.status,409);
      await app.request('/api/shares/'+value.id,{method:'PUT',headers:{'X-User-Id':'owner','Content-Type':'application/json'},body:JSON.stringify({isActive:0})});
      await publish();assert.equal((db.prepare("SELECT isActive FROM shares WHERE id=?").get(value.id) as any).isActive,0,"an idempotent retry must not reactivate a revoked link");
      assert.notEqual((await app.request('/api/shared/'+value.shareToken)).status,200);
      await app.request('/api/shares/'+value.id,{method:'DELETE',headers:{'X-User-Id':'owner'}});
      assert.equal((await publish()).status,409,"a delayed import must not resurrect a deleted share");
      assert.equal((await app.request('/api/shared/'+value.shareToken)).status,404);
    });
  } finally {closeDb();fs.rmSync(dir,{recursive:true,force:true});}
});
