import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { Hono } from "hono";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-captures-"));
process.env.DB_PATH = path.join(directory, "test.db");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "isolated-capture-tests-signing-secret";

test("capture HTTP workflow creates folders/notes, appends all text formats and preserves originals (DCC-001 DCC-002 DCC-003 DCC-004 DCC-006)", async t => {
  const { getDb, closeDb } = await import("../src/db/schema.js");
  const { initApiTokensTable, generateApiTokenRaw, hashApiToken, resolveApiToken } = await import("../src/lib/api-tokens.js");
  const { enforceApiTokenAccess } = await import("../src/middleware/api-token-resource-scope.js");
  const { default: captures } = await import("../src/routes/captures.js");
  const { default: notesRouter } = await import("../src/routes/notes.js");
  const { projectMarkdownNoteForUser } = await import("../src/lib/markdownUserContent.js");
  const { captureInput, drainCaptures, initCaptures, startCaptureWorker } = await import("../src/services/captures.js");
  const { setUserAISettings } = await import("../src/services/user-ai-settings.js");
  const { createKnowledgeChild, listKnowledgeTree } = await import("../src/services/knowledgeTree.js");
  const { getFnosAccount } = await import("../src/lib/fnos-identity.js");
  const { dispatchFnosGateway, FNOS_PREFIX } = await import("../src/services/fnos-gateway.js");
  const db = getDb();
  initApiTokensTable(db); initCaptures();
  const { initAuditTables } = await import("../src/services/audit.js");
  const { setSyncBroadcaster } = await import("../src/sync/notify.js");
  const notices: Array<{ userId: string; message: any }> = [];
  setSyncBroadcaster((userId, message) => notices.push({ userId, message }));
  initAuditTables();
  const owner = getFnosAccount({ uid: "2001", username: "capture-test-owner", isAdmin: false }).id;
  const other = getFnosAccount({ uid: "2002", username: "capture-test-other", isAdmin: false }).id;
  const scopes = ["notes:read", "notes:write", "notebooks:read", "notebooks:write"];
  const issue = (id: string, userId = owner, grantedScopes = scopes, resourceMode = "unrestricted") => {
    const raw = generateApiTokenRaw();
    getDb().prepare("INSERT INTO api_tokens(id,userId,name,tokenHash,scopes,resourceMode) VALUES(?,?,?,?,?,?)")
      .run(id,userId,id,hashApiToken(raw),JSON.stringify(grantedScopes),resourceMode);
    return raw;
  };
  const raw = issue("capture-pat");
  const otherRaw = issue("other-pat", other);
  let modelCalls = 0;
  let temporaryFailures = 0;
  let duringModel: (() => void) | null = null;
  let nextPlan: any;
  const prompts: any[] = [];
  const model = createServer(async (req,res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    modelCalls++;
    prompts.push(JSON.parse(body.messages.at(-1).content));
    duringModel?.(); duringModel = null;
    if (nextPlan === "http-error" || temporaryFailures-- > 0) { res.writeHead(503); res.end("synthetic provider failure"); return; }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: typeof nextPlan === "string" ? nextPlan : JSON.stringify(nextPlan) } }] }));
  });
  await new Promise<void>(resolve => model.listen(0,"127.0.0.1",resolve));
  const address = model.address() as { port: number };
  setUserAISettings(owner,[{key:"ai_api_url",value:`http://127.0.0.1:${address.port}/v1`},{key:"ai_api_key",value:"synthetic-key"},{key:"ai_model",value:"capture-fixture"}]);
  const app = new Hono();
  app.use("/api/*", async (c,next) => {
    // Exercise the same PAT resolution and resource middleware as index.ts.
    const token = resolveApiToken(getDb(), (c.req.header("Authorization") || "").slice(7));
    if (!token) return c.json({error:"unauthorized"},401);
    c.req.raw.headers.set("X-User-Id",token.userId);
    c.req.raw.headers.set("X-Auth-Mode","api-token");
    c.req.raw.headers.set("X-Api-Token-Id",token.tokenId);
    c.req.raw.headers.set("X-Api-Resource-Mode",token.resourceMode);
    c.req.raw.headers.set("X-Api-Scopes",token.scopes.join(","));
    await next();
  });
  app.use("/api/*",enforceApiTokenAccess);
  app.route("/api/captures", captures);
  app.route("/api/notes", notesRouter);
  const call = (url: string, method="GET", body?: any, token=raw) => app.request(url,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const submit = async (input: any, token=raw) => {
    const response = await call("/api/captures","POST",input,token);
    assert.equal(response.status,202,await response.clone().text());
    return await response.json() as any;
  };
  const done = async (id: string, token=raw) => {
    await drainCaptures();
    const response = await call(`/api/captures/${id}`,"GET",undefined,token);
    assert.equal(response.status,200,await response.clone().text());
    return await response.json() as any;
  };
  const plan = (notebookId: string | null, folderPath: string[] = [], title="测试笔记", content="# 整理结果\n\n测试内容") =>
    ({action:"create",notebookId,noteId:null,folderPath,title,content});
  const note = (id: string) => getDb().prepare("SELECT * FROM notes WHERE id=?").get(id) as any;
  let root: any; let first: any;
  try {
    await t.test("creates a folder path and Markdown note; original text and committed version are durable",async () => {
      const original="  零散想法\r\nPostgreSQL 索引；预算123.45元  ";
      nextPlan=plan(null,["技术资料","PostgreSQL"],"索引笔记","# 索引\n\n预算：123.45元");
      const job=await submit({requestId:"new-path",content:original});
      first=await done(job.id);
      assert.equal(first.status,"completed",JSON.stringify(first));
      assert.equal(first.originalContent,original);
      assert.equal(first.result.action,"create");
      assert.equal(note(first.result.noteId).version,first.result.version);
      const tree=listKnowledgeTree({userId:owner,workspaceId:null});
      root=tree.find(n=>n.title==="技术资料");
      const child=tree.find(n=>n.title==="PostgreSQL");
      assert.equal(child?.parentId,root.id);
      assert.equal(note(first.result.noteId).notebookId,child?.resourceId);
      assert.ok(getDb().prepare("SELECT 1 FROM sync_changes_v2 WHERE entityType='note' AND entityId=?").get(first.result.noteId));
      assert.ok(getDb().prepare("SELECT 1 FROM sync_changes_v2 WHERE entityType='knowledge_tree_node' AND entityId=?").get(child!.id));
      const committedSequence=(getDb().prepare("SELECT MAX(sequence) sequence FROM sync_changes_v2 WHERE userId=?").get(owner) as any).sequence;
      assert.ok(notices.some(notice=>notice.userId===owner && notice.message.type==="sync.changed" && notice.message.sequence===committedSequence));
      assert.match(first.result.path,/技术资料 \/ PostgreSQL \/ 索引笔记/);
      closeDb();
      assert.equal(note(first.result.noteId).version,first.result.version);
      assert.equal((await done(job.id)).originalContent,original);
    });
    await t.test("creates a note inside an existing folder and does not duplicate folders",async () => {
      nextPlan=plan(root.resourceId,[],"新主题","# 新主题\n\n单独保存");
      const result=await done((await submit({requestId:"existing-folder",content:"新主题",notebookId:root.resourceId})).id);
      assert.equal(result.status,"completed",JSON.stringify(result));
      assert.equal(note(result.result.noteId).notebookId,root.resourceId);
      assert.equal(listKnowledgeTree({userId:owner,workspaceId:null}).filter(n=>n.title==="技术资料").length,1);
    });
    await t.test("creates a subfolder under an existing folder",async () => {
      nextPlan=plan(root.resourceId,["部署记录"],"NAS部署");
      const result=await done((await submit({requestId:"child-folder",content:"部署记录",notebookId:root.resourceId})).id);
      assert.equal(result.status,"completed",JSON.stringify(result));
      const tree=listKnowledgeTree({userId:owner,workspaceId:null});
      assert.equal(tree.find(n=>n.title==="部署记录")?.parentId,root.id);
    });
    await t.test("automatically appends to a related existing note while retaining its entire original",async () => {
      const before=note(first.result.noteId);
      nextPlan={action:"append",notebookId:before.notebookId,noteId:before.id,folderPath:[],title:before.title,content:"## 补充\n\n新增索引说明"};
      const result=await done((await submit({requestId:"automatic-append",content:"PostgreSQL 索引补充说明"})).id);
      assert.equal(result.status,"completed",JSON.stringify(result));
      assert.equal(result.result.noteId,before.id);
      assert.ok(note(before.id).content.startsWith(before.content));
      assert.match(note(before.id).content,/新增索引说明/);
      assert.ok(note(before.id).version>before.version);
      assert.ok(getDb().prepare("SELECT 1 FROM note_versions WHERE noteId=?").get(before.id));
    });
    await t.test("duplicate submission and duplicate worker drains never append twice",async () => {
      const before=note(first.result.noteId);
      const input={requestId:"once",content:"唯一一次追加",noteId:before.id};
      nextPlan={action:"append",notebookId:before.notebookId,noteId:before.id,folderPath:[],title:before.title,content:"唯一一次追加"};
      const job=await submit(input);
      await Promise.all([drainCaptures(),drainCaptures(),drainCaptures()]);
      const calls=modelCalls;
      const duplicate=await call("/api/captures","POST",input);
      assert.equal(duplicate.status,200);
      assert.equal((await duplicate.json() as any).duplicate,true);
      await drainCaptures();
      assert.equal(modelCalls,calls);
      assert.equal(note(before.id).content.split("唯一一次追加").length-1,1);
      assert.equal((await call("/api/captures","POST",{...input,content:"changed"})).status,409);
    });
    for (const format of ["plaintext","html","tiptap-json"]) await t.test(`appends to ${format} without changing existing structure`,async () => {
      const original=format==="tiptap-json"?JSON.stringify({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"原始正文"}]}]}):format==="html"?"<p>原始正文</p>":"原始正文";
      const created=await notesRouter.request("/",{method:"POST",headers:{"Content-Type":"application/json","X-User-Id":owner},body:JSON.stringify({notebookId:root.resourceId,title:format,content:original,contentFormat:format})});
      assert.equal(created.status,201,await created.clone().text());
      const target=await created.json() as any;
      const before=note(target.id);
      nextPlan={action:"append",notebookId:root.resourceId,noteId:target.id,folderPath:[],title:format,content:"## 补充\n\n新内容 <script>bad</script>"};
      const result=await done((await submit({requestId:`append-${format}`,content:"补充新内容",noteId:target.id})).id);
      assert.equal(result.status,"completed",JSON.stringify(result));
      assert.equal(note(target.id).contentFormat,format);
      if(format==="tiptap-json") assert.deepEqual(JSON.parse(note(target.id).content).content[0],JSON.parse(before.content).content[0]);
      else assert.ok(note(target.id).content.startsWith(before.content));
      if(format==="html") assert.ok(!note(target.id).content.includes("<script>"));
    });
    await t.test("appends to an empty rich-text note and an existing root-level note",async () => {
      const empty=await notesRouter.request("/",{method:"POST",headers:{"Content-Type":"application/json","X-User-Id":owner},body:JSON.stringify({notebookId:root.resourceId,title:"空白富文本"})});
      assert.equal(empty.status,201);const blank=await empty.json() as any;
      nextPlan={action:"append",notebookId:root.resourceId,noteId:blank.id,folderPath:[],title:blank.title,content:"# 第一次追加\n\n空白笔记也可保存"};
      let result=await done((await submit({requestId:"empty-richtext",content:"空白笔记也可保存",noteId:blank.id})).id);
      assert.equal(result.status,"completed",JSON.stringify(result));assert.match(note(blank.id).content,/空白笔记也可保存/);
      const rootDoc=createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:null,nodeType:"markdown",title:"根级笔记"});
      const before=note(rootDoc.resourceId);
      nextPlan={action:"append",notebookId:before.notebookId,noteId:before.id,folderPath:[],title:before.title,content:"根级追加内容"};
      result=await done((await submit({requestId:"root-note",content:"根级追加内容",noteId:before.id})).id);
      assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(result.result.path,"根级笔记");
      assert.ok(projectMarkdownNoteForUser(getDb(),note(before.id)).content.startsWith(before.content));assert.match(note(before.id).content,/根级追加内容/);
    });
    await t.test("organize=false stores the exact raw input without model edits",async () => {
      nextPlan=plan(root.resourceId,[],"原文","模型不应覆盖的文字");
      const original="  原文\r\n\thttps://example.test/a?b=1&c=2  ";
      const result=await done((await submit({requestId:"verbatim",content:original,organize:false})).id);
      assert.equal(result.status,"completed",JSON.stringify(result));
      assert.equal(result.originalContent,original);
      assert.equal(result.result.content,original);
    });
    await t.test("invalid AI output and provider failure retain originals, and failed jobs can be retried",async () => {
      for(const broken of ["not json","http-error"]) {
        nextPlan=broken;
        const job=await submit({requestId:broken,content:"失败也不能丢失的原文"});
        let result=await done(job.id);
        assert.equal(result.status,"failed"); assert.equal(result.originalContent,"失败也不能丢失的原文");
        nextPlan=plan(root.resourceId,[],"重试成功");
        assert.equal((await call(`/api/captures/${job.id}/retry`,"POST",{})).status,202);
        result=await done(job.id); assert.equal(result.status,"completed",JSON.stringify(result));
      }
    });
    await t.test("temporary provider failures retry before any note write and create only once",async () => {
      temporaryFailures=2;
      nextPlan=plan(root.resourceId,[],"渠道恢复后只保存一次");
      const before=modelCalls;
      const result=await done((await submit({requestId:"provider-recovery",content:"网络恢复测试"})).id);
      assert.equal(result.status,"completed");assert.equal(modelCalls-before,3);
      assert.equal((getDb().prepare("SELECT COUNT(*) n FROM notes WHERE title='渠道恢复后只保存一次'").get() as any).n,1);
    });
    await t.test("restricted token sees only its granted folders and notes",async () => {
      const restricted=issue("restricted-pat",owner,scopes,"restricted");
      getDb().prepare("INSERT INTO api_token_resources(id,tokenId,resourceType,resourceId,permission,includeDescendants) VALUES('capture-grant','restricted-pat','notebook',?,'write',1)").run(root.resourceId);
      const denied=createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:null,nodeType:"folder",title:"不可见目录"});
      nextPlan=plan(root.resourceId,["受限子目录"],"授权笔记");
      const result=await done((await submit({requestId:"restricted",content:"授权内容"},restricted)).id,restricted);
      assert.equal(result.status,"completed",JSON.stringify(result));
      assert.ok(!prompts.at(-1).folders.some((n:any)=>n.id===denied.resourceId));
      assert.equal((await call("/api/captures","POST",{requestId:"denied-folder",content:"xx",notebookId:denied.resourceId},restricted)).status,403);
      assert.equal((await call(`/api/captures/${first.id}`,"GET",undefined,restricted)).status,404);
      nextPlan=plan(denied.resourceId,[],"恶意越权");
      const invalid=await done((await submit({requestId:"invented-folder",content:"不应写入越权目录"},restricted)).id,restricted);
      assert.equal(invalid.status,"failed");
      assert.equal(getDb().prepare("SELECT 1 FROM notes WHERE title='恶意越权'").get(),undefined);
      nextPlan=plan(null,["非法根目录"]);
      const noRoot=await done((await submit({requestId:"restricted-root",content:"xx"},restricted)).id,restricted);
      assert.equal(noRoot.status,"failed");
      assert.ok(!listKnowledgeTree({userId:owner,workspaceId:null}).some(n=>n.title==="非法根目录"));
    });
    await t.test("missing scopes, foreign notes, empty input and another account's jobs are rejected",async () => {
      const readOnly=issue("read-only",owner,["notes:read","notebooks:read"]);
      assert.equal((await call("/api/captures","POST",{requestId:"readonly",content:"xx"},readOnly)).status,403);
      assert.equal((await call("/api/captures","POST",{requestId:"foreign",content:"xx",noteId:first.result.noteId},otherRaw)).status,403);
      assert.equal((await call(`/api/captures/${first.id}`,"GET",undefined,otherRaw)).status,404);
      assert.equal((await call("/api/captures","POST",{requestId:"empty",content:"  "})).status,400);
      assert.equal((await call("/api/captures","POST",{requestId:"oversize",content:"x".repeat(32001)})).status,400);
      assert.equal((await app.request("/api/captures",{method:"POST"})).status,401);
    });
    await t.test("password-protected folders and their notes never enter model context",async () => {
      const secret=createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:null,nodeType:"folder",title:"受保护资料"});
      const secretNote=createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:secret.id,nodeType:"markdown",title:"隐藏笔记标题"});
      getDb().prepare("INSERT INTO notebook_passwords(notebookId,passwordHash,passwordVersion) VALUES(?,'synthetic-hash',1)").run(secret.resourceId);
      assert.equal((await call("/api/captures","POST",{requestId:"protected",content:"xx",noteId:secretNote.resourceId})).status,403);
      nextPlan=plan(root.resourceId,[],"不读取受保护内容");
      const result=await done((await submit({requestId:"protected-context",content:"普通内容"})).id);
      assert.equal(result.status,"completed");
      assert.ok(!JSON.stringify(prompts.at(-1)).includes("隐藏笔记标题"));
      assert.ok(!JSON.stringify(prompts.at(-1)).includes("受保护资料"));
    });
    await t.test("specified folder cannot be escaped, and folder creation requires its own scope",async () => {
      nextPlan=plan(null,["范围外根目录"]);
      let result=await done((await submit({requestId:"escape-selected",content:"xx",notebookId:root.resourceId})).id);
      assert.equal(result.status,"completed");
      const anchored=listKnowledgeTree({userId:owner,workspaceId:null}).find(n=>n.title==="范围外根目录");
      assert.equal(anchored?.parentId,root.id);
      assert.equal(result.result.notebookId,anchored?.resourceId);
      const outside=createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:null,nodeType:"folder",title:"真正的范围外目录"});
      const before=getDb().prepare("SELECT count(*) n FROM notes").get() as any;
      nextPlan=plan(outside.resourceId,[],"不能绕过指定目录");
      result=await done((await submit({requestId:"escape-selected-id",content:"xx",notebookId:root.resourceId})).id);
      assert.equal(result.status,"failed");
      assert.equal((getDb().prepare("SELECT count(*) n FROM notes").get() as any).n,before.n);
      const noFolderWrite=issue("no-folder-write",owner,["notes:read","notes:write","notebooks:read"]);
      nextPlan=plan(root.resourceId,["不应创建的子目录"]);
      result=await done((await submit({requestId:"no-folder-scope",content:"xx"},noFolderWrite)).id,noFolderWrite);
      assert.equal(result.status,"failed");
      assert.ok(!listKnowledgeTree({userId:owner,workspaceId:null}).some(n=>n.title==="不应创建的子目录"));
      nextPlan=plan(root.resourceId,[],"有笔记写权限即可创建笔记");
      result=await done((await submit({requestId:"note-write-scope",content:"xx"},noFolderWrite)).id,noFolderWrite);
      assert.equal(result.status,"completed");
    });
    await t.test("an edit during model processing is preserved when the capture is appended",async () => {
      const target=note(first.result.noteId);
      nextPlan={action:"append",notebookId:target.notebookId,noteId:target.id,folderPath:[],title:target.title,content:"模型处理后的追加"};
      const job=await submit({requestId:"concurrent-edit",content:"xx",noteId:target.id});
      duringModel=()=>getDb().prepare("UPDATE notes SET content=content || '\n\n另一端的新增正文',version=version+1 WHERE id=?").run(target.id);
      const result=await done(job.id);
      assert.equal(result.status,"completed");
      assert.match(note(target.id).content,/另一端的新增正文/);
      assert.match(note(target.id).content,/模型处理后的追加/);
    });
    await t.test("revocation while the model runs prevents all note writes",async () => {
      const revoked=issue("revoke-during-model");
      nextPlan=plan(root.resourceId,[],"不应保存的撤销任务");
      const job=await submit({requestId:"revoke-during-model",content:"撤销后不保存"},revoked);
      duringModel=()=>getDb().prepare("UPDATE api_tokens SET revokedAt=datetime('now') WHERE id='revoke-during-model'").run();
      await drainCaptures();
      const row=getDb().prepare("SELECT * FROM capture_jobs WHERE id=?").get(job.id) as any;
      assert.equal(row.status,"failed"); assert.equal(row.errorCode,"CAPTURE_TOKEN_INVALID");
      assert.equal(getDb().prepare("SELECT 1 FROM notes WHERE title='不应保存的撤销任务'").get(),undefined);
    });
    await t.test("receipt failure rolls back the note mutation and retry appends exactly once",async () => {
      const before=note(first.result.noteId);
      nextPlan={action:"append",notebookId:before.notebookId,noteId:before.id,folderPath:[],title:before.title,content:"事务补充内容"};
      const job=await submit({requestId:"rollback-receipt",content:"事务补充内容",noteId:before.id});
      getDb().exec("CREATE TRIGGER reject_capture_receipt BEFORE UPDATE OF status ON capture_jobs WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
      const failed=await done(job.id);
      assert.equal(failed.status,"failed");
      assert.equal(note(before.id).content,before.content);
      getDb().exec("DROP TRIGGER reject_capture_receipt");
      await call(`/api/captures/${job.id}/retry`,"POST",{});
      assert.equal((await done(job.id)).status,"completed");
      assert.equal(note(before.id).content.split("事务补充内容").length-1,1);
    });
    await t.test("worker startup recovers interrupted jobs without duplicating committed writes",async () => {
      nextPlan=plan(root.resourceId,[],"重启恢复");
      const job=await submit({requestId:"restart",content:"重启时保留"});
      getDb().prepare("UPDATE capture_jobs SET status='processing' WHERE id=?").run(job.id);
      const timer=startCaptureWorker(); clearInterval(timer);
      // Startup runs asynchronously; wait for the in-flight model request to complete.
      for(let i=0;i<100;i++) {
        if((getDb().prepare("SELECT status FROM capture_jobs WHERE id=?").get(job.id) as any).status==="completed") break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal((await done(job.id)).status,"completed");
      const count=(getDb().prepare("SELECT COUNT(*) n FROM notes WHERE title='重启恢复'").get() as any).n;
      await drainCaptures(); assert.equal(count,1);
    });
    await t.test("NAS gateway accepts same-account PAT and rejects missing or mismatched NAS identities",async () => {
      nextPlan=plan(root.resourceId,[],"网关提交");
      const request=(uid:string|undefined,token=raw)=>new Request(`http://nas.test${FNOS_PREFIX}/api/captures`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`,...(uid?{"X-Trim-Userid":uid,"X-Trim-Username":"capture","X-Trim-Isadmin":"false"}:{})},body:JSON.stringify({requestId:"gateway",content:"网关提交"})});
      assert.equal((await dispatchFnosGateway(request(undefined),app)).status,401);
      assert.equal((await dispatchFnosGateway(request("2002"),app)).status,401);
      const usageBefore=(getDb().prepare("SELECT SUM(count) n FROM api_token_usage WHERE tokenId='capture-pat'").get() as any).n || 0;
      const result=await dispatchFnosGateway(request("2001"),app);
      assert.equal(result.status,202,await result.clone().text());
      const usageAfter=(getDb().prepare("SELECT SUM(count) n FROM api_token_usage WHERE tokenId='capture-pat'").get() as any).n || 0;
      assert.equal(usageAfter-usageBefore,1,"gateway identity validation must not count the same API request twice");
      assert.equal((await done((await result.json() as any).id)).status,"completed");
      getDb().prepare("UPDATE api_tokens SET revokedAt=datetime('now') WHERE id='capture-pat'").run();
      assert.equal((await dispatchFnosGateway(request("2001"),app)).status,401);
    });
    assert.equal(captureInput.safeParse({requestId:"x",content:"a",unknown:true}).success,false);
  } finally {
    await new Promise<void>(resolve=>model.close(()=>resolve()));
    closeDb(); fs.rmSync(directory,{recursive:true,force:true});
    setSyncBroadcaster(null);
  }
});
