import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Sqlite from "better-sqlite3";
import { Hono } from "hono";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nowen-account-settings-"));
process.env.DB_PATH=path.join(dir,"server.db");process.env.ELECTRON_USER_DATA=dir;process.env.NOWEN_LOCAL_FIRST_SYNC_V2="1";
let db:Sqlite.Database,local:Sqlite.Database,app:Hono;
let config:typeof import("../src/sync/account-settings");
test.before(async()=>{
 const schema=await import("../src/db/schema");db=schema.getDb();config=await import("../src/sync/account-settings");
 for(const id of ["remote","other","local"])db.prepare("INSERT INTO users(id,username,passwordHash) VALUES(?,?, 'x')").run(id,id);
 await db.backup(path.join(dir,"local.db"));local=new Sqlite(path.join(dir,"local.db"));
 app=new Hono();app.use("*",async(c,next)=>{c.req.raw.headers.set("X-User-Id",c.req.header("Authorization")==="Bearer other"?"other":"remote");await next();});
 app.route("/api/sync/v2",(await import("../src/routes/sync-v2")).default);
});
test.after(async()=>{local.close();(await import("../src/db/schema")).closeDb();fs.rmSync(dir,{recursive:true,force:true});});
const request:typeof fetch=async(input,init)=>app.request(String(input),init);

test("same-account AI settings survive two-database pull and push without crossing owners (DCC-006)",async()=>{
 const original={ai_profiles_v1:JSON.stringify([{id:"channel",apiKey:"test-key",customHeaders:{zhixing:"test-header"}}]),ai_active_profile_id:"channel",ai_embedding_profile_id:"channel",ai_embedding_model:"bge-m3",speech_source:"profile",speech_profile_id:"channel",speech_model:"q8",ai_multimodal_profile_id:"channel",ai_multimodal_model:"vision-model"};
 config.writeAccountSettings(db,"remote",original);config.writeAccountSettings(db,"other",{ai_api_key:"other-private"});
 await config.syncAccountSettings(local,"profile","local","http://sync.test",request);
 assert.deepEqual(config.readAccountSettings(local,"local"),config.validateAccountSettings(original));
 config.writeAccountSettings(local,"local",{...original,ai_model:"new-model"});
 await config.syncAccountSettings(local,"profile","local","http://sync.test",request);
 assert.equal(config.readAccountSettings(db,"remote").ai_model,"new-model");
 assert.deepEqual(config.readAccountSettings(db,"other"),{ai_api_key:"other-private"});
 const response=await app.request("http://sync.test/api/sync/v2/account-settings?userId=remote",{headers:{Authorization:"Bearer other"}});
 assert.equal(response.headers.get("cache-control"),"no-store");assert.deepEqual((await response.json() as any).settings,{ai_api_key:"other-private"});
});

test("concurrent AI edits, 5xx and missing ACK retain configuration and its receipt (DCC-003)",async()=>{
 const base=config.readAccountSettings(local,"local"),remoteBase=config.readAccountSettings(db,"remote");
 config.writeAccountSettings(local,"local",{...base,ai_model:"offline-edit"});
 const before=local.prepare("SELECT baseHash FROM sync_account_settings_state WHERE profileId='profile'").get();
 await assert.rejects(config.syncAccountSettings(local,"profile","local","http://sync.test",async()=>new Response(null,{status:503})));
 await assert.rejects(config.syncAccountSettings(local,"profile","local","http://sync.test",async(input,init)=>init?.method==="PUT"?Response.json({ok:true}):request(input,init)));
 assert.deepEqual(local.prepare("SELECT baseHash FROM sync_account_settings_state WHERE profileId='profile'").get(),before);
 config.writeAccountSettings(db,"remote",{...remoteBase,ai_model:"other-device-edit"});
 await assert.rejects(config.syncAccountSettings(local,"profile","local","http://sync.test",request),/两端 AI 配置同时修改/);
 assert.equal(config.readAccountSettings(local,"local").ai_model,"offline-edit");assert.equal(config.readAccountSettings(db,"remote").ai_model,"other-device-edit");
 const denied=await app.request("http://sync.test/api/sync/v2/account-settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({baseHash:"stale",settings:{ai_model:"overwrite"}})});assert.equal(denied.status,409);
});

test("AI configuration transfer rejects unrelated keys and invalid values atomically",async()=>{
 const before=config.readAccountSettings(db,"remote");
 for(const settings of [{auth_allow_registration:"1"},{ai_model:{value:"bad"}}]){
  const response=await app.request("http://sync.test/api/sync/v2/account-settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({baseHash:config.settingsHash(before),settings})});
  assert.equal(response.status,400);assert.deepEqual(config.readAccountSettings(db,"remote"),before);
 }
});

test("desktop account bindings retain the old owner and isolate another NAS account (DCC-006)",async()=>{
 const {createProfile}=await import("../src/sync/profile");const {saveRemoteCredential}=await import("../src/sync/credentials");const {bindDesktopAccount}=await import("../src/sync/desktop-account");
 const profile=createProfile(db,{name:"NAS",serverUrl:"https://nas.test",remoteUserId:"nas-a"});
 saveRemoteCredential({profileId:profile.id,serverUrl:profile.serverUrl,token:"test",remoteUserId:"nas-a",localUserId:"local"});
 assert.equal(bindDesktopAccount(db,profile.serverUrl,{id:"nas-a",username:"Alice"}),"local");
 assert.equal(bindDesktopAccount(db,profile.serverUrl,{id:"nas-a",username:"Alice"}),"local");
 const other=bindDesktopAccount(db,profile.serverUrl,{id:"nas-b",username:"Bob"});assert.notEqual(other,"local");
 assert.notEqual(bindDesktopAccount(db,"https://different.test",{id:"nas-a",username:"Alice"}),"local");
 db.prepare("UPDATE users SET isDisabled=1 WHERE id=?").run(other);assert.throws(()=>bindDesktopAccount(db,profile.serverUrl,{id:"nas-b"}),/禁用/);
});

test("password login binds the remote identity and automatically prepares sync and AI configuration",async()=>{
 const {bindDesktopAccount}=await import("../src/sync/desktop-account");
 const {stopSyncEngine}=await import("../src/sync/runtime");
 const {getActiveProfile}=await import("../src/sync/profile");
 const {getRemoteCredential}=await import("../src/sync/credentials");
 const original=globalThis.fetch;
 const localApp=new Hono();localApp.use("*",async(c,next)=>{c.req.raw.headers.set("X-User-Id","local");await next();});localApp.route("/sync",(await import("../src/routes/sync-local")).default);
 globalThis.fetch=(async(input,init)=>{
  const url=String(input);
  if(url.endsWith('/api/auth/login'))return Response.json({token:"synthetic-remote-token",user:{id:"remote",username:"Remote account"}});
  return app.request(url,init);
 }) as typeof fetch;
 try{
  const response=await localApp.request('http://local/sync/settings/server/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({serverUrl:'http://sync.test',username:'remote',password:'test-only',desktopLogin:true})});
  const result=await response.json() as any;assert.equal(response.status,200,JSON.stringify(result));
  assert.equal(result.bootstrapRequired,false);assert.equal(result.engineRunning,true);assert.ok(result.login.token);assert.equal(result.login.user.username,'Remote account');
  const active=getActiveProfile(db)!;const credential=getRemoteCredential(active.id)!;assert.equal(credential.localUserId,result.login.user.id);assert.equal(credential.remoteUserId,'remote');
  assert.notEqual(result.login.user.id,'local');assert.deepEqual(config.readAccountSettings(db,result.login.user.id),config.readAccountSettings(db,'remote'));
  const before=db.prepare('SELECT COUNT(*) AS count FROM notes').get();
  const paused=await localApp.request('http://local/sync/settings/pause',{method:'POST'});assert.equal(paused.status,403,'another local user cannot pause this identity');
  const owner=new Hono();owner.use('*',async(c,next)=>{c.req.raw.headers.set('X-User-Id',result.login.user.id);await next();});owner.route('/sync',(await import('../src/routes/sync-local')).default);
  assert.equal((await owner.request('http://local/sync/settings/pause',{method:'POST'})).status,200);
  assert.equal(getActiveProfile(db),null);assert.deepEqual(db.prepare('SELECT COUNT(*) AS count FROM notes').get(),before);assert.ok(getRemoteCredential(active.id),'logout retains the binding for re-login');
  assert.equal(bindDesktopAccount(db,'http://sync.test',{id:'remote'}),result.login.user.id);
 }finally{stopSyncEngine();globalThis.fetch=original;}
});

test("account switching leaves other users and Profiles out of attachment upload and download queues (DCC-006)",async()=>{
 const {listPendingUploads,listPendingDownloads,registerRemoteAttachment,promoteLocalAttachments}=await import('../src/sync/attachments');
 const {runWithOutboxSuppressed}=await import('../src/sync/context');
 for(const [suffix,userId,profileId] of [['own','local','a'],['foreign-user','remote','a'],['foreign-profile','local','b']]){
  const noteId='queue-note-'+suffix,attachmentId='queue-file-'+suffix;
  runWithOutboxSuppressed(()=>{
   db.prepare("INSERT INTO notebooks(id,userId,name) VALUES(?,?,?)").run('queue-book-'+suffix,userId,suffix);
   db.prepare("INSERT INTO notes(id,userId,notebookId,title,content) VALUES(?,?,?,?,'{}')").run(noteId,userId,'queue-book-'+suffix,suffix);
   db.prepare("INSERT INTO attachments(id,noteId,userId,filename,mimeType,size,path) VALUES(?,?,?,'test.bin','application/octet-stream',1,?)").run(attachmentId,noteId,userId,'pending-sync:'+attachmentId);
  });
  db.prepare("DELETE FROM attachment_sync_state WHERE attachmentId=?").run(attachmentId);
  registerRemoteAttachment(db,attachmentId,profileId);
 }
 const identity={userId:'local',profileId:'a'};
 assert.deepEqual(listPendingDownloads(db,20,null,identity).map(row=>row.attachmentId),['queue-file-own']);
 db.prepare("UPDATE attachment_sync_state SET remoteOnly=0,status='local' WHERE attachmentId LIKE 'queue-file-%'").run();
 promoteLocalAttachments(db,'a','local');
 assert.equal((db.prepare("SELECT profileId FROM attachment_sync_state WHERE attachmentId='queue-file-foreign-profile'").get() as any).profileId,'b');
 assert.deepEqual(listPendingUploads(db,20,null,identity).map(row=>row.attachmentId),['queue-file-own']);
 assert.equal((db.prepare("SELECT status FROM attachment_sync_state WHERE attachmentId='queue-file-foreign-user'").get() as any).status,'local');
});

test("legacy Mac config sync preserves NAS-only multimodal settings (DCC-003 DCC-006)", async () => {
 const original = { ai_model: "legacy-chat", ai_multimodal_profile_id: "nas-channel", ai_multimodal_model: "vision-kept" };
 config.writeAccountSettings(db, "remote", original);
 const response = await app.request("http://sync.test/api/sync/v2/account-settings");
 const legacy = await response.json() as { settings: Record<string,string>; hash: string };
 assert.deepEqual(legacy.settings, { ai_model: "legacy-chat" });
 assert.equal(legacy.hash, config.settingsHash(legacy.settings));
 const updated = { ai_model: "legacy-edit" };
 const saved = await app.request("http://sync.test/api/sync/v2/account-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseHash: legacy.hash, settings: updated }) });
 assert.equal(saved.status, 200);
 assert.equal((await saved.json() as any).hash, config.settingsHash(updated));
 assert.deepEqual(config.readAccountSettings(db, "remote"), { ...original, ...updated });
 const modern = await app.request("http://sync.test/api/sync/v2/account-settings?modelSettings=2");
 assert.deepEqual((await modern.json() as any).settings, config.readAccountSettings(db, "remote"));
});
