/** Opt-in acceptance against configured models, using synthetic data in a separate DB.
 * Set DB_PATH to a fresh temporary file and NOWEN_MODEL_TEST_SOURCE_DB to a read-only
 * mounted deployment DB. Never run the application worker against the source DB.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
let closeFixtureDb = () => {};
let evaluationStage = "environment";

async function main() {
  const sourcePath=process.env.NOWEN_MODEL_TEST_SOURCE_DB;
  if(!sourcePath || !process.env.DB_PATH || !path.resolve(process.env.DB_PATH).startsWith("/tmp/")
    || path.resolve(sourcePath)===path.resolve(process.env.DB_PATH))throw new Error("A separate temporary DB_PATH and read-only source are required");
  if(fs.existsSync(process.env.DB_PATH))throw new Error("The fixture database must be fresh");
  evaluationStage="loading-services";
  const {getDb,closeDb}=await import("../src/db/schema");
  const {getFnosAccount}=await import("../src/lib/fnos-identity");
  const {getUserAISettings,setUserAISettings}=await import("../src/services/user-ai-settings");
  const {clipboardSettingsSchema,saveClipboardSettings,copyClipboardToken,authenticateClipboard,clipboardSubmissionSchema,submitClipboard}=await import("../src/services/clipboard-integration");
  const {getCapture,presentCapture,drainCaptures}=await import("../src/services/captures");
  const {editClipboardLog}=await import("../src/services/clipboard-log-actions");
  const {createKnowledgeChild}=await import("../src/services/knowledgeTree");
  const {default:notesRouter}=await import("../src/routes/notes");
  const {default:searchRouter}=await import("../src/routes/search");
  const {resolveEmbeddingConfig}=await import("../src/services/embedding-config");
  const {callEmbeddings}=await import("../src/services/embedding-client");
  const {initVecStore,upsertVectors}=await import("../src/services/vec-store");
  closeFixtureDb=closeDb;
  const source=new Database(sourcePath,{readonly:true,fileMustExist:true}),db=getDb();
  const configured=source.prepare("SELECT userId,settings FROM clipboard_integrations WHERE json_extract(settings,'$.enabled')=1 LIMIT 1").get() as {userId:string;settings:string}|undefined;
  if(!configured)throw new Error("No configured clipboard account");
  const owner=getFnosAccount({uid:'synthetic-model-acceptance',username:'synthetic-model-acceptance',isAdmin:false}).id;
  evaluationStage="loading-ai-settings";
  setUserAISettings(owner,source.prepare("SELECT key,value FROM user_ai_settings WHERE userId=? AND key LIKE 'ai_%'").all(configured.userId) as any);
  const settings=clipboardSettingsSchema.parse({...JSON.parse(configured.settings),enabled:true,notebookId:""});
  saveClipboardSettings(owner,settings);source.close();
  const actor=authenticateClipboard(copyClipboardToken(owner).token);
  if(process.env.NOWEN_MODEL_TEST_PHASE==='embedding-probe') {
    evaluationStage='embedding-probe';
    const resolution=resolveEmbeddingConfig(owner),cfg=resolution.config;
    if(!cfg)throw new Error('No effective embedding configuration');
    console.log('MODEL_PROBE_CONFIG',JSON.stringify({model:cfg.model,source:resolution.source,host:new URL(cfg.url).host}));
    const vectors=await callEmbeddings(cfg,Array.from({length:8},(_,index)=>'合成检索验证文本 '+index));
    console.log('MODEL_PROBE_RESULT',JSON.stringify({count:vectors.length,dim:vectors[0]?.length}));closeDb();return;
  }
  evaluationStage="creating-fixtures";
  const technical=createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:null,nodeType:'folder',title:'技术'});
  createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:technical.id,nodeType:'folder',title:'AI'});
  const life=createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:null,nodeType:'folder',title:'生活'});
  const accountFolder=createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:life.id,nodeType:'folder',title:'账号密码'});
  const response=await notesRouter.request('/',{method:'POST',headers:{'X-User-Id':owner,'Content-Type':'application/json'},body:JSON.stringify({notebookId:accountFolder.resourceId,title:'账号密码本',content:'合成模型验证条目。',contentFormat:'markdown'})});
  if(!response.ok)throw new Error('Cannot create fixture book');
  const book=await response.json() as any;
  const originalFetch=globalThis.fetch;let lastPlan:any=null;
  globalThis.fetch=(async(...args:Parameters<typeof fetch>)=>{
    const response=await originalFetch(...args);
    try {
      const request=JSON.parse(String(args[1]?.body||'{}'));
      if(request.messages && !String(request.messages[0]?.content).includes('你是剪贴板内容过滤器')) {
        const payload=await response.clone().json() as any;
        const text=payload.choices?.[0]?.message?.content;
        const value=JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
        lastPlan={action:value.action,folderPath:value.folderPath,notebookId:value.notebookId,noteId:value.noteId,keys:Object.keys(value)};
      }
    }catch{/* Diagnostics never change the real request result. */}
    return response;
  }) as typeof fetch;
  const cases:[string,boolean,string][]=[
    ['account-without-service',false,'账号：admin\n密码：Synthetic-42!'],
    ['password-only',false,'密码：Synthetic-42!'],
    ['email-is-not-service',false,'账号：demo@example.test\n密码：Synthetic-42!'],
    ['bare-token',false,'sk-synthetic-no-service-0123456789abcdef'],
    ['one-time-code',false,'827193'],
    ['bare-url',false,'https://docs.example.test/guide'],
    ['bare-file',false,'/tmp/one-off-output.txt'],
    ['assistant-request',false,'你帮我看一下这个界面，改好以后再检查一下。'],
    ['indirect-assistant-request',false,'我想让你把这个按钮挪到右边，然后提交代码，最后告诉我结果。'],
    ['button-text',false,'保存设置'],
    ['raw-log',false,'2026-11-16 10:00:00 INFO starting\n2026-11-16 10:00:01 ERROR connection refused'],
    ['one-off-command',false,'docker restart temporary-demo-container'],
    ['incomplete-code',false,'if (enabled) {'],
    ['reusable-sql',true,'查询已启用用户的用户名和邮箱：\nSELECT username, email FROM demo_users WHERE enabled = 1 ORDER BY username;'],
    ['reusable-config',true,'Nginx 反向代理配置：\nserver {\n  listen 8080;\n  location / { proxy_pass http://127.0.0.1:3001; }\n}'],
    ['diagnostic-conclusion',true,'连接超时排障结论：原因是连接池耗尽，并发请求超过连接池上限。解决方法：将并发数限制为20，设置30秒连接超时；修复后连续100次请求均成功。'],
    ['work-schedule',true,'演示项目“任务平台”工作排期：周一完成接口设计；周三完成数据库迁移；周五完成联调，并输出接口测试结果。'],
    ['complete-test-results',true,'任务平台接口测试结果：\n|接口|结果|耗时|\n|GET /api/users|通过|120ms|\n|POST /api/tasks|通过|180ms|\n结论：列表查询和任务创建均通过，已满足本轮联调要求。'],
    ['service-credentials-a',true,'服务：演示平台\n地址：https://demo.example.test\n账号：demo-admin\n密码：Synthetic-42!'],
    ['service-credentials-b',true,'服务：演示音乐服务器\n地址：https://music.example.test\n账号：demo-music\n密码：Synthetic-43!'],
    ['reusable-script',true,'数据库备份脚本：每天运行，将备份保存到指定目录并保留最近7天。\n```sh\n#!/bin/sh\nset -eu\nmkdir -p /srv/backups\npg_dump demo_db > /srv/backups/demo-$(date +%F).sql\nfind /srv/backups -name "demo-*.sql" -mtime +7 -delete\n```'],
  ];
  const results:any[]=[];const jobs=new Map<string,any>();
  const record=(value:any)=>{results.push(value);console.log('MODEL_ACCEPTANCE '+JSON.stringify(value));};
  const phase=process.env.NOWEN_MODEL_TEST_PHASE || 'all';
  for(const [label,expected,content] of phase==='search'?cases.filter(row=>row[0].startsWith('service-credentials-')):cases) {
    evaluationStage=label;
    lastPlan=null;
    const submitted=submitClipboard(actor,clipboardSubmissionSchema.parse({requestId:label,content}));
    let result:any=submitted;
    if('id' in submitted) {await drainCaptures();result=presentCapture(getCapture(actor,submitted.id));jobs.set(label,result);}
    const collected=result.status==='completed';
    record({case:label,expected:expected?'collect':'skip',status:result.status,code:result.reasonCode||result.errorCode||null,error:result.errorMessage||undefined,passed:collected===expected&&result.status!=='failed',path:result.result?.path,diagnostic:collected!==expected?lastPlan:undefined});
  }
  const a=jobs.get('service-credentials-a'),b=jobs.get('service-credentials-b');
  const bookText=(db.prepare('SELECT content FROM notes WHERE id=?').get(book.id) as any).content;
  record({case:'credential-context-and-single-book',passed:a?.result?.noteId===book.id&&b?.result?.noteId===book.id&&bookText.includes('demo.example.test')&&bookText.includes('Synthetic-42!')&&bookText.includes('Synthetic-43!')});
  const sensitive=db.prepare("SELECT originalInput,metadata FROM clipboard_submissions WHERE requestId='account-without-service'").get() as any;
  if(sensitive)record({case:'sensitive-rejection-retains-no-raw-value',passed:sensitive.originalInput===null&&!sensitive.metadata.includes('Synthetic-42!')});
  const sql=jobs.get('reusable-sql');
  if(sql?.status==='completed') {
    const previous=db.prepare('SELECT content,isTrashed FROM notes WHERE id=?').get(sql.result.noteId) as any;
    const queued=await editClipboardLog(owner,'reusable-sql',{jobId:sql.id,requestId:'model-regeneration',content:'查询已启用的演示用户：\nSELECT username FROM demo_users WHERE enabled = 1 ORDER BY username;'});
    const pending=db.prepare('SELECT content,isTrashed FROM notes WHERE id=?').get(sql.result.noteId) as any;
    record({case:'regeneration-keeps-original-while-pending',passed:JSON.stringify(previous)===JSON.stringify(pending)});
    await drainCaptures();const replacement=presentCapture(getCapture({userId:owner,tokenId:null},queued.id));
    record({case:'regeneration-with-configured-model',status:replacement.status,code:replacement.errorCode,passed:replacement.status==='completed'&&!!getCapture({userId:owner,tokenId:null},sql.id).undoneAt});
  }
  if(phase==='search')for(const [title,content] of [['出行清单','出门携带雨伞和雨衣，确认天气和交通。'],['数据库查询','SELECT username FROM demo_users WHERE enabled = 1;'],['项目排期','演示任务平台周一设计、周三迁移、周五联调。']]) {
    const saved=await notesRouter.request('/',{method:'POST',headers:{'X-User-Id':owner,'Content-Type':'application/json'},body:JSON.stringify({notebookId:technical.resourceId,title,content,contentFormat:'markdown'})});
    if(!saved.ok)throw new Error('Cannot create retrieval distractor');
  }
  const cfg=phase==='capture'?null:resolveEmbeddingConfig(owner).config;
  evaluationStage="embedding-and-retrieval";
  if(cfg) {
    const rows=db.prepare('SELECT id,title,contentText FROM notes WHERE userId=? AND isTrashed=0').all(owner) as any[];
    evaluationStage="embedding-request";
    let vectors:number[][]=[];
    for(let attempt=0;attempt<3;attempt++) {
      try {vectors=await callEmbeddings(cfg,rows.map(row=>row.title+'\n'+row.contentText));break;}
      catch(error) {if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}
    }
    evaluationStage="embedding-index";
    if(vectors.length!==rows.length||vectors.some(vector=>!Array.isArray(vector)||!vector.length||vector.some(value=>!Number.isFinite(value))))throw new Error('Invalid embedding shape');
    initVecStore();
    const insert=db.prepare('INSERT INTO note_embeddings(noteId,userId,chunkIndex,chunkText,vectorJson,model,dim) VALUES(?,?,0,?,?,?,?)');
    for(const [index,row] of rows.entries()) {
      const saved=insert.run(row.id,owner,row.contentText,JSON.stringify(vectors[index]),cfg.model,vectors[index].length);
      upsertVectors([{rowid:Number(saved.lastInsertRowid),vector:vectors[index]}]);
    }
    for(const query of ['music.example.test','demo-music','帮我找演示音乐服务器的密码']) {
      evaluationStage="embedding-query";
      let found:any[]=[],vectorUsed=false,attempts=0;
      for(;attempts<3;attempts++) {
        const response=await searchRouter.request('/?'+new URLSearchParams({q:query,semantic:'1'}),{headers:{'X-User-Id':owner}});
        found=await response.json() as any[];vectorUsed=found.some(row=>typeof row.semanticDistance==='number');
        if(vectorUsed)break;
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      record({case:query.includes('.')?'domain-retrieval':query==='demo-music'?'account-retrieval':'natural-language-retrieval',passed:found[0]?.id===book.id&&vectorUsed,vectorUsed,attempts:attempts+1});
    }
  }else if(phase!=='capture')record({case:'configured-embedding-model',passed:false});
  const model=getUserAISettings(owner),summary={phase,models:{chat:model.ai_model,embedding:model.ai_embedding_model},passed:results.filter(row=>row.passed).length,total:results.length,results};
  globalThis.fetch=originalFetch;
  if(process.env.NOWEN_MODEL_TEST_REPORT)fs.writeFileSync(process.env.NOWEN_MODEL_TEST_REPORT,JSON.stringify(summary,null,2));
  console.log('MODEL_ACCEPTANCE_SUMMARY '+JSON.stringify({models:summary.models,passed:summary.passed,total:summary.total}));
  closeDb();if(summary.passed!==summary.total)process.exitCode=1;
}
void main().catch(error=>{console.error('MODEL_ACCEPTANCE_FAILED',{stage:evaluationStage,kind:error?.name||'Error',code:error?.code||error?.cause?.code||null,httpStatus:/^HTTP (\d{3})/.exec(String(error?.message))?.[1],shapeIssue:/返回向量数量|响应缺少|Invalid embedding shape/.test(String(error?.message)),location:String(error?.stack||'').split('\n').slice(1,3)});closeFixtureDb();process.exitCode=1;});
