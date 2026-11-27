import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {Hono} from 'hono';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nowen-log-actions-'));
process.env.DB_PATH=path.join(directory,'test.db');process.env.NODE_ENV='test';process.env.JWT_SECRET='log-actions-isolated-test-secret';
test('clipboard log actions preserve ownership, receipts and later edits (DCC-001 DCC-002 DCC-003 DCC-004 DCC-006 DCC-007)',async t=>{
 const {getDb,closeDb}=await import('../src/db/schema');
 const {getFnosAccount}=await import('../src/lib/fnos-identity');
 const {clipboardPublicRouter,clipboardSettingsRouter}=await import('../src/routes/clipboard');
 const {clipboardSettingsSchema,saveClipboardSettings,copyClipboardToken,listClipboardLogs}=await import('../src/services/clipboard-integration');
 const {drainCaptures,getCapture,presentCapture}=await import('../src/services/captures');
 const {deleteClipboardLog,forceClipboardLog,undoClipboardLog,getClipboardLogContent,editClipboardLog}=await import('../src/services/clipboard-log-actions');
 const {setUserAISettings}=await import('../src/services/user-ai-settings');
 const {createKnowledgeChild}=await import('../src/services/knowledgeTree');
 const {projectMarkdownForUser}=await import('../src/lib/markdownUserContent');
 const notes=(await import('../src/routes/notes')).default;
 const db=getDb(),owner=getFnosAccount({uid:'log-owner',username:'log-owner',isAdmin:false}).id,other=getFnosAccount({uid:'log-other',username:'log-other',isAdmin:false}).id;
 let plan:any={action:'skip',reason:'unclear_purpose'},filterCalls=0,duringPlan:(()=>void)|null=null;
 const model=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());const filter=body.messages[0]?.content?.includes('你是剪贴板内容过滤器');if(filter)filterCalls++;else {duringPlan?.();duringPlan=null;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(filter?{collect:!body.messages[0].content.includes('全部拒绝')}:plan)}}]}));});
 await new Promise<void>(resolve=>model.listen(0,'127.0.0.1',resolve));
 setUserAISettings(owner,[{key:'ai_api_url',value:`http://127.0.0.1:${(model.address() as any).port}/v1`},{key:'ai_api_key',value:'synthetic'},{key:'ai_model',value:'fixture'}]);
 const actor={userId:owner,tokenId:null},app=new Hono();app.route('/api/clipboard',clipboardPublicRouter);app.use('/api/clipboard-settings/*',async(c,next)=>{if(c.req.header('Authorization')!=='Bearer login')return c.json({},401);c.req.raw.headers.set('X-User-Id',owner);await next();});app.route('/api/clipboard-settings',clipboardSettingsRouter);
 const settings=(extra:any={})=>saveClipboardSettings(owner,clipboardSettingsSchema.parse({enabled:true,...extra}));settings();let token=copyClipboardToken(owner).token;
 const submit=async(requestId:string,content='周五检查备份服务',extra:any={})=>{const r=await app.request('/api/clipboard/captures',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId,content,...extra})});assert.ok(r.ok,await r.clone().text());return await r.json() as any;};
 const done=async(id:string)=>{await drainCaptures();return presentCapture(getCapture(actor,id));};
 const note=(id:string)=>db.prepare('SELECT * FROM notes WHERE id=?').get(id) as any;
 const put=async(id:string,body:any)=>{const r=await notes.request('/'+id,{method:'PUT',headers:{'X-User-Id':owner,'Content-Type':'application/json'},body:JSON.stringify({...body,version:note(id).version})});assert.equal(r.status,200,await r.clone().text());};
 const folder=createKnowledgeChild({actorUserId:owner,workspaceId:null,parentId:null,nodeType:'folder',title:'工作'}).resourceId;
 const createPlan=()=>({action:'create',notebookId:folder,noteId:null,folderPath:[],title:'备份检查',content:'周五检查备份服务'});
 const create=async(id:string)=>{settings();plan=createPlan();const j=await done((await submit(id)).id);assert.equal(j.status,'completed',JSON.stringify(j));return j;};
 try {
  await t.test('force retains full filtered text, bypasses fixed and AI rules, and double-click queues once',async()=>{
   settings({excludeKeywords:['周五'],aiFilterEnabled:true,aiFilterPrompt:'全部拒绝'});const original='周五'+'完整原文内容'.repeat(100);assert.equal((await submit('force-long',original)).status,'filtered');
   plan=createPlan();const a=forceClipboardLog(owner,'force-long'),b=forceClipboardLog(owner,'force-long');assert.equal(a.id,b.id);const j=await done(a.id);assert.equal(j.status,'completed',JSON.stringify(j));assert.equal(j.originalContent,original);assert.equal(filterCalls,0);assert.equal(listClipboardLogs(owner).items.find(x=>x.requestId==='force-long')?.status,'completed');assert.throws(()=>forceClipboardLog(owner,'force-long'),/不会重复/);
   const replay=await submit('force-long',original);assert.equal(replay.status,'filtered');assert.equal(replay.duplicate,true);
  });
  await t.test('force overrides AI purpose skip without inventing content',async()=>{
   settings({minChars:10});await submit('force-skip','Donate');plan={action:'skip',reason:'unclear_purpose'};const j=await done(forceClipboardLog(owner,'force-skip').id);assert.equal(j.status,'completed',JSON.stringify(j));assert.equal(j.result!.content,'Donate');assert.match(j.result!.path,/收集箱/);
  });
  await t.test('old AI-filtered jobs force after token rotation; preview-only records cannot',async()=>{
   settings({aiFilterEnabled:true,aiFilterPrompt:'全部拒绝'});const j=await done((await submit('old-ai')).id);assert.equal(j.status,'filtered');token=copyClipboardToken(owner,true).token;plan=createPlan();assert.equal((await done(forceClipboardLog(owner,'old-ai').id)).status,'completed');
   settings({minChars:100});await submit('old-preview');db.prepare('UPDATE clipboard_submissions SET originalInput=NULL WHERE userId=? AND requestId=?').run(owner,'old-preview');assert.equal(listClipboardLogs(owner).items.find(x=>x.requestId==='old-preview')?.canForce,false);assert.throws(()=>forceClipboardLog(owner,'old-preview'),/旧记录/);
  });
  await t.test('filtered records load the actual source and save edits without running the AI filter again',async()=>{
   const original='排障原文与结论'.repeat(40),revised='修订后的排障记录';
   settings({aiFilterEnabled:true,aiFilterPrompt:'全部拒绝'});
   const filtered=await done((await submit('edit-filtered-ai',original)).id);
   assert.equal(filtered.reasonCode,'AI_FILTERED');
   assert.deepEqual(getClipboardLogContent(owner,'edit-filtered-ai'),{jobId:filtered.id,content:original});
   assert.equal(listClipboardLogs(owner,0,'filtered').items.find(x=>x.requestId==='edit-filtered-ai')?.canEdit,true);
   const before=filterCalls;
   const request={jobId:filtered.id,requestId:'edit-ai-once',content:revised};
   const saved=await editClipboardLog(owner,'edit-filtered-ai',request);
   assert.equal((await editClipboardLog(owner,'edit-filtered-ai',request)).id,saved.id);
   assert.notEqual(saved.id,filtered.id);
   assert.equal(getCapture(actor,saved.id).replacesJobId,null);
   plan=createPlan();
   assert.equal((await done(saved.id)).result?.content,revised);
   assert.equal(filterCalls,before);
  });
  await t.test('rule-filtered text can be edited without a job and discarded content starts blank',async()=>{
   settings({excludeKeywords:['备份'],aiFilterEnabled:true,aiFilterPrompt:'全部拒绝'});
   const original='完整的备份参考'.repeat(45);
   assert.equal((await submit('edit-filtered-rule',original)).reasonCode,'KEYWORD_EXCLUDED');
   assert.deepEqual(getClipboardLogContent(owner,'edit-filtered-rule'),{jobId:null,content:original});
   plan=createPlan();
   const ruleJob=await editClipboardLog(owner,'edit-filtered-rule',{jobId:null,requestId:'rule-edit',content:'备份演练参考与恢复步骤'});
   assert.equal((await done(ruleJob.id)).result?.content,'备份演练参考与恢复步骤');
   const fragment='账号：admin\n密码：Synthetic-42!';
   assert.equal((await submit('edit-missing',fragment)).reasonCode,'CAPTURE_CONTEXT_REQUIRED');
   const detail=await app.request('/api/clipboard-settings/logs/edit-missing',{headers:{Authorization:'Bearer login'}});
   assert.equal(detail.status,200);assert.deepEqual(await detail.json(),{jobId:null,content:''});
   assert.throws(()=>getClipboardLogContent(other,'edit-missing'),/不存在/);
   await assert.rejects(editClipboardLog(other,'edit-missing',{jobId:null,requestId:'cross-account',content:'补充资料'}),/不存在/);
   assert.throws(()=>forceClipboardLog(owner,'edit-missing'),/旧记录/);
   const input={jobId:null,requestId:'manual-context',content:fragment};
   await assert.rejects(editClipboardLog(owner,'edit-missing',input),/所属的服务/);
   const payload={...input,content:'服务：模拟备份系统\n'+fragment};
   const response=await app.request('/api/clipboard-settings/logs/edit-missing/edit',{method:'POST',headers:{Authorization:'Bearer login','Content-Type':'application/json'},body:JSON.stringify(payload)});
   assert.equal(response.status,200);
   const queued=await response.json() as {id:string};
   assert.equal((await editClipboardLog(owner,'edit-missing',payload)).id,queued.id);
   let modelCalled=false;duringPlan=()=>{modelCalled=true;};
   const completed=await done(queued.id);
   duringPlan=null;
   assert.equal(modelCalled,false);
   assert.equal(completed.status,'completed');
   assert.equal(completed.result?.content,payload.content);
   assert.match(completed.result?.path??'',/账号密码本/);
   assert.equal((db.prepare('SELECT originalInput FROM clipboard_submissions WHERE userId=? AND requestId=?').get(owner,'edit-missing') as {originalInput:string|null}).originalInput,null);
  });
  await t.test('failed force retries one job',async()=>{
   settings({minChars:100});await submit('force-failed');plan={invalid:true};const a=forceClipboardLog(owner,'force-failed');assert.equal((await done(a.id)).status,'failed');plan=createPlan();const b=forceClipboardLog(owner,'force-failed');assert.equal(a.id,b.id);assert.equal((await done(b.id)).status,'completed');
  });
  await t.test('delete removes log only; receipt and note remain replayable',async()=>{
   const j=await create('delete-log'),before=note(j.result!.noteId);deleteClipboardLog(owner,'delete-log');assert.equal(listClipboardLogs(owner).items.some(x=>x.requestId==='delete-log'),false);assert.deepEqual(note(before.id),before);const replay=await submit('delete-log');assert.equal(replay.id,j.id);assert.equal(replay.duplicate,true);
  });
  await t.test('new-note undo trashes note atomically and repeats safely',async()=>{
   const j=await create('undo-create');assert.ok(getCapture(actor,j.id).undoSnapshot);await undoClipboardLog(owner,'undo-create');assert.equal(note(j.result!.noteId).isTrashed,1);assert.ok(getCapture(actor,j.id).undoneAt);assert.equal(listClipboardLogs(owner).items.find(x=>x.requestId==='undo-create')?.status,'undone');await undoClipboardLog(owner,'undo-create');assert.ok(db.prepare('SELECT 1 FROM notebooks WHERE id=?').get(folder));
  });
  await t.test('new-note undo refuses later edits',async()=>{
   const j=await create('changed-create');await put(j.result!.noteId,{content:'用户后续编辑'});await assert.rejects(undoClipboardLog(owner,'changed-create'),/其他修改/);assert.equal(note(j.result!.noteId).isTrashed,0);assert.equal(getCapture(actor,j.id).undoneAt,null);
  });
  await t.test('editing queues complete source without removing the original before replacement (DCC-002 DCC-003 DCC-007)',async()=>{
   const original=await create('edit-original'),id=original.result!.noteId;
   const detail=await app.request('/api/clipboard-settings/logs/edit-original',{headers:{Authorization:'Bearer login'}});assert.equal(detail.status,200);assert.equal((await detail.json() as any).jobId,original.id);
   const invalid=await app.request('/api/clipboard-settings/logs/edit-original/edit',{method:'POST',headers:{Authorization:'Bearer login','Content-Type':'application/json'},body:'{"content":""}'});assert.equal(invalid.status,400);assert.equal(note(id).isTrashed,0);
   assert.equal(getClipboardLogContent(owner,'edit-original').content,'周五检查备份服务');
   await assert.rejects(editClipboardLog(owner,'edit-original',{jobId:original.id,requestId:'missing-service-edit',content:'账号：admin\n密码：Synthetic-42!'}),/所属的服务/);assert.equal(note(id).isTrashed,0);
   const input={jobId:original.id,requestId:'edit-operation',content:'修改后的完整原文'.repeat(50)};
   const a=await editClipboardLog(owner,'edit-original',input),b=await editClipboardLog(owner,'edit-original',input);
   assert.equal(a.id,b.id);assert.equal(a.originalContent,input.content);assert.equal(note(id).isTrashed,0);
   assert.equal(listClipboardLogs(owner).items.find(x=>x.requestId==='edit-original')?.jobId,a.id);
   plan={...createPlan(),content:'重新整理后的正文'};
   assert.equal((await done(a.id)).status,'completed');
   assert.equal(getClipboardLogContent(owner,'edit-original').content,input.content);
   await assert.rejects(editClipboardLog(owner,'edit-original',{...input,content:'同一请求的另一份正文'}),/不同内容/);
   await assert.rejects(editClipboardLog(owner,'edit-original',{...input,requestId:'stale-edit'}),/已变化/);
  });
  await t.test('edit failure preserves later changes and rolls back undo when enqueue fails (DCC-003 DCC-004)',async()=>{
   const original=await create('edit-rollback'),id=original.result!.noteId,before=note(id);
   const input={jobId:original.id,requestId:'edit-rollback-operation',content:'新原文'};
   db.exec("CREATE TRIGGER fixture_edit_failure BEFORE INSERT ON capture_jobs BEGIN SELECT RAISE(ABORT,'synthetic queue failure'); END");
   try {await assert.rejects(editClipboardLog(owner,'edit-rollback',input));assert.deepEqual(note(id),before);assert.equal(getCapture(actor,original.id).undoneAt,null);}
   finally {db.exec('DROP TRIGGER fixture_edit_failure');}
   await put(id,{content:'后续编辑'});const edited=note(id);
   await assert.rejects(editClipboardLog(owner,'edit-rollback',input),/其他修改/);assert.deepEqual(note(id),edited);
   assert.throws(()=>getClipboardLogContent(other,'edit-rollback'),/不存在/);
   await assert.rejects(editClipboardLog(other,'edit-rollback',input),/不存在/);
  });
  await t.test('concurrent edit retries return one durable job (DCC-002 DCC-003)',async()=>{
   const original=await create('concurrent-edit');
   const input={jobId:original.id,requestId:'same-operation',content:'并发编辑的原文'};
   const [a,b]=await Promise.all([editClipboardLog(owner,'concurrent-edit',input),editClipboardLog(owner,'concurrent-edit',input)]);
   assert.equal(a.id,b.id);assert.equal(getCapture(actor,original.id).undoneAt,null);
   const another=await create('other-edit-record');
   const otherJob=await editClipboardLog(owner,'other-edit-record',{...input,jobId:another.id});assert.notEqual(a.id,otherJob.id);
  });
  await t.test('editing an append retains original note and later independent content (DCC-004)',async()=>{
   const base=await create('edit-append-base'),id=base.result!.noteId;
   await put(id,{content:'原有正文',contentFormat:'plaintext'});
   plan={...createPlan(),action:'append',noteId:id,content:'需要修改的追加'};
   const appended=await done((await submit('edit-append','需要修改的追加',{noteId:id,organize:false})).id);
   await put(id,{content:note(id).content+'\n\n独立的后续追加'});
   const job=await editClipboardLog(owner,'edit-append',{jobId:appended.id,requestId:'append-edit',content:'修改后的追加'});
   assert.equal(note(id).content,'原有正文\n\n需要修改的追加\n\n独立的后续追加');
   plan={...createPlan(),action:'append',noteId:id,content:'规整后的追加'};
   const completed=await done(job.id);assert.equal(completed.status,'completed');assert.equal(completed.result!.noteId,id);
   assert.match(note(id).content,/原有正文/);assert.match(note(id).content,/独立的后续追加/);assert.match(note(id).content,/规整后的追加/);
  });
  await t.test('failed regeneration retains edited source and can retry the same job (DCC-003)',async()=>{
   const original=await create('edit-failed-model');
   const job=await editClipboardLog(owner,'edit-failed-model',{jobId:original.id,requestId:'failed-model-operation',content:'失败后仍须保留的新原文'});
   plan={invalid:true};const failed=await done(job.id);assert.equal(failed.status,'failed');assert.equal(failed.originalContent,'失败后仍须保留的新原文');
   assert.equal(note(original.result!.noteId).isTrashed,0);assert.equal(getCapture(actor,original.id).undoneAt,null);assert.equal(listClipboardLogs(owner).items.find(x=>x.requestId==='edit-failed-model')?.canForce,true);
   plan=createPlan();const retried=forceClipboardLog(owner,'edit-failed-model');assert.equal(retried.id,job.id);assert.equal((await done(job.id)).status,'completed');
  });
  await t.test('replacement receipt failure rolls back both notes and the original can still be read (DCC-003 DCC-007)',async()=>{
   const original=await create('replacement-atomic'),id=original.result!.noteId,before=note(id);
   const queued=await editClipboardLog(owner,'replacement-atomic',{jobId:original.id,requestId:'replacement-receipt',content:'新的资料原文'});
   const count=(db.prepare('SELECT count(*) n FROM notes').get() as any).n;
   db.exec(`CREATE TEMP TRIGGER reject_replacement BEFORE UPDATE OF undoneAt ON capture_jobs WHEN OLD.id='${original.id}' BEGIN SELECT RAISE(ABORT,'synthetic replacement failure'); END`);
   try {assert.equal((await done(queued.id)).status,'failed');assert.deepEqual(note(id),before);assert.equal(getCapture(actor,original.id).undoneAt,null);assert.equal((db.prepare('SELECT count(*) n FROM notes').get() as any).n,count);}
   finally {db.exec('DROP TRIGGER reject_replacement');}
   assert.equal((await done(forceClipboardLog(owner,'replacement-atomic').id)).status,'completed');
   assert.equal(note(id).isTrashed,1);assert.ok(getCapture(actor,original.id).undoneAt);
  });
  await t.test('a user edit during regeneration is preserved and prevents replacement (DCC-004)',async()=>{
   const original=await create('replacement-concurrent'),id=original.result!.noteId;
   const queued=await editClipboardLog(owner,'replacement-concurrent',{jobId:original.id,requestId:'regenerate-concurrent',content:'新的原文'});
   duringPlan=()=>db.prepare("UPDATE notes SET content='用户在生成时修改的内容',contentText='用户在生成时修改的内容',version=version+1 WHERE id=?").run(id);
   const failed=await done(queued.id);assert.equal(failed.status,'failed');assert.equal(failed.errorCode,'CAPTURE_UNDO_CONFLICT');
   assert.equal(note(id).content,'用户在生成时修改的内容');assert.equal(note(id).isTrashed,0);assert.equal(getCapture(actor,original.id).undoneAt,null);
  });
  for(const format of ['markdown','plaintext','html','tiptap-json'])await t.test(`append undo restores ${format}, keeping later independent append`,async()=>{
   const j=await create('append-base-'+format),id=j.result!.noteId;
   const base=format==='html'?'<p>原有正文</p>':format==='tiptap-json'?JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'原有正文'}]}]}):'原有正文';await put(id,{content:base,contentFormat:format});const before=note(id);
   plan={...createPlan(),action:'append',noteId:id,content:'本次追加'};const append=await done((await submit('append-'+format,'本次追加',{noteId:id,organize:false})).id);assert.equal(append.status,'completed',JSON.stringify(append));
   const after=note(id);let expected:string;
   if(format==='tiptap-json'){const a=JSON.parse(after.content),b=JSON.parse(before.content);const tail={type:'paragraph',content:[{type:'text',text:'后续追加'}]};await put(id,{content:JSON.stringify({...a,content:[...a.content,tail]})});expected=JSON.stringify({...b,content:[...b.content,JSON.parse(note(id).content).content.at(-1)]});}
   else {const tail=format==='html'?'<p>后续追加</p>':'\n\n后续追加';await put(id,{content:after.content+tail});expected=before.content+tail;}
   await undoClipboardLog(owner,'append-'+format);const current=note(id);assert.equal(format==='markdown'?projectMarkdownForUser(current.content):current.content,format==='markdown'?projectMarkdownForUser(expected):expected);assert.equal(current.isTrashed,0);
  });
  await t.test('append undo refuses changes inside captured content',async()=>{
   const j=await create('conflict-base'),id=j.result!.noteId;plan={...createPlan(),action:'append',noteId:id,content:'本次追加'};await done((await submit('conflict-append','本次追加',{noteId:id})).id);await put(id,{content:'改写了前面及追加内容'});const before=note(id);await assert.rejects(undoClipboardLog(owner,'conflict-append'),/其他修改/);assert.deepEqual(note(id),before);
  });
  await t.test('legacy records undo only verifiable content',async()=>{
   const j=await create('legacy-create');db.prepare('UPDATE capture_jobs SET undoSnapshot=NULL WHERE id=?').run(j.id);await undoClipboardLog(owner,'legacy-create');assert.equal(note(j.result!.noteId).isTrashed,1);
   const base=await create('legacy-base'),id=base.result!.noteId,before=note(id);plan={...createPlan(),action:'append',noteId:id,content:'旧版追加'};const a=await done((await submit('legacy-append','旧版追加',{noteId:id,organize:false})).id);db.prepare('UPDATE capture_jobs SET undoSnapshot=NULL WHERE id=?').run(a.id);await undoClipboardLog(owner,'legacy-append');assert.equal(projectMarkdownForUser(note(id).content),projectMarkdownForUser(before.content));
  });
  await t.test('undo receipt failure rolls back note and can retry',async()=>{
   const j=await create('atomic-undo'),id=j.result!.noteId,before=note(id);
   db.exec("CREATE TRIGGER fixture_undo_failure BEFORE UPDATE OF undoneAt ON capture_jobs BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
   try {await assert.rejects(undoClipboardLog(owner,'atomic-undo'));assert.deepEqual(note(id),before);assert.equal(getCapture(actor,j.id).undoneAt,null);}finally{db.exec('DROP TRIGGER fixture_undo_failure');}
   await undoClipboardLog(owner,'atomic-undo');assert.equal(note(id).isTrashed,1);
  });
  await t.test('forced image bypasses image rule, saves bytes and undo preserves file',async()=>{
   const sharp=(await import('sharp')).default;
   const data=(await sharp({create:{width:4,height:4,channels:3,background:'red'}}).png().toBuffer()).toString('base64');
   settings({filterImages:true});const markdown='![红色图](./red.png)';await submit('force-image',markdown,{kind:'image',images:[{source:'./red.png',markdown,alt:'红色图',mimeType:'image/png',data}]});
   plan={...createPlan(),content:markdown};const j=await done(forceClipboardLog(owner,'force-image').id);assert.equal(j.status,'completed',JSON.stringify(j));
   const id=j.result!.noteId,attachments=db.prepare('SELECT id,path FROM attachments WHERE noteId=?').all(id);assert.equal(attachments.length,1);assert.match(note(id).content,/!\[红色图\]\(\/api\/attachments\//);
   await undoClipboardLog(owner,'force-image');assert.equal(note(id).isTrashed,1);assert.deepEqual(db.prepare('SELECT id,path FROM attachments WHERE noteId=?').all(id),attachments);
  });
  await t.test('ownership, disabled accounts, protected notes and API-token boundary are enforced',async()=>{
   const j=await create('authority'),id=j.result!.noteId;for(const action of [deleteClipboardLog,forceClipboardLog])assert.throws(()=>action(other,'authority'),/不存在/);await assert.rejects(undoClipboardLog(other,'authority'),/不存在/);
   await put(id,{isLocked:1});await assert.rejects(undoClipboardLog(owner,'authority'),/受保护/);db.prepare('UPDATE users SET isDisabled=1 WHERE id=?').run(owner);assert.throws(()=>deleteClipboardLog(owner,'authority'),/账号不可用/);db.prepare('UPDATE users SET isDisabled=0 WHERE id=?').run(owner);
   for(const [method,suffix] of [['GET',''],['DELETE',''],['POST','/force'],['POST','/undo'],['POST','/edit']])assert.equal((await app.request('/api/clipboard-settings/logs/authority'+suffix,{method,headers:{Authorization:'Bearer login','X-Auth-Mode':'api-token'}})).status,403);
   assert.equal((await app.request('/api/clipboard-settings/logs/missing/force',{method:'POST',headers:{Authorization:'Bearer login'}})).status,404);
  });
  await t.test('record filtering happens before pagination and excludes undone results',async()=>{
   settings({minChars:10000});
   for(let index=0;index<33;index++)await submit('filter-page-'+index,'短文本');
   const first=listClipboardLogs(owner,0,'filtered'),next=listClipboardLogs(owner,30,'filtered');
   assert.equal(first.items.length,30);assert.equal(first.hasMore,true);assert.ok(next.items.length>=3);
   assert.ok([...first.items,...next.items].every(row=>row.status==='filtered'));
   const successful=listClipboardLogs(owner,0,'completed');assert.ok(successful.items.length>0);assert.ok(successful.items.every(row=>row.status==='completed'));
   const invalid=await app.request('/api/clipboard-settings/logs?status=invalid',{headers:{Authorization:'Bearer login'}});assert.equal(invalid.status,400);
   settings();
  });
 } finally {await new Promise<void>(resolve=>model.close(()=>resolve()));closeDb();fs.rmSync(directory,{recursive:true,force:true});}
});
