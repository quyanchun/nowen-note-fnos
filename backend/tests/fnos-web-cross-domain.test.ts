import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-cross-web-"));
process.env.DB_PATH = path.join(directory, "test.db");
process.env.JWT_SECRET = "cross-domain-isolated-test-secret-long-enough";
process.env.NOWEN_WEB_PUBLIC_URL = "http://nas.test:3504/";
process.env.NOWEN_FNOS_PORTAL_URL = "http://nas.test/";
process.env.NOWEN_WEB_LOGIN_ENTRIES = JSON.stringify([{name:"公网",webOrigin:"https://note.test",portalOrigin:"https://nas.test"}]);

test("configured cross-domain NAS authorization binds callback to initiating browser and origin (DCC-006)", async t => {
  const { getDb, closeDb } = await import("../src/db/schema");
  const { default: auth } = await import("../src/routes/auth");
  const { dispatchFnosGateway } = await import("../src/services/fnos-gateway");
  const { verifyLoginToken, bumpTokenVersion } = await import("../src/lib/auth-security");
  const app = new Hono(); app.route("/api/auth", auth); const db=getDb();
  const web="https://note.test", portal="https://nas.test";
  let sequence=0;
  const post=(endpoint:string, body:any, cookie="", origin=web)=>app.request(web+"/api/auth/web/"+endpoint,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json",Cookie:cookie,"X-Real-IP":`cross-${++sequence}`},body:JSON.stringify(body)});
  const start=async()=>{const response=await post("start",{flow:"callback"});assert.equal(response.status,200); const data=await response.json() as any;assert.match(response.headers.get("set-cookie")!,/Secure/);return {...data,cookie:response.headers.get("set-cookie")!.split(";")[0]};};
  const authorize=(a:any,uid="2000")=>dispatchFnosGateway(new Request(a.authorizeUrl,{headers:{"X-Trim-Userid":uid,"X-Trim-Username":"nas_"+uid,"X-Trim-Isadmin":"false","Sec-Fetch-Site":"same-site"}}),app);
  const complete=(url:string,cookie:string)=>app.request(url,{headers:{Cookie:cookie}});
  let account="";
  await t.test("options select an explicitly configured origin while preserving LAN",async()=>{
    assert.deepEqual(await (await app.request("/api/auth/web/options?origin="+encodeURIComponent(web))).json(),{enabled:true,webOrigin:web,portalOrigin:portal});
    assert.equal((await (await app.request("/api/auth/web/options?origin=https://evil.test")).json() as any).enabled,false);
    assert.equal((await (await app.request("/api/auth/web/options")).json() as any).webOrigin,"http://nas.test:3504");
  });
  await t.test("fresh HTTPS browser binding cannot be fixed by a supplied cookie",async()=>{
    const chosen="f".repeat(43);const response=await post("start",{flow:"callback"},"nowen_web_login="+chosen+"; __Host-nowen_web_login="+chosen);
    assert.equal(response.status,200);const cookie=response.headers.get("set-cookie")!;
    assert.ok(cookie.startsWith("__Host-nowen_web_login="));assert.ok(!cookie.includes(chosen));assert.match(cookie,/Secure/);assert.ok(!/Domain=/i.test(cookie));
  });
  await t.test("NAS identity alone cannot approve or disclose a session before the bound callback",async()=>{
    const a=await start();assert.equal(a.portalUrl,portal+"/");assert.equal(new URL(a.authorizeUrl).origin,portal);assert.ok(!a.authorizeUrl.includes(a.proof));
    const redirect=await authorize(a);assert.equal(redirect.status,302);const callback=redirect.headers.get("location")!;assert.equal(new URL(callback).origin,web);assert.ok(!callback.includes(a.proof));
    assert.equal((await (await post("poll",a,a.cookie)).json() as any).status,"waiting");
    const b=await start();assert.equal((await complete(callback,b.cookie)).status,410);assert.equal((await complete(callback,"")).status,410);
    assert.equal((await post("poll",a,a.cookie,"http://nas.test:3504")).status,403);
    assert.equal((await complete(callback,a.cookie)).status,200);
    const result=await (await post("poll",a,a.cookie)).json() as any;assert.equal(result.status,"connected");account=result.login.user.id;assert.equal(verifyLoginToken(result.login.token)?.userId,account);
    assert.equal((await post("poll",a,a.cookie)).status,410);assert.equal((await complete(callback,a.cookie)).status,410);
  });
  await t.test("forged HTTP identity and callback code cannot authorize",async()=>{
    const a=await start(); const url=new URL(a.authorizeUrl);url.pathname="/api/auth/web/authorize";
    assert.equal((await app.request(url.href,{headers:{"X-Trim-Userid":"2000","X-Trim-Username":"forged","X-Trim-Isadmin":"true"}})).status,401);
    assert.equal((await complete(web+"/api/auth/web/complete?requestId="+a.id+"&code="+"x".repeat(43),a.cookie)).status,410);
  });
  await t.test("cancel, expiry, configuration removal and account revocation fail closed",async()=>{
    const a=await start();const r=await authorize(a);await post("cancel",a,a.cookie);assert.equal((await complete(r.headers.get("location")!,a.cookie)).status,410);
    const b=await start();const rb=await authorize(b);const now=Date.now;try{Date.now=()=>now()+61000;assert.equal((await complete(rb.headers.get("location")!,b.cookie)).status,410);}finally{Date.now=now;}
    const c=await start();const rc=await authorize(c);process.env.NOWEN_WEB_LOGIN_ENTRIES="[]";assert.equal((await complete(rc.headers.get("location")!,c.cookie)).status,410);process.env.NOWEN_WEB_LOGIN_ENTRIES=JSON.stringify([{name:"公网",webOrigin:web,portalOrigin:portal}]);
    const d=await start();const rd=await authorize(d);await complete(rd.headers.get("location")!,d.cookie);bumpTokenVersion(db,account);assert.equal((await post("poll",d,d.cookie)).status,403);
  });
  await t.test("concurrent callbacks and polls create only one session",async()=>{
    const a=await start();const redirect=await authorize(a);const callback=redirect.headers.get("location")!;
    const completed=await Promise.all([complete(callback,a.cookie),complete(callback,a.cookie)]);assert.deepEqual(completed.map(row=>row.status).sort(),[200,410]);
    const before=(db.prepare("SELECT count(*) n FROM user_sessions").get() as any).n;
    const polled=await Promise.all([post("poll",a,a.cookie),post("poll",a,a.cookie)]);assert.deepEqual(polled.map(row=>row.status).sort(),[200,410]);assert.equal((db.prepare("SELECT count(*) n FROM user_sessions").get() as any).n,before+1);
  });
  await t.test("completion is private and callback destinations cannot be supplied by the browser",async()=>{
    const a=await start();const r=await authorize(a);const target=r.headers.get("location")!;const result=await complete(target,a.cookie);assert.equal(result.headers.get("cache-control"),"no-store");assert.equal(result.headers.get("referrer-policy"),"no-referrer");assert.ok(!result.headers.get("set-cookie"));assert.ok(!(await result.text()).includes("token"));
  });
  closeDb();fs.rmSync(directory,{recursive:true,force:true});
});
