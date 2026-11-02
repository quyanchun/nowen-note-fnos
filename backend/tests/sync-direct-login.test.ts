import "./setup-db-isolation.js";
import assert from "node:assert/strict";
import test from "node:test";
import {Hono} from "hono";
process.env.NOWEN_LOCAL_FIRST_SYNC_V2="1";
test("direct login creates its own profile, keeps NAS cursor/queue and persists refresh (DCC-006)",async()=>{
  const {getDb,closeDb}=await import("../src/db/schema");
  const {createProfile,switchActiveProfile,getSyncState,advanceSyncState}=await import("../src/sync/profile");
  const {saveRemoteCredential,getRemoteCredential}=await import("../src/sync/credentials");
  const {enqueueMutation}=await import("../src/sync/outbox");
  const {default:routes}=await import("../src/routes/sync-local");
  const db=getDb();db.prepare("INSERT INTO users(id,username,passwordHash) VALUES('local','local','hash')").run();
  const nas=createProfile(db,{name:"NAS",serverUrl:"https://nas.example/app/nowen-note-private",remoteUserId:"remote"});switchActiveProfile(db,nas.id);
  saveRemoteCredential({profileId:nas.id,serverUrl:nas.serverUrl,remoteUserId:"remote",localUserId:"local",token:"old",transport:"fnos-session"});
  advanceSyncState(db,nas.id,1546,"personal");enqueueMutation(db,{profileId:nas.id,entityType:"note",entityId:"unsent",operation:"upsert",deviceId:"device",payload:{content:"unsent fixture"}});
  const oldQueue=db.prepare("SELECT * FROM sync_outbox").all();
  const app=new Hono();app.route('/sync',routes);const original=globalThis.fetch;
  let requests=0;
  globalThis.fetch=(async(url:string,init:RequestInit)=>{
    requests++;assert.equal(url,"https://notes.example/api/auth/login");assert.equal(new Headers(init.headers).has("X-Nowen-Bridge"),false);
    return Response.json({token:"direct-token",refreshToken:"direct-refresh",user:{id:"remote"}});
  }) as typeof fetch;
  const request=(body:any)=>app.request('/sync/settings/server/login',{method:"POST",headers:{"X-User-Id":"local","Content-Type":"application/json"},body:JSON.stringify(body)});
  try {
    const bad=await request({serverUrl:nas.serverUrl,connectionMode:"service",username:"user",password:"test"});assert.equal(bad.status,400);assert.equal(requests,0);
    const ok=await request({serverUrl:"https://notes.example",connectionMode:"service",username:"user",password:"test"});assert.equal(ok.status,200);
    const result=await ok.json() as any;assert.notEqual(result.profile.id,nas.id);
    assert.equal(getRemoteCredential(result.profile.id)?.refreshToken,"direct-refresh");assert.equal(getRemoteCredential(result.profile.id)?.transport,"direct");
    assert.equal(getSyncState(db,nas.id)?.lastSequence,1546);assert.equal(getSyncState(db,result.profile.id)?.lastSequence||0,0);
    assert.deepEqual(db.prepare("SELECT * FROM sync_outbox").all(),oldQueue);assert.equal(getRemoteCredential(nas.id)?.token,"old");
  }finally {globalThis.fetch=original;closeDb();}
});
