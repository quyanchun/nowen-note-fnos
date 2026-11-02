import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"nowen-web-settings-"));
process.env.DB_PATH=path.join(directory,"test.db");
process.env.JWT_SECRET="web-settings-isolated-secret-long-enough";
process.env.NOWEN_WEB_PUBLIC_URL="http://nas.test:3504/";
process.env.NOWEN_FNOS_PORTAL_URL="http://nas.test/";
test("NAS login entry settings require admin and reject ambiguous destinations (DCC-006)",async t=>{
 const {getDb,closeDb}=await import("../src/db/schema");const {default:router}=await import("../src/routes/fnos-web-settings");const {readFnosWebEntries}=await import("../src/services/fnos-web-config");
 const db=getDb();for(const role of ["admin","user"])db.prepare("INSERT INTO users(id,username,passwordHash,role)VALUES(?,?,?,?)").run(role,role,"unused",role);
 const app=new Hono();app.route("/settings",router);
 const call=(role:string,body?:unknown,headers:Record<string,string>={})=>app.request("/settings",{method:body===undefined?"GET":"PUT",headers:{"X-User-Id":role,"Content-Type":"application/json",...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const entries=[{name:"局域网",webOrigin:"http://nas.test:3504/",portalOrigin:"http://nas.test/"},{name:"公网",webOrigin:"https://note.test/",portalOrigin:"https://nas.test/"}];
 await t.test("non-admin users cannot read or change server authorization pairs",async()=>{for(const role of ["","user"]){assert.equal((await call(role)).status,403);assert.equal((await call(role,{entries})).status,403);}});
 await t.test("admin stores normalized LAN and public pairs and can disable all",async()=>{assert.equal((await call("admin",{entries})).status,200);assert.equal(readFnosWebEntries()[1].webOrigin,"https://note.test");assert.equal((await call("admin",{entries:[]})).status,200);assert.deepEqual(readFnosWebEntries(),[]);await call("admin",{entries});});
 await t.test("invalid entries never partially replace the saved configuration",async()=>{
  const before=readFnosWebEntries();for(const changed of [{...entries[0],webOrigin:"javascript:alert(1)"},{...entries[0],portalOrigin:"https://user:pass@nas.test"},{...entries[0],portalOrigin:"https://nas.test/app/evil"},{...entries[0],webOrigin:entries[0].portalOrigin},{...entries[0],name:""}]){assert.equal((await call("admin",{entries:[changed]})).status,400);assert.deepEqual(readFnosWebEntries(),before);}
  assert.equal((await call("admin",{entries:[entries[0],entries[0]]})).status,400);assert.equal((await call("admin",{entries:Array(9).fill(entries[0])})).status,400);assert.equal((await call("admin",{entries},{"Sec-Fetch-Site":"cross-site"})).status,403);
 });
 closeDb();fs.rmSync(directory,{recursive:true,force:true});
});
