import assert from "node:assert/strict";
import test from "node:test";
import {Hono} from "hono";
import {getDb,closeDb} from "../src/db/schema";
import aiRouter from "../src/routes/ai";
import {initVecStore,upsertVectors} from "../src/services/vec-store";
import {setUserAISettings} from "../src/services/user-ai-settings";

test("knowledge answers combine exact and vector recall and retain scope (DCC-006)",async()=>{
  const db=getDb(),owner='ask-hybrid-owner',app=new Hono().route('/ai',aiRouter),originalFetch=globalThis.fetch;
  db.prepare("INSERT INTO users(id,username,passwordHash) VALUES(?,?,'hash')").run(owner,owner);
  for(const id of ['selected','outside'])db.prepare("INSERT INTO notebooks(id,userId,name) VALUES(?,?,?)").run(id,owner,id);
  const note=db.prepare("INSERT INTO notes(id,userId,notebookId,title,content,contentText,contentFormat) VALUES(?,?,?,?,?,?,'markdown')");
  note.run('precise',owner,'selected','账号密码本','服务：https://alpha.example.test\n账号：demo\n密码：Synthetic-42!','服务：https://alpha.example.test\n账号：demo\n密码：Synthetic-42!');
  note.run('weak',owner,'outside','旅行清单','雨天带伞','雨天带伞');
  initVecStore();
  const embedding=db.prepare("INSERT INTO note_embeddings(noteId,userId,chunkIndex,chunkText,vectorJson,model,dim) VALUES('weak',?,0,'雨天带伞','[1,0]','test',2)").run(owner);
  upsertVectors([{rowid:Number(embedding.lastInsertRowid),vector:[1,0]}]);
  setUserAISettings(owner,[{key:'ai_api_url',value:'https://chat.example.test/v1'},{key:'ai_api_key',value:'synthetic'},{key:'ai_model',value:'fixture'},
    {key:'ai_embedding_url',value:'https://embedding.example.test/v1'},{key:'ai_embedding_key',value:'synthetic'},{key:'ai_embedding_model',value:'test'}]);
  let prompt='',failEmbedding=false;
  globalThis.fetch=(async(input,init)=>{
    if(String(input).endsWith('/embeddings'))return new Response(JSON.stringify({data:[{index:0,embedding:[1,0]}]}),{status:failEmbedding?503:200});
    prompt=JSON.parse(String(init?.body)).messages[0].content;
    return new Response('data: '+JSON.stringify({choices:[{delta:{content:'模拟回答'}}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  }) as typeof fetch;
  const ask=async(question:string,extra:Record<string,unknown>={})=>{
    const response=await app.request('/ai/ask',{method:'POST',headers:{'X-User-Id':owner,'Content-Type':'application/json'},body:JSON.stringify({question,...extra})});
    return {status:response.status,text:await response.text()};
  };
  try {
    const mixed=await ask('alpha.example.test');assert.equal(mixed.status,200);assert.ok(mixed.text.includes('precise'));assert.ok(prompt.includes('alpha.example.test'));assert.ok(prompt.includes('Synthetic-42!'));
    const scoped=await ask('alpha.example.test',{notebookId:'selected'});assert.ok(scoped.text.includes('precise'));assert.ok(!scoped.text.includes('weak'));assert.ok(!prompt.includes('旅行清单'));
    failEmbedding=true;
    const missing=await ask('xyzunknownquery');assert.equal(missing.status,200);assert.ok(!missing.text.includes('event: references'));assert.ok(!prompt.includes('Synthetic-42!'));assert.ok(!prompt.includes('旅行清单'));
    const recent=await ask('总结我最近的笔记');assert.ok(recent.text.includes('event: references'));
    const forbidden=await app.request('/ai/ask?workspaceId=foreign',{method:'POST',headers:{'X-User-Id':owner,'Content-Type':'application/json'},body:JSON.stringify({question:'alpha.example.test'})});assert.equal(forbidden.status,403);
  }finally{globalThis.fetch=originalFetch;closeDb();}
});
