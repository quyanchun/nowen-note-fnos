import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { Hono } from "hono";
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"nowen-clipboard-tests-"));
process.env.DB_PATH=path.join(directory,"test.db");process.env.NODE_ENV="test";process.env.JWT_SECRET="clipboard-integration-isolated-signing-secret";
test("single-token clipboard settings, filtering and capture isolation (DCC-001 DCC-002 DCC-003 DCC-006)",async t=>{
 const {getDb,closeDb}=await import("../src/db/schema.js");
 const {getFnosAccount}=await import("../src/lib/fnos-identity.js");
 const {clipboardPublicRouter,clipboardSettingsRouter}=await import("../src/routes/clipboard.js");
 const {clipboardSettingsSchema,getClipboardSettings,saveClipboardSettings,copyClipboardToken,authenticateClipboard,revokeClipboardToken}=await import("../src/services/clipboard-integration.js");
 const {drainCaptures}=await import("../src/services/captures.js");
 const {setUserAISettings}=await import("../src/services/user-ai-settings.js");
 const {createKnowledgeChild}=await import("../src/services/knowledgeTree.js");
 const {resolveApiToken}=await import("../src/lib/api-tokens.js");
 const db=getDb();const owner=getFnosAccount({uid:"2101",username:"clipboard-test",isAdmin:false}).id;const other=getFnosAccount({uid:"2102",username:"clipboard-other",isAdmin:false}).id;
 let nextPlan:any;let calls=0;let messages:any[]=[];let filterReply:any={collect:true};let filterCalls=0;let duringFilter:(()=>void)|null=null;let transientFilterFailures=0;
 const model=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);messages=JSON.parse(Buffer.concat(chunks).toString()).messages;calls++;const filtering=messages[0]?.content?.includes("你是剪贴板内容过滤器");if(filtering){filterCalls++;duringFilter?.();duringFilter=null;}const reply=filtering?filterReply:nextPlan;if(reply==="provider-error"||(filtering&&transientFilterFailures-- > 0)){res.writeHead(503);res.end("synthetic unavailable");return;}res.setHeader("Content-Type","application/json");res.end(JSON.stringify({choices:[{message:{content:typeof reply==="string"?reply:JSON.stringify(reply)}}]}));});
 await new Promise<void>(resolve=>model.listen(0,"127.0.0.1",resolve));
 setUserAISettings(owner,[{key:"ai_api_url",value:`http://127.0.0.1:${(model.address() as any).port}/v1`},{key:"ai_api_key",value:"synthetic"},{key:"ai_model",value:"fixture"}]);
 const app=new Hono();app.route("/api/clipboard",clipboardPublicRouter);
 app.use("/api/clipboard-settings/*",async(c,next)=>{if(c.req.header("Authorization")!=="Bearer fixture-login")return c.json({},401);c.req.raw.headers.set("X-User-Id",owner);await next();});app.route("/api/clipboard-settings",clipboardSettingsRouter);
 let raw="";let first:any;let root:any;
 const call=(route:string,method="GET",body?:any,token=raw,extra:Record<string,string>={})=>app.request(`/api/clipboard${route}`,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const original="  PostgreSQL 查询850ms，索引后120ms\r\n  ";
 const submit=(requestId:string,extra:any={})=>call("/captures","POST",{requestId,content:original,...extra});
 const plan=(notebookId:string|null,folderPath:string[]=[],title="索引调优")=>({action:"create",notebookId,noteId:null,folderPath,title,content:"# 索引调优\n\n查询850ms → 120ms"});
 const completed=async(id:string)=>{await drainCaptures();return await(await call(`/captures/${id}`)).json() as any;};
 try{
  await t.test("two connection modes persist without rotating tokens",async()=>{
   const before=getClipboardSettings(owner);const originalToken=copyClipboardToken(owner).token;
   const standalone=clipboardSettingsSchema.parse({...before.settings,integrationMode:"standalone",standaloneUrl:"https://notes.example.test/prefix"});
   assert.equal(saveClipboardSettings(owner,standalone).settings.standaloneUrl,"https://notes.example.test/prefix");assert.equal(copyClipboardToken(owner).token,originalToken);
   assert.equal(saveClipboardSettings(owner,{...standalone,integrationMode:"nas"}).settings.integrationMode,"nas");assert.equal(copyClipboardToken(owner).token,originalToken);
   assert.equal(clipboardSettingsSchema.parse({}).integrationMode,"nas");
   for(const standaloneUrl of ["javascript:alert(1)","https://user:secret@notes.example.test","https://notes.example.test?token=secret"])assert.equal(clipboardSettingsSchema.safeParse({standaloneUrl}).success,false);
   saveClipboardSettings(owner,before.settings);
  });
  await t.test("disabled by default; repeat copy; token not stored in plaintext or accepted as normal PAT",()=>{assert.equal(getClipboardSettings(owner).settings.enabled,false);raw=copyClipboardToken(owner).token;assert.match(raw,/^ncc_[\w-]{43}$/);assert.equal(copyClipboardToken(owner).token,raw);assert.equal(resolveApiToken(db,raw),null);assert.throws(()=>authenticateClipboard(raw),/未启用/);assert.ok(!JSON.stringify(db.prepare("SELECT * FROM clipboard_integrations").all()).includes(raw));assert.ok(!JSON.stringify(getClipboardSettings(owner)).includes(raw));});
  await t.test("management requires login and rejects API-token authentication",async()=>{
   assert.equal((await app.request("/api/clipboard-settings",{headers:{Authorization:`Bearer ${raw}`,"X-User-Id":owner}})).status,401);
   assert.equal((await app.request("/api/clipboard-settings",{headers:{Authorization:"Bearer fixture-login","X-Auth-Mode":"api-token"}})).status,403);
   const response=await app.request("/api/clipboard-settings",{method:"PUT",headers:{Authorization:"Bearer fixture-login","Content-Type":"application/json"},body:JSON.stringify(clipboardSettingsSchema.parse({enabled:true,systemPrompt:"请使用简洁中文标题",instruction:"保留单位和数字"}))});assert.equal(response.status,200,await response.text());
  });
  await t.test("single Bearer creates folders/note without Cookie and ignores forged account headers",async()=>{
   nextPlan=plan(null,["剪贴板验收","数据库"]);const response=await call("/captures","POST",{requestId:"create",content:original},raw,{"X-User-Id":other,"X-Trim-Userid":"2102"});assert.equal(response.status,202,await response.clone().text());first=await completed((await response.json() as any).id);assert.equal(first.status,"completed",JSON.stringify(first));assert.equal(first.originalContent,original);assert.match(first.result.path,/剪贴板验收 \/ 数据库 \/ 索引调优/);assert.equal((db.prepare("SELECT userId FROM notes WHERE id=?").get(first.result.noteId) as any).userId,owner);assert.ok(messages.some(m=>m.role==="system"&&m.content==="请使用简洁中文标题"));root=db.prepare("SELECT * FROM notebooks WHERE name='剪贴板验收' AND userId=?").get(owner);
  });
  await t.test("automatic append preserves prior content",async()=>{const before=db.prepare("SELECT * FROM notes WHERE id=?").get(first.result.noteId) as any;nextPlan={...plan(before.notebookId),action:"append",noteId:before.id,content:"新增EXPLAIN ANALYZE说明"};const done=await completed((await(await submit("append")).json() as any).id);assert.equal(done.status,"completed",JSON.stringify(done));assert.equal(done.result.action,"append");const after=db.prepare("SELECT * FROM notes WHERE id=?").get(before.id) as any;assert.ok(after.content.startsWith(before.content));assert.match(after.content,/EXPLAIN ANALYZE/);});
  await t.test("request remains idempotent after settings change",async()=>{saveClipboardSettings(owner,clipboardSettingsSchema.parse({enabled:true,minChars:32000,instruction:"新规则"}));const before=calls;const response=await submit("create");assert.equal(response.status,200);assert.equal((await response.json() as any).id,first.id);await drainCaptures();assert.equal(calls,before);assert.equal((await submit("create",{content:"不同内容"})).status,409);});
  for(const [name,settings,input,reason] of [
   ["minimum length",{minChars:20},{content:"短文本"},"TEXT_TOO_SHORT"],
   ["include keywords",{includeKeywords:["技术"]},{content:"购物清单"},"KEYWORD_NOT_INCLUDED"],
   ["exclude keywords",{excludeKeywords:["password"]},{content:"PASSWORD secret"},"KEYWORD_EXCLUDED"],
   ["source application",{excludeApps:["Secrets"]},{sourceApp:"secrets"},"APP_EXCLUDED"],
   ["extension",{excludeExtensions:[".ZIP"]},{fileName:"archive.zip"},"EXTENSION_EXCLUDED"],
   ["file sources",{},{kind:"file"},"FILE_FILTERED"],["image sources",{},{kind:"image"},"IMAGE_FILTERED"],
  ] as const)await t.test(`filters ${name} before AI; repeats without changing result`,async()=>{saveClipboardSettings(owner,clipboardSettingsSchema.parse({enabled:true,...settings}));const before=calls;const response=await submit(`filter-${name}`,input);assert.equal(response.status,200);const result=await response.json() as any;assert.equal(result.status,"filtered");assert.equal(result.reasonCode,reason);assert.equal((await(await submit(`filter-${name}`,input)).json() as any).duplicate,true);await drainCaptures();assert.equal(calls,before);});
  await t.test("folder scope allows subfolder/note creation and denies sibling",async()=>{
   saveClipboardSettings(owner,clipboardSettingsSchema.parse({enabled:true,notebookId:root.id}));const sibling=createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:null,nodeType:"folder",title:"未授权目录"});assert.equal((await submit("forbidden",{notebookId:sibling.resourceId})).status,403);
   nextPlan=plan(root.id,["运维"],"备份计划");const done=await completed((await(await submit("child")).json() as any).id);assert.equal(done.status,"completed",JSON.stringify(done));assert.match(done.result.path,/剪贴板验收 \/ 运维 \/ 备份计划/);
   nextPlan=plan(root.id,[],"Redis缓存");const second=await completed((await(await submit("existing")).json() as any).id);assert.equal(second.status,"completed");assert.equal(second.result.notebookId,root.id);
  });
  await t.test("explicit note append with organize=false preserves exact added text",async()=>{const content="  原样追加\r\n  数值 123.45 ";nextPlan={...plan(first.result.notebookId),action:"append",noteId:first.result.noteId,content:"模型试图改写"};const done=await completed((await(await submit("raw",{content,organize:false,noteId:first.result.noteId})).json() as any).id);assert.equal(done.status,"completed",JSON.stringify(done));assert.equal(done.result.content,content);assert.equal(done.originalContent,content);});
  await t.test("policy hides prompts and malformed/oversized/spoofed fields are rejected",async()=>{const policy=await(await call("/policy")).json() as any;assert.equal(policy.supportedContent,"text");assert.equal(policy.systemPrompt,undefined);assert.equal(policy.aiFilterPrompt,undefined);assert.equal((await submit("invalid",{content:""})).status,400);assert.equal((await submit("unknown",{userId:other})).status,400);assert.equal((await submit("large",{content:"a".repeat(200000)})).status,413);assert.equal((await call("/policy","GET",undefined,"wrong")).status,401);assert.equal((await call("/policy","GET",undefined,"")).status,401);});
  await t.test("cross-account raw text access and folder grants are denied",async()=>{saveClipboardSettings(other,clipboardSettingsSchema.parse({enabled:true}));const otherRaw=copyClipboardToken(other).token;assert.equal((await call(`/captures/${first.id}`,"GET",undefined,otherRaw)).status,404);assert.throws(()=>saveClipboardSettings(other,clipboardSettingsSchema.parse({enabled:true,notebookId:root.id})),/个人空间/);});
  await t.test("failed plan preserves original and can retry; completed retry is rejected",async()=>{nextPlan={bad:"plan"};const queued=await(await submit("retry")).json() as any;let done=await completed(queued.id);assert.equal(done.status,"failed");assert.equal(done.errorCode,"CAPTURE_INVALID_PLAN");assert.equal(done.originalContent,original);nextPlan=plan(root.id,[],"重试笔记");assert.equal((await call(`/captures/${queued.id}/retry`,"POST",{})).status,202);done=await completed(queued.id);assert.equal(done.status,"completed");assert.equal((await call(`/captures/${queued.id}/retry`,"POST",{})).status,409);});
  await t.test("bare keys without a service are skipped before model calls and logs do not retain the key",async()=>{
   const content="sk-synthetic-no-service-0123456789abcdef";
   const before=calls;
   const response=await submit("bare-key",{content});assert.equal(response.status,200);
   const result=await response.json() as any;assert.equal(result.status,"filtered");assert.equal(result.reasonCode,"CAPTURE_UNCLEAR_PURPOSE");
   await drainCaptures();assert.equal(calls,before);
   const {listClipboardLogs}=await import("../src/services/clipboard-integration.js");
   const row=listClipboardLogs(owner).items.find(item=>item.requestId==="bare-key");
   assert.equal(row?.code,"CAPTURE_UNCLEAR_PURPOSE");assert.ok(!row?.preview.includes(content));
  });
  await t.test("AI filtering defaults off and cannot be enabled without a prompt",async()=>{
   assert.equal(getClipboardSettings(owner).settings.aiFilterEnabled,false);
   const response=await app.request("/api/clipboard-settings",{method:"PUT",headers:{Authorization:"Bearer fixture-login","Content-Type":"application/json"},body:JSON.stringify({...getClipboardSettings(owner).settings,aiFilterEnabled:true,aiFilterPrompt:"  "})});assert.equal(response.status,400);
  });
  await t.test("fixed rules run before optional AI filtering",async()=>{
   saveClipboardSettings(owner,clipboardSettingsSchema.parse({enabled:true,notebookId:root.id,aiFilterEnabled:true,aiFilterPrompt:"只收集技术资料",excludeKeywords:["skip"]}));
   const before=calls;const response=await submit("ai-rule-first",{content:"skip this text"});assert.equal(response.status,200);assert.equal((await response.json() as any).reasonCode,"KEYWORD_EXCLUDED");await drainCaptures();assert.equal(calls,before);
  });
  await t.test("AI rejects without creating a note and retains original plus deterministic replay",async()=>{
   saveClipboardSettings(owner,clipboardSettingsSchema.parse({enabled:true,notebookId:root.id,aiFilterEnabled:true,aiFilterPrompt:"只收集技术资料"}));filterReply={collect:false};
   const notes=(db.prepare("SELECT count(*) n FROM notes").get() as any).n;const before=filterCalls;
   const queued=await(await submit("ai-reject",{content:"今晚买一瓶酱油"})).json() as any;const result=await completed(queued.id);
   assert.equal(result.status,"filtered");assert.equal(result.reasonCode,"AI_FILTERED");assert.equal(result.result,null);assert.equal(result.originalContent,"今晚买一瓶酱油");assert.equal(filterCalls,before+1);assert.equal((db.prepare("SELECT count(*) n FROM notes").get() as any).n,notes);
   const repeat=await submit("ai-reject",{content:"今晚买一瓶酱油"});assert.equal(repeat.status,200);assert.equal((await repeat.json() as any).status,"filtered");await drainCaptures();assert.equal(filterCalls,before+1);
   assert.equal((await call(`/captures/${queued.id}/retry`,"POST",{})).status,409);
  });
  await t.test("AI permits collection and disabled AI ignores its saved prompt",async()=>{
   filterReply={collect:true};nextPlan=plan(root.id,[],"AI放行笔记");let before=calls;
   let result=await completed((await(await submit("ai-allow")).json() as any).id);assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(calls,before+2);
   saveClipboardSettings(owner,{...getClipboardSettings(owner).settings,aiFilterEnabled:false});filterReply={collect:false};before=calls;
   result=await completed((await(await submit("ai-disabled")).json() as any).id);assert.equal(result.status,"completed");assert.equal(calls,before+1);
  });
  await t.test("invalid AI verdict fails safely; retry preserves the original filter snapshot",async()=>{
   saveClipboardSettings(owner,{...getClipboardSettings(owner).settings,aiFilterEnabled:true});filterReply="invalid provider text";
   const queued=await(await submit("ai-invalid")).json() as any;let result=await completed(queued.id);assert.equal(result.status,"failed");assert.equal(result.errorCode,"CAPTURE_FILTER_INVALID_RESULT");assert.equal(result.originalContent,original);
   saveClipboardSettings(owner,{...getClipboardSettings(owner).settings,aiFilterEnabled:false});filterReply={collect:true};nextPlan=plan(root.id,[],"AI重试笔记");let before=filterCalls;
   assert.equal((await call(`/captures/${queued.id}/retry`,"POST",{})).status,202);result=await completed(queued.id);assert.equal(result.status,"completed");assert.equal(filterCalls,before+1);
  });
  await t.test("temporary AI filtering failures retry twice without duplicate saving",async()=>{
   saveClipboardSettings(owner,{...getClipboardSettings(owner).settings,aiFilterEnabled:true});filterReply={collect:true};transientFilterFailures=2;nextPlan=plan(root.id,[],"过滤临时故障恢复");const before=filterCalls;
   const result=await completed((await(await submit("ai-transient-retry")).json() as any).id);assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(filterCalls,before+3);
  });
  await t.test("AI provider failure preserves original and does not silently allow content",async()=>{
   saveClipboardSettings(owner,{...getClipboardSettings(owner).settings,aiFilterEnabled:true});filterReply="provider-error";
   const count=(db.prepare("SELECT count(*) n FROM notes").get() as any).n;const queued=await(await submit("ai-provider-fail")).json() as any;const failed=await completed(queued.id);assert.equal(failed.status,"failed");assert.equal(failed.errorCode,"CAPTURE_AI_HTTP_503");assert.equal(failed.originalContent,original);assert.equal((db.prepare("SELECT count(*) n FROM notes").get() as any).n,count);
   filterReply={collect:true};
  });
  await t.test("folder authority is rechecked after AI filtering completes",async()=>{
   const saved=getClipboardSettings(owner).settings;const sibling=createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:null,nodeType:"folder",title:"过滤中变更授权"});
   duringFilter=()=>saveClipboardSettings(owner,{...saved,notebookId:sibling.resourceId});filterReply={collect:true};
   const queued=await(await submit("ai-authority-change")).json() as any;const failed=await completed(queued.id);assert.equal(failed.status,"failed");assert.equal(failed.errorCode,"CAPTURE_TARGET_FORBIDDEN");assert.equal(failed.originalContent,original);saveClipboardSettings(owner,saved);
  });
  await t.test("approved AI decision survives an organizing failure and is not repeated on retry",async()=>{
   saveClipboardSettings(owner,{...getClipboardSettings(owner).settings,aiFilterEnabled:true});filterReply={collect:true};nextPlan={bad:"plan"};
   const queued=await(await submit("ai-approved-retry")).json() as any;const failed=await completed(queued.id);assert.equal(failed.status,"failed");assert.equal(failed.errorCode,"CAPTURE_INVALID_PLAN");const before=filterCalls;
   nextPlan=plan(root.id,[],"整理重试笔记");assert.equal((await call(`/captures/${queued.id}/retry`,"POST",{})).status,202);const result=await completed(queued.id);assert.equal(result.status,"completed");assert.equal(filterCalls,before);
   saveClipboardSettings(owner,{...getClipboardSettings(owner).settings,aiFilterEnabled:false});
  });
  await t.test("dedicated LAN listener accepts only capture routes without Cookie",async()=>{
   const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,"127.0.0.1",resolve));const port=(probe.address() as any).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
   process.env.NOWEN_CLIPBOARD_PORT=String(port);process.env.NOWEN_CLIPBOARD_PUBLIC_URL=`http://127.0.0.1:${port}/api/clipboard/captures`;
   const {startClipboardGateway}=await import("../src/services/clipboard-gateway.js");const gateway=startClipboardGateway()!;
   try{
    const endpoint=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(endpoint+"/api/clipboard/policy",{headers:{Authorization:`Bearer ${raw}`}})).status,200);
    assert.equal((await fetch(endpoint+"/api/clipboard/policy")).status,401);
    assert.equal((await fetch(endpoint+"/api/notes",{headers:{Authorization:`Bearer ${raw}`}})).status,404);
    assert.equal((await fetch(endpoint+"/api/clipboard-settings/token",{method:"POST",headers:{Authorization:`Bearer ${raw}`}})).status,404);
    assert.equal((await fetch(endpoint+"/api/auth/login",{method:"POST"})).status,404);
    assert.equal(getClipboardSettings(owner).endpoint,endpoint+"/api/clipboard/captures");
   }finally{await new Promise<void>(resolve=>gateway.close(()=>resolve()));delete process.env.NOWEN_CLIPBOARD_PORT;delete process.env.NOWEN_CLIPBOARD_PUBLIC_URL;}
  });
  await t.test("a fresh process can copy the same token and read persisted settings/task originals",()=>{
   const script=`import fs from 'node:fs'; const p=JSON.parse(fs.readFileSync(0,'utf8')); const im=await import('./src/services/clipboard-integration.ts'); const integration=im.default||im; const cm=await import('./src/services/captures.ts'); const capture=cm.default||cm; if(integration.copyClipboardToken(p.userId).token!==p.token)throw new Error('Token changed'); const actor=integration.authenticateClipboard(p.token); if(actor.userId!==p.userId || capture.getCapture(actor,p.captureId).status!=='completed')throw new Error('Persistence mismatch'); console.log('RESTART_TOKEN_OK');`;
   const result=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",script],{cwd:process.cwd(),env:process.env,input:JSON.stringify({userId:owner,token:raw,captureId:first.id}),encoding:"utf8",timeout:20000});
   assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/RESTART_TOKEN_OK/);
  });
  await t.test("disable, account disable, rotation and revocation reject tokens and queued writes",async()=>{const saved=getClipboardSettings(owner).settings;saveClipboardSettings(owner,{...saved,enabled:false});assert.equal((await call("/policy")).status,401);saveClipboardSettings(owner,saved);db.prepare("UPDATE users SET isDisabled=1 WHERE id=?").run(owner);assert.equal((await call("/policy")).status,401);db.prepare("UPDATE users SET isDisabled=0 WHERE id=?").run(owner);nextPlan=plan(root.id);const queued=await(await submit("revoked-queue")).json() as any;const previous=raw;raw=copyClipboardToken(owner,true).token;assert.notEqual(raw,previous);assert.equal((await call("/policy","GET",undefined,previous)).status,401);assert.equal((await call(`/captures/${first.id}`)).status,404);const before=calls;await drainCaptures();assert.equal(calls,before);assert.equal((db.prepare("SELECT errorCode FROM capture_jobs WHERE id=?").get(queued.id) as any).errorCode,"CAPTURE_TOKEN_INVALID");revokeClipboardToken(owner);assert.equal((await call("/policy")).status,401);assert.equal(getClipboardSettings(owner).tokenSet,false);});
 }finally{await new Promise<void>(resolve=>model.close(()=>resolve()));closeDb();fs.rmSync(directory,{recursive:true,force:true});}
});
