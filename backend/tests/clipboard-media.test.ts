import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createServer} from "node:http";
import sharp from "sharp";

const directory=fs.mkdtempSync(path.join(os.tmpdir(),"clipboard-media-"));
process.env.DB_PATH=path.join(directory,"test.db");process.env.ELECTRON_USER_DATA=directory;
process.env.JWT_SECRET="synthetic-clipboard-media-signing-secret";process.env.NODE_ENV="test";

test("clipboard folder recovery, image durability and account logs (DCC-001 DCC-003 DCC-004 DCC-006 DCC-007)",async t=>{
  const {getDb,closeDb}=await import("../src/db/schema");
  const integration=await import("../src/services/clipboard-integration");
  const captures=await import("../src/services/captures");
  const {setUserAISettings}=await import("../src/services/user-ai-settings");
  const {createKnowledgeChild,listKnowledgeTree}=await import("../src/services/knowledgeTree");
  const db=getDb();db.prepare("INSERT INTO users(id,username,passwordHash) VALUES('owner','owner','hash'),('other','other','hash')").run();
  integration.saveClipboardSettings("owner",integration.clipboardSettingsSchema.parse({enabled:true,filterImages:false}));
  const actor=integration.authenticateClipboard(integration.copyClipboardToken("owner").token);
  let plans:any[]=[];let reads=0;let visionReads=0;let afterModel:(()=>void)|null=null;
  let visionResponses:any[]=[];const visionTokenLimits:number[]=[];
  const model=createServer(async(req,res)=>{
    const bytes=[];for await(const chunk of req)bytes.push(chunk);
    const body=JSON.parse(Buffer.concat(bytes).toString());
    if(Array.isArray(body.messages[0].content)){
      visionReads++;visionTokenLimits.push(body.max_tokens);
      const reply=visionResponses.shift();
      if(reply?.status){res.writeHead(reply.status);res.end("synthetic upstream failure");return;}
      if(reply?.raw){res.end(reply.raw);return;}
      res.end(JSON.stringify(reply||{choices:[{message:{content:"红色方块，纯色背景，用于图片上传验收。"}}]}));return;
    }
    reads++;afterModel?.();afterModel=null;
    const plan=plans.length>1?plans.shift():plans[0];
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)}}]}));
  });
  await new Promise<void>(resolve=>model.listen(0,"127.0.0.1",resolve));
  const apiUrl=`http://127.0.0.1:${(model.address() as any).port}/v1`;
  setUserAISettings("owner",[{key:"ai_api_url",value:apiUrl},{key:"ai_api_key",value:"synthetic"},{key:"ai_model",value:"mock"},
    {key:"ai_multimodal_profile_id",value:"vision"},{key:"ai_multimodal_model",value:"vision-model"},
    {key:"ai_profiles_v1",value:JSON.stringify([{id:"vision",apiUrl,apiKey:"synthetic",customHeaders:{}}])}]);
  const plan=(folderPath:string[],notebookId:string|null=null)=>({action:"create",notebookId,noteId:null,folderPath,title:"图片资料",content:"# 图片资料\n\n![图片](nowen-image-0)"});
  const submit=async(id:string,extra:any={})=>{
    const value=integration.clipboardSubmissionSchema.parse({requestId:id,content:"合成资料",...extra});
    const queued=integration.submitClipboard(actor,value);await captures.drainCaptures();
    return captures.presentCapture(captures.getCapture(actor,queued.id));
  };
  try {
    await t.test("empty catalogs repair invalid IDs and create a meaningful 2-level path",async()=>{
      plans=[plan([],"deleted-id"),plan(["技术资料","数据库"])];
      const result=await submit("empty-catalog");assert.equal(result.status,"completed");assert.equal(reads,2);
      assert.match(result.result.path,/技术资料 \/ 数据库/);
    });
    await t.test("a deleted automatic target is re-planned without restoring it",async()=>{
      const old=createKnowledgeChild({actorUserId:"owner",workspaceId:null,parentId:null,nodeType:"folder",title:"待删除目录"});
      plans=[plan([],old.resourceId),plan(["研发","移动端","iOS"])]
      afterModel=()=>{db.prepare("UPDATE notebooks SET isDeleted=1 WHERE id=?").run(old.resourceId);db.prepare("UPDATE knowledge_tree_nodes SET isDeleted=1 WHERE resourceId=?").run(old.resourceId);};
      const result=await submit("target-deleted");assert.equal(result.status,"completed");assert.match(result.result.path,/研发 \/ 移动端 \/ iOS/);
      assert.equal((db.prepare("SELECT isDeleted FROM notebooks WHERE id=?").get(old.resourceId) as any).isDeleted,1);
    });
    await t.test("a null model parent is anchored to the explicit authorized folder",async()=>{
      const target=createKnowledgeChild({actorUserId:"owner",workspaceId:null,parentId:null,nodeType:"folder",title:"明确指定目录"});
      for(const [index,parent] of [null,""] .entries()) {
        plans=[plan(["新增分类"],parent)];
        const result=await submit(`bound-parent-${index}`,{notebookId:target.resourceId});
        assert.equal(result.status,"completed");assert.match(result.result.path,/明确指定目录 \/ 新增分类/);
      }
      const tree=listKnowledgeTree({userId:"owner",workspaceId:null});
      assert.ok(!tree.some(node=>node.title==="新增分类"&&node.parentId===null));
    });
    await t.test("a bare file path stays a path even if the model writes a document",async()=>{
      const original="/Users/example/Documents/接口文档 V2.1.pdf";
      plans=[{...plan(["资料","文件路径"]),title:"接口文档 V2.1",content:"# 接口文档\n\n本文涵盖通信协议、接口定义及数据格式。\n\n## 主要内容\n\n请参考原始PDF。"}];
      const result=await submit("path-no-expansion",{content:original});
      assert.equal(result.status,"completed");assert.equal(result.originalContent,original);
      assert.equal(result.result.content,original);
      assert.ok(result.result.path.endsWith(" / 接口文档 V2.1.pdf"));
    });
    await t.test("Windows, file URLs, relative paths and web URLs retain their literal values",async()=>{
      const references=[String.raw`C:\Documents\design V2.pdf`,"file:///Users/example/design.pdf","./images/photo.png","https://docs.example.test/guide?id=729&version=2"];
      for(const [index,original] of references.entries()) {
        plans=[{...plan(["资料","链接"]),title:"虚构的项目 2025-03-25",content:"# 不应该出现的文章\n\n这里是扩写的介绍。"}];
        const result=await submit(`reference-no-expansion-${index}`,{content:original});
        assert.equal(result.status,"completed");assert.equal(result.result.content,original);
        assert.ok(!result.result.path.includes("2025-03-25"));
      }
    });
    await t.test("unclear content is skipped durably without creating folders or notes (DCC-003 DCC-006)",async()=>{
      const counts=()=>["notes","notebooks"].map(table=>(db.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n);
      const before=counts();
      plans=[{action:"skip",reason:"unclear_purpose"}];
      const original="用途不明的合成字符片段 abc-123";
      const result=await submit("unclear-purpose",{content:original});
      assert.equal(result.status,"filtered");assert.equal(result.reasonCode,"CAPTURE_UNCLEAR_PURPOSE");assert.equal(result.result,null);
      assert.equal(result.originalContent,original);assert.deepEqual(counts(),before);
      const calls=reads;const replay=await submit("unclear-purpose",{content:original});
      assert.equal(replay.id,result.id);assert.equal(reads,calls);
      assert.equal(integration.listClipboardLogs("owner").items.find(row=>row.requestId==="unclear-purpose")?.code,"CAPTURE_UNCLEAR_PURPOSE");
    });
    await t.test("automatic collection does not create or reuse generic pending folders",async()=>{
      const inbox=createKnowledgeChild({actorUserId:"owner",workspaceId:null,parentId:null,nodeType:"folder",title:"收集箱"});
      const pending=createKnowledgeChild({actorUserId:"owner",workspaceId:null,parentId:inbox.id,nodeType:"folder",title:"待整理"});
      const count=(db.prepare("SELECT count(*) n FROM notes").get() as any).n;
      for(const [index,proposed]of [plan(["收集箱","待整理"]),plan([],pending.resourceId),plan([])].entries()) {
        plans=[proposed];const result=await submit(`no-pending-folder-${index}`,{content:"无法辨认用途的合成片段"});
        assert.equal(result.status,"filtered",JSON.stringify(result));assert.equal(result.reasonCode,"CAPTURE_UNCLEAR_PURPOSE");
      }
      assert.equal((db.prepare("SELECT count(*) n FROM notes").get() as any).n,count);
      plans=[plan([],inbox.resourceId)];
      const explicit=await submit("explicit-inbox",{content:"明确指定保存的技术资料",notebookId:inbox.resourceId});
      assert.equal(explicit.status,"completed");assert.equal(explicit.result.notebookId,inbox.resourceId);
    });
    await t.test("a late skip decision still rechecks revoked collection authority (DCC-006)",async()=>{
      plans=[{action:"skip",reason:"unclear_purpose"}];
      afterModel=()=>{db.prepare("UPDATE api_tokens SET revokedAt=datetime('now') WHERE id=?").run(actor.tokenId);};
      try {
        const result=await submit("revoked-skip",{content:"用途不明的另一个合成片段"});
        assert.equal(result.status,"failed");assert.equal(result.errorCode,"CAPTURE_TOKEN_INVALID");
      } finally {db.prepare("UPDATE api_tokens SET revokedAt=NULL WHERE id=?").run(actor.tokenId);}
    });
    await t.test("different account entries append without replacing the first entry",async()=>{
      plans=[{...plan(["个人资料","账号"]),title:"账号密码本",content:"服务：GitHub\n账号：synthetic-alice\n密码：fake-alpha"}];
      const first=await submit("account-collection-first",{content:"GitHub 账号 synthetic-alice 密码 fake-alpha"});
      assert.equal(first.status,"completed");
      plans=[{action:"append",notebookId:first.result.notebookId,noteId:first.result.noteId,folderPath:[],title:"账号密码本",content:"服务：GitLab\n账号：synthetic-bob\n密码：fake-beta"}];
      const second=await submit("account-collection-second",{content:"GitLab 用户名 synthetic-bob 密码 fake-beta"});
      assert.equal(second.status,"completed");assert.equal(second.result.noteId,first.result.noteId);
      const saved=db.prepare("SELECT content FROM notes WHERE id=?").get(first.result.noteId) as any;
      assert.match(saved.content,/synthetic-alice/);assert.match(saved.content,/synthetic-bob/);
      for (const [index,title] of [undefined,null,""] .entries()) {
        plans=[{action:"append",notebookId:first.result.notebookId,noteId:first.result.noteId,folderPath:[],title,content:`服务：合成服务${index}\n账号：synthetic-extra-${index}`}];
        const appended=await submit(`account-no-title-${index}`,{content:`合成服务${index} 账号 synthetic-extra-${index}`});
        assert.equal(appended.status,"completed",JSON.stringify(appended));assert.equal(appended.result.noteId,first.result.noteId);
        assert.equal((db.prepare("SELECT title FROM notes WHERE id=?").get(first.result.noteId) as any).title,"账号密码本");
      }
    });
    const png=await sharp({create:{width:32,height:32,channels:3,background:"red"}}).png().toBuffer();
    const markdown="![原说明](./images/red.png)";
    const image={source:"./images/red.png",markdown,alt:"原说明",mimeType:"image/png",data:png.toString("base64")};
    await t.test("transient image HTTP failures retry once before saving",async()=>{
      plans=[plan(["视觉资料","图片"])];visionResponses=[{status:503}];const before=visionReads;
      const result=await submit("image-transient",{content:markdown,images:[image]});
      assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(visionReads,before+2);
    });
    await t.test("image output truncation increases the budget without indexing reasoning",async()=>{
      plans=[plan(["视觉资料","图片"])];
      visionResponses=[{choices:[{finish_reason:"length",message:{content:null,reasoning_content:"private synthetic reasoning"}}]}];
      const before=visionTokenLimits.length;
      const result=await submit("image-truncated",{content:markdown,images:[image]});
      assert.equal(result.status,"completed",JSON.stringify(result));assert.deepEqual(visionTokenLimits.slice(before),[500,2000]);
      assert.ok(!result.result.content.includes("private synthetic reasoning"));
    });
    await t.test("image HTTP, invalid JSON and empty answers retain distinct safe errors",async()=>{
      const count=(db.prepare("SELECT count(*) n FROM notes").get() as any).n;
      for(const [index,response,code]of [
        [0,{status:400},"CAPTURE_IMAGE_HTTP_400"],
        [1,{raw:"not-json"},"CAPTURE_IMAGE_INVALID_RESPONSE"],
        [2,{choices:[{finish_reason:"stop",message:{content:null,reasoning_content:"not the description"}}]},"CAPTURE_IMAGE_EMPTY_RESPONSE"],
      ] as const){
        visionResponses=[response];const before=visionReads;
        const result=await submit(`image-diagnosis-${index}`,{content:markdown,images:[image]});
        assert.equal(result.status,"failed");assert.equal(result.errorCode,code);assert.equal(result.originalContent,markdown);
        assert.equal(visionReads,before+1);assert.equal(result.result,null);
        assert.equal(integration.listClipboardLogs("owner").items.find(row=>row.requestId===`image-diagnosis-${index}`)?.code,code);
      }
      assert.equal((db.prepare("SELECT count(*) n FROM notes").get() as any).n,count);
    });
    await t.test("image bytes, <=200-character description, Markdown and searchable text are saved together",async()=>{
      plans=[plan(["视觉资料","图片"])]
      const original=`  图片原文\n${markdown}\n  `;
      const result=await submit("image-create",{content:original,images:[image]});assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(result.originalContent,original);
      const stored=db.prepare("SELECT content,contentText FROM notes WHERE id=?").get(result.result.noteId) as any;
      assert.match(stored.content,/!\[红色方块，纯色背景，用于图片上传验收。\]\(\/api\/attachments\//);assert.ok(!stored.content.includes("data:image"));
      assert.ok(stored.contentText.includes("红色方块"));
      const rows=db.prepare("SELECT path FROM attachments WHERE noteId=?").all(result.result.noteId) as any[];assert.equal(rows.length,1);
      assert.deepEqual(fs.readFileSync(path.join(directory,"attachments",rows[0].path)),png);
      assert.equal(integration.listClipboardLogs("owner").items.find(row=>row.requestId==="image-create")?.status,"completed");assert.equal(integration.listClipboardLogs("other").items.length,0);
    });
    for(const format of ["markdown","html","tiptap-json"])await t.test(`image append to ${format} preserves existing content and replay writes once`,async()=>{
      const folder=listKnowledgeTree({userId:"owner",workspaceId:null}).find(node=>node.resourceType==="notebook"&&!node.isDeleted)!;
      const router=(await import("../src/routes/notes")).default;
      const content=format==="tiptap-json"?JSON.stringify({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"已有正文"}]}]}):format==="html"?"<p>已有正文</p>":"已有正文";
      const response=await router.request("/",{method:"POST",headers:{"X-User-Id":"owner","Content-Type":"application/json"},body:JSON.stringify({notebookId:folder.resourceId,title:format,content,contentFormat:format})});
      assert.equal(response.status,201);const target=await response.json() as any;
      plans=[{action:"append",notebookId:folder.resourceId,noteId:target.id,folderPath:[],title:format,content:"![图片](nowen-image-0)"}];
      const result=await submit(`image-append-${format}`,{content:markdown,noteId:target.id,images:[image]});assert.equal(result.status,"completed",JSON.stringify(result));
      const saved=db.prepare("SELECT content,contentText FROM notes WHERE id=?").get(target.id) as any;
      assert.ok(saved.content.includes("已有正文"));assert.ok(saved.content.includes("/api/attachments/"));assert.ok(!saved.content.includes("data:image"));
      assert.ok(saved.contentText.includes("红色方块"),"image alt description must remain searchable after note indexing");
      assert.equal((db.prepare("SELECT count(*) n FROM attachments WHERE noteId=?").get(target.id) as any).n,1);
      const repeated=await submit(`image-append-${format}`,{content:markdown,noteId:target.id,images:[image]});assert.equal(repeated.id,result.id);
      assert.equal((db.prepare("SELECT count(*) n FROM attachments WHERE noteId=?").get(target.id) as any).n,1);
    });
    await t.test("receipt failure rolls back image metadata, note and files; original-ID retry creates four levels once",async()=>{
      const blue=await sharp({create:{width:32,height:32,channels:3,background:"blue"}}).png().toBuffer();
      const value=integration.clipboardSubmissionSchema.parse({requestId:"image-rollback",content:markdown,images:[{...image,data:blue.toString("base64")}]});
      plans=[plan(["文档","研发","移动端","iOS"])];
      const queued=integration.submitClipboard(actor,value);
      const notes=(db.prepare("SELECT count(*) n FROM notes").get() as any).n,attachments=(db.prepare("SELECT count(*) n FROM attachments").get() as any).n;
      const files=()=>fs.readdirSync(path.join(directory,"attachments"),{recursive:true,withFileTypes:true}).filter(item=>item.isFile()).length;
      const before=files();
      db.exec("CREATE TEMP TRIGGER reject_capture BEFORE UPDATE OF status ON capture_jobs WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
      await captures.drainCaptures();db.exec("DROP TRIGGER reject_capture");
      assert.equal(captures.getCapture(actor,queued.id).status,"failed");assert.equal((db.prepare("SELECT count(*) n FROM notes").get() as any).n,notes);
      assert.equal((db.prepare("SELECT count(*) n FROM attachments").get() as any).n,attachments);assert.equal(files(),before);
      captures.retryCapture(actor,queued.id);await captures.drainCaptures();const done=captures.presentCapture(captures.getCapture(actor,queued.id));
      assert.equal(done.status,"completed");assert.match(done.result.path,/文档 \/ 研发 \/ 移动端 \/ iOS/);
      assert.equal((db.prepare("SELECT count(*) n FROM notes").get() as any).n,notes+1);assert.equal(files(),before+1);
    });
    await t.test("bad image bytes retain original and never create a note",async()=>{
      const count=(db.prepare("SELECT count(*) n FROM notes").get() as any).n;
      const result=await submit("invalid-image",{images:[{...image,data:Buffer.from("not a PNG").toString("base64")}]});
      assert.equal(result.status,"failed");assert.equal(result.errorCode,"CAPTURE_IMAGE_INVALID");assert.equal((db.prepare("SELECT count(*) n FROM notes").get() as any).n,count);
      assert.equal(integration.listClipboardLogs("owner").items.find(row=>row.requestId==="invalid-image")?.code,"CAPTURE_IMAGE_INVALID");
    });
    await t.test("fixed filtered and rejected target requests also appear in owner logs",async()=>{
      integration.saveClipboardSettings("owner",{...integration.getClipboardSettings("owner").settings,excludeKeywords:["skip"]});
      integration.submitClipboard(actor,integration.clipboardSubmissionSchema.parse({requestId:"filtered",content:"skip"}));
      assert.throws(()=>integration.submitClipboard(actor,integration.clipboardSubmissionSchema.parse({requestId:"rejected",content:"normal",notebookId:"gone"})));
      const logs=integration.listClipboardLogs("owner").items;assert.ok(logs.some(row=>row.requestId==="filtered"&&row.status==="filtered"));assert.ok(logs.some(row=>row.requestId==="rejected"&&row.status==="failed"));
    });
    await t.test("revoked capture cannot send an image to a model",async()=>{
      const value=integration.clipboardSubmissionSchema.parse({requestId:"revoked-image",content:markdown,images:[image]});
      const queued=integration.submitClipboard(actor,value);const before=visionReads;
      db.prepare("UPDATE api_tokens SET revokedAt=datetime('now') WHERE id=?").run(actor.tokenId);
      await captures.drainCaptures();assert.equal(visionReads,before);assert.equal(captures.presentCapture(captures.getCapture(actor,queued.id)).errorCode,"CAPTURE_TOKEN_INVALID");
    });
  }finally {await new Promise<void>(resolve=>model.close(()=>resolve()));closeDb();fs.rmSync(directory,{recursive:true,force:true});}
});
