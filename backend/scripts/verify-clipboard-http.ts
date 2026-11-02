/** Single-token clipboard, full-server, real-model acceptance. Uses an isolated database and synthetic text only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

async function main() {
  const configFile = process.env.NOWEN_CAPTURE_LIVE_CONFIG;
  if (!configFile) throw new Error("Set NOWEN_CAPTURE_LIVE_CONFIG to a private JSON file containing user AI settings");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<string,string>;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-clipboard-http-"));
  process.env.DB_PATH = path.join(temp, "acceptance.db");
  process.env.NODE_ENV = "test";
  const { getDb, closeDb } = await import("../src/db/schema.js");
  const { setUserAISettings } = await import("../src/services/user-ai-settings.js");
  const bcrypt = (await import("bcryptjs")).default;
  const userId = randomUUID(); const password = randomBytes(24).toString("base64url");
  getDb().prepare("INSERT INTO users(id,username,passwordHash,role) VALUES(?,'clipboard-http-fixture',?,'user')").run(userId,bcrypt.hashSync(password,10));
  setUserAISettings(userId,Object.entries(config).filter(([key])=>["ai_provider","ai_api_url","ai_api_key","ai_custom_headers","ai_model"].includes(key)).map(([key,value])=>({key,value})));
  closeDb();
  const portProbe=createServer(); await new Promise<void>(r=>portProbe.listen(0,"127.0.0.1",r));
  const port=Number(process.env.NOWEN_CLIPBOARD_PORT || (portProbe.address() as any).port); await new Promise<void>(r=>portProbe.close(()=>r()));
  const captureProbe=createServer();await new Promise<void>(r=>captureProbe.listen(0,"127.0.0.1",r));
  const capturePort=(captureProbe.address() as any).port;await new Promise<void>(r=>captureProbe.close(()=>r()));
  const captureBase=`http://127.0.0.1:${capturePort}`;
  const output=fs.openSync(path.join(temp,"backend.log"),"a");
  const image=process.env.NOWEN_CAPTURE_IMAGE;
  const secret=randomBytes(48).toString("hex");
  const server=image
    ? spawn("docker",["run","--rm","--platform","linux/amd64","-p",`127.0.0.1:${port}:3001`,"-p",`127.0.0.1:${capturePort}:3002`,"-e","NOWEN_CLIPBOARD_PORT=3002","-e","NOWEN_CLIPBOARD_HOST=0.0.0.0","-v",`${temp}:/tmp/capture-data`,
      "-e","DB_PATH=/tmp/capture-data/acceptance.db","-e","NODE_ENV=test","-e",`JWT_SECRET=${secret}`,"-e","DISABLE_MDNS=1","-e","NOWEN_SECURE_BOOTSTRAP=1",image],{stdio:["ignore",output,output]})
    : spawn(process.execPath,["--import","tsx","src/index.hardened.ts"],{cwd:process.cwd(),stdio:["ignore",output,output],env:{...process.env,PORT:String(port),JWT_SECRET:secret,NOWEN_CLIPBOARD_PORT:String(capturePort),NOWEN_CLIPBOARD_HOST:"127.0.0.1",DISABLE_MDNS:"1",NOWEN_SECURE_BOOTSTRAP:"1",ELECTRON_USER_DATA:temp,NOWEN_FNOS_SOCKET:"",...(process.env.FRONTEND_DIST?{FRONTEND_DIST:process.env.FRONTEND_DIST}:{})}});
  const base=`http://127.0.0.1:${port}`;
  let token="";
  const request=async (url:string,method="GET",body?:unknown,auth=token)=> {
    const r=await fetch((url.startsWith("/api/clipboard/")?captureBase:base)+url,{method,headers:{"Content-Type":"application/json",...(auth?{Authorization:`Bearer ${auth}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:r.status,body:await r.json() as any};
  };
  const report:any[]=[];
  try {
    let ready=false;
    for(let i=0;i<100;i++) {
      try { ready=(await fetch(base+"/api/health")).ok; } catch {}
      if(ready) break;
      if(server.exitCode!==null) throw new Error("Full backend exited before startup; inspect "+path.join(temp,"backend.log"));
      await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(ready,"backend must start");
    const login=await request("/api/auth/login","POST",{username:"clipboard-http-fixture",password});
    assert.equal(login.status,200); const jwt=login.body.token;
    const initial=await request("/api/clipboard-settings","GET",undefined,jwt);
    assert.equal(initial.status,200,"settings read: "+JSON.stringify(initial.body));
    const settings={...initial.body.settings,enabled:true,systemPrompt:"使用简洁中文标题，保留所有具体数字和单位。"};
    const saved=await request("/api/clipboard-settings","PUT",settings,jwt);assert.equal(saved.status,200,"settings save: "+JSON.stringify(saved.body));
    const issued=await request("/api/clipboard-settings/token","POST",{},jwt);assert.equal(issued.status,200,"token issue failed");token=issued.body.token;
    assert.match(token,/^ncc_/);
    const policy=await request("/api/clipboard/policy");assert.equal(policy.status,200,"policy: "+JSON.stringify(policy.body));
    assert.equal((await request("/api/notes")).status,401);
    assert.equal((await request("/api/clipboard/policy","GET",undefined,"")).status,401);
    assert.equal((await fetch(captureBase+"/api/notes",{headers:{Authorization:`Bearer ${token}`}})).status,404);
    report.push({label:"single Bearer token; no Cookie; unrelated API and anonymous requests denied",passed:true});
    const capture=async (label:string,input:any) => {
      const started=Date.now();
      const sent=await request("/api/clipboard/captures","POST",input);
      assert.equal(sent.status,202,JSON.stringify(sent.body));
      let job=sent.body;
      while(["queued","processing"].includes(job.status) && Date.now()-started<120000) {
        await new Promise(r=>setTimeout(r,1000));
        const read=await request(`/api/clipboard/captures/${job.id}`);assert.equal(read.status,200);job=read.body;
      }
      assert.equal(job.status,"completed",JSON.stringify({label,status:job.status,errorCode:job.errorCode}));
      assert.equal(job.originalContent,input.content);
      const stored=await request(`/api/notes/${job.result.noteId}`,"GET",undefined,jwt);
      assert.equal(stored.status,200);assert.equal(stored.body.version,job.result.version);
      report.push({label,action:job.result.action,path:job.result.path,elapsedMs:Date.now()-started,originalPreserved:true});
      console.log(JSON.stringify(report.at(-1)));
      return {job,note:stored.body};
    };
    const first=await capture("new folders and note",{requestId:"live-new-path",content:"PostgreSQL索引调优。查询耗时原来850ms，建立索引后120ms。保留这两个数字。",instruction:"创建文件夹采集验收，其下创建数据库文件夹，并在里面新建笔记，标题PostgreSQL索引调优。"});
    assert.equal(first.job.result.action,"create");assert.match(first.job.result.path,/采集验收.*数据库/);assert.match(first.note.content,/850/);assert.match(first.note.content,/120/);
    const second=await capture("automatic append",{requestId:"live-auto-append",content:"PostgreSQL索引调优的补充：使用EXPLAIN ANALYZE检查执行计划，注意写入成本。",instruction:"补充刚才同一主题的已有笔记。"});
    assert.equal(second.job.result.action,"append");assert.equal(second.note.id,first.note.id);assert.ok(second.note.content.includes("850"));assert.match(second.note.content,/EXPLAIN ANALYZE/);
    const third=await capture("new note in existing folder",{requestId:"live-existing-folder",content:"Redis缓存：热点数据缓存300秒，内存上限512MB。",notebookId:first.note.notebookId,instruction:"在指定的已有文件夹内创建一篇独立的新笔记，标题Redis缓存方案，不新建目录。"});
    assert.equal(third.job.result.action,"create");assert.equal(third.note.notebookId,first.note.notebookId);assert.notEqual(third.note.id,first.note.id);
    const fourth=await capture("new folder inside existing folder",{requestId:"live-subfolder",content:"NAS运维：每周六备份，保留最近四份备份。",notebookId:first.note.notebookId,instruction:"在指定目录下面创建NAS运维子文件夹，再新建一篇备份计划笔记。"});
    assert.equal(fourth.job.result.action,"create");assert.match(fourth.job.result.path,/NAS运维/);
    const explicit=await capture("explicit append",{requestId:"live-explicit",content:"Redis缓存补充：缓存击穿使用互斥锁。",noteId:third.note.id});
    assert.equal(explicit.job.result.action,"append");assert.equal(explicit.note.id,third.note.id);assert.match(explicit.note.content,/300/);assert.match(explicit.note.content,/互斥锁/);
    const raw="  原样保存\r\nhttps://example.test/?a=1&b=2\n\t123.45  ";
    const verbatim=await capture("verbatim text",{requestId:"live-verbatim",content:raw,organize:false,notebookId:first.note.notebookId,instruction:"新建独立笔记，标题原文保留测试，不新建文件夹。"});
    assert.equal(verbatim.job.result.content,raw);
    const repeated=await request("/api/clipboard/captures","POST",{requestId:"live-explicit",content:"Redis缓存补充：缓存击穿使用互斥锁。",noteId:third.note.id});
    assert.equal(repeated.status,200);assert.equal(repeated.body.id,explicit.job.id);
    assert.equal((await request(`/api/clipboard/captures/${explicit.job.id}/retry`,"POST",{})).status,409);
    report.push({label:"duplicate request and completed retry",passed:true});
    assert.equal((await request("/api/clipboard-settings","PUT",{...settings,notebookId:first.note.notebookId,excludeKeywords:["验证码"],excludeExtensions:["zip"]},jwt)).status,200);
    for(const [id,extra,reason] of [["keyword",{content:"验证码123456"},"KEYWORD_EXCLUDED"],["image",{kind:"image"},"IMAGE_FILTERED"],["file",{kind:"file"},"FILE_FILTERED"],["extension",{fileName:"archive.zip"},"EXTENSION_EXCLUDED"]] as const) {
      const filtered=await request("/api/clipboard/captures","POST",{requestId:`filter-${id}`,content:"合成过滤样本",...extra});
      assert.equal(filtered.status,200);assert.equal(filtered.body.status,"filtered");assert.equal(filtered.body.reasonCode,reason);
    }
    report.push({label:"server keyword/file/image/extension filters",passed:true});
    const aiSettings={...settings,notebookId:first.note.notebookId,aiFilterEnabled:true,aiFilterPrompt:"只收集计算机、软件开发、数据库或NAS运维相关的技术知识。拒绝生活购物、广告和闲聊。",excludeKeywords:["验证码"]};
    assert.equal((await request("/api/clipboard-settings","PUT",aiSettings,jwt)).status,200);
    const ruleFirst=await request("/api/clipboard/captures","POST",{requestId:"ai-rule-first",content:"验证码123456"});assert.equal(ruleFirst.status,200);assert.equal(ruleFirst.body.reasonCode,"KEYWORD_EXCLUDED");
    report.push({label:"fixed rules take precedence over enabled AI",passed:true});
    const rejectedInput={requestId:"ai-reject",content:"今天晚饭吃番茄炒蛋，回家顺路买瓶酱油。"};
    const rejected=await request("/api/clipboard/captures","POST",rejectedInput);assert.equal(rejected.status,202);let rejectedJob=rejected.body;
    const filterStarted=Date.now();
    while(["queued","processing"].includes(rejectedJob.status)&&Date.now()-filterStarted<120000){await new Promise(r=>setTimeout(r,1000));rejectedJob=(await request(`/api/clipboard/captures/${rejectedJob.id}`)).body;}
    assert.equal(rejectedJob.status,"filtered",JSON.stringify({status:rejectedJob.status,errorCode:rejectedJob.errorCode}));assert.equal(rejectedJob.reasonCode,"AI_FILTERED");assert.equal(rejectedJob.originalContent,rejectedInput.content);assert.equal(rejectedJob.result,null);
    assert.equal((await request("/api/clipboard/captures","POST",rejectedInput)).body.id,rejectedJob.id);
    report.push({label:"AI rejects off-topic text, retains original and replays idempotently",passed:true});
    await capture("AI allows technical text before organizing",{requestId:"ai-allow",content:"SQLite并发写入：BEGIN IMMEDIATE可以提前获得写锁，忙碌时使用busy_timeout等待。",notebookId:first.note.notebookId,instruction:"新建独立的SQLite并发写入笔记，不追加其他主题。"});
    assert.equal((await request("/api/clipboard-settings","PUT",{...aiSettings,aiFilterEnabled:false,aiFilterPrompt:"拒绝所有内容"},jwt)).status,200);
    await capture("disabled AI ignores saved filter prompt",{requestId:"ai-disabled",content:"今天晚饭吃番茄炒蛋，顺路买一瓶酱油。",notebookId:first.note.notebookId,instruction:"新建独立测试笔记，保留原意。"});
    assert.equal((await request("/api/clipboard-settings","PUT",settings,jwt)).status,200);
    const previous=token;
    token=(await request("/api/clipboard-settings/token/rotate","POST",{},jwt)).body.token;
    assert.notEqual(token,previous);
    assert.equal((await request("/api/clipboard/policy","GET",undefined,previous)).status,401);
    assert.equal((await request(`/api/clipboard/captures/${first.job.id}`)).status,404);
    assert.equal((await request("/api/clipboard-settings/token","POST",{},jwt)).body.token,token);
    report.push({label:"repeat copy, token rotation and old task isolation",passed:true});
    const out=process.env.NOWEN_CAPTURE_REPORT || path.join(temp,"acceptance.json");
    fs.writeFileSync(out,JSON.stringify({environment:image || "local-source",model:config.ai_model,checks:report,passed:true,nasEntryVerified:false,dedicatedListenerVerified:true},null,2));
    console.log(JSON.stringify({passed:true,checks:report.length,report:out}));
    if(process.env.NOWEN_CLIPBOARD_KEEP==="1") {
      fs.writeFileSync("/private/tmp/nowen-clipboard-http-ui.json",JSON.stringify({base,username:"clipboard-http-fixture",password,jwt,token,temp,pid:server.pid}),{mode:0o600});
      server.unref();return;
    }
    assert.equal((await request("/api/clipboard-settings/token","DELETE",undefined,jwt)).status,200);
    assert.equal((await request("/api/clipboard/policy")).status,401);
  } finally {
    if(process.env.NOWEN_CLIPBOARD_KEEP!=="1" || !fs.existsSync("/private/tmp/nowen-clipboard-http-ui.json")) {
      server.kill("SIGTERM");
      await new Promise<void>(r=>{if(server.exitCode!==null)r();else server.once("exit",()=>r());});
      fs.rmSync(temp,{recursive:true,force:true});
    }
    fs.closeSync(output);closeDb();
  }
}
main().catch(error=>{console.error(error instanceof Error ? error.message : "Acceptance failed");process.exitCode=1;});
