const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createFnosSessionTransport, permittedTarget } = require('../fnos-session');
const origins = new Set(['https://nas.example']);
test('fnOS share management stays within note reads and explicit sharing endpoints', () => {
 const base='https://nas.example/app/nowen-note-private';
 for(const [route,method] of [['/api/shares','POST'],['/api/shares/import-desktop','POST'],['/api/shares/note/note-1','GET'],['/api/shares/status/batch','GET'],['/api/shares/share-1','PUT'],['/api/shares/share-1','DELETE'],['/api/notes/note-1','GET']]) assert.ok(permittedTarget(base+route,origins,false,method));
 for(const [route,method] of [['/api/notes/note-1','PUT'],['/api/notes','POST'],['/api/shares/share-1/content','PUT'],['/api/shares/share-1','POST'],['/api/users','GET'],['/api/clipboard/captures','POST']]) assert.equal(permittedTarget(base+route,origins,false,method),null);
});
test('fnOS log actions allow only explicit management methods and preserve the capture boundary',()=>{
 const base='https://nas.example/app/nowen-note-private';
 for(const [route,method] of [['/api/clipboard-settings/logs/request%2Fid','DELETE'],['/api/clipboard-settings/logs/request%2Fid/force','POST'],['/api/clipboard-settings/logs/id/undo','POST']])assert.ok(permittedTarget(base+route,origins,false,method));
 for(const [route,method] of [['/api/clipboard-settings/logs/id','PUT'],['/api/clipboard-settings/logs/id/undo','DELETE'],['/api/clipboard-settings/logs/id/other','POST'],['/api/clipboard/captures','POST'],['/api/clipboard-settings/logs/id/force/extra','POST']])assert.equal(permittedTarget(base+route,origins,false,method),null);
});
test('fnOS bridge allows settings management but rejects clipboard submission and receipts', () => {
 const base='https://nas.example/app/nowen-note-private';
 for(const [route,method] of [['/api/clipboard-settings','GET'],['/api/clipboard-settings','PUT'],['/api/clipboard-settings/logs?offset=30','GET'],['/api/clipboard-settings/token','POST'],['/api/notebooks','GET']]) assert.ok(permittedTarget(base+route,origins,false,method));
 for(const [route,method] of [['/api/clipboard/captures','POST'],['/api/clipboard/policy','GET'],['/api/clipboard/captures/job-1','GET'],['/api/clipboard/captures/job-1/retry','POST'],['/api/notebooks','POST']]) assert.equal(permittedTarget(base+route,origins,false,method),null);
});
test('fnOS bridge confines requests to the chosen NAS and sync/auth paths', () => {
  for (const value of ['https://evil.example/app/nowen-note-private/api/sync/v2/plan', 'https://nas.example/api/sync/v2/plan', 'https://nas.example/app/nowen-note-private/api/users', 'https://x:y@nas.example/app/nowen-note-private/api/auth/fnos']) assert.equal(permittedTarget(value, origins), null);
  assert.ok(permittedTarget('https://nas.example/app/nowen-note-private/api/sync/v2/blob/test', origins));
  assert.ok(permittedTarget('https://nas.example/app/nowen-note-private/ws?token=example', origins, true));
});
test('native NAS authorization uses a sandboxed isolated persistent browser and closes only after activation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nowen-nas-browser-'));
  let options, target, ready = 0, cancelled = 0, closed;
  const ses = { setCertificateVerifyProc() {}, setPermissionRequestHandler() {}, fetch: async () => Response.json({ token: 'test', user: { id: 'nas-user' } }) };
  class Window {
    constructor(value) { options = value; this.webContents = { setWindowOpenHandler() {}, on() {} }; }
    isDestroyed() { return false; } loadURL(value) { target = value; return Promise.resolve(); }
    close() { closed(); } on(name, handler) { if (name === 'closed') closed = handler; }
  }
  const transport = createFnosSessionTransport({ session: { fromPartition: value => { assert.match(value, /^persist:nowen-fnos-/); return ses; } }, BrowserWindow: Window, getDataPath: () => dir, getParent: () => null });
  transport.authorize('https://nas.example', async () => { ready++; }, async () => { cancelled++; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready, 1); assert.equal(cancelled, 0); assert.equal(target, 'https://nas.example');
  assert.equal(options.webPreferences.sandbox, true); assert.equal(options.webPreferences.nodeIntegration, false);
  fs.rmSync(dir, { force: true, recursive: true });
});
test('NAS relay requires its capability, rejects other origins and preserves attachment bytes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nowen-nas-relay-'));
  const url='https://nas.example/app/nowen-note-private';
  fs.writeFileSync(path.join(dir,'.sync_credentials.json'),JSON.stringify({test:{transport:'fnos-session',serverUrl:url}}));
  const body=Buffer.from([0,255,1,128,42]);
  const ses={setCertificateVerifyProc(){},setPermissionRequestHandler(){},fetch:async(target,init)=>{
    if (target.endsWith('/plan')) return new Response('<html>NAS login</html>',{headers:{'Content-Type':'text/html'}});
    if (target.endsWith('/expired')) return new Response('invalid token',{headers:{'Content-Type':'text/plain'}});
    assert.equal(target,url+'/api/sync/v2/blob/example');
    assert.equal(init.credentials,'include'); assert.equal(init.redirect,'error');
    assert.equal(init.headers.cookie,undefined,'NAS cookies remain inside Electron session');
    return new Response(body,{headers:{'Content-Type':'application/octet-stream','X-Blob-Hash':'expected-hash'}});
  }};
  const transport=createFnosSessionTransport({session:{fromPartition:()=>ses},getDataPath:()=>dir,WebSocket:require('../../backend/node_modules/ws')});
  const env=await transport.start();
  try {
    assert.equal((await fetch(env.NOWEN_FNOS_BRIDGE_URL)).status,403);
    const headers={'X-Nowen-Bridge':env.NOWEN_FNOS_BRIDGE_TOKEN,'X-Nowen-Target':'https://evil.example/app/nowen-note-private/api/sync/v2/plan'};
    assert.equal((await fetch(env.NOWEN_FNOS_BRIDGE_URL,{headers})).status,403);
    headers['X-Nowen-Target']=url+'/api/sync/v2/blob/example';
    const response=await fetch(env.NOWEN_FNOS_BRIDGE_URL,{headers});
    assert.equal(response.status,200); assert.equal(response.headers.get('X-Blob-Hash'),'expected-hash');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),body);
    assert.equal(response.headers.get('set-cookie'),null);
    headers['X-Nowen-Target']=url+'/api/sync/v2/plan';
    const expired=await fetch(env.NOWEN_FNOS_BRIDGE_URL,{headers});
    assert.equal(expired.status,401);assert.equal((await expired.json()).code,'AUTH_EXPIRED');
    headers['X-Nowen-Target']=url+'/api/sync/v2/blob/expired';
    assert.equal((await fetch(env.NOWEN_FNOS_BRIDGE_URL,{method:'HEAD',headers})).status,401,'NAS invalid-token reply cannot confirm a blob upload');
  } finally { await transport.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('restart restores the remembered NAS session through its own sandboxed portal', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nowen-nas-restore-'));
  fs.writeFileSync(path.join(dir,'.sync_credentials.json'),JSON.stringify({p:{transport:'fnos-session',serverUrl:'https://nas.example/app/nowen-note-private'}}));
  let restored=false, hidden=false, closed=false;
  const ses={setCertificateVerifyProc(){},setPermissionRequestHandler(){},flushStorageData(){},
    cookies:{get:async()=>[{name:'osrt',session:false}],flushStore:async()=>{}},
    fetch:async(url)=>url.endsWith('/health')
      ? restored?Response.json({service:'nowen-note',status:'ok'}):new Response('invalid token')
      :Response.json({scopes:[]})};
  class Window {
    constructor(options){hidden=options.show===false&&options.webPreferences.sandbox;this.webContents={setWindowOpenHandler(){},on(){}};}
    loadURL(url){assert.equal(url,'https://nas.example');restored=true;return Promise.resolve();}
    isDestroyed(){return closed;} destroy(){closed=true;}
  }
  const transport=createFnosSessionTransport({session:{fromPartition:()=>ses},BrowserWindow:Window,getDataPath:()=>dir,WebSocket:require('../../backend/node_modules/ws')});
  const env=await transport.start();
  try {
    const response=await fetch(env.NOWEN_FNOS_BRIDGE_URL,{headers:{'X-Nowen-Bridge':env.NOWEN_FNOS_BRIDGE_TOKEN,'X-Nowen-Target':'https://nas.example/app/nowen-note-private/api/sync/v2/scopes'}});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{scopes:[]});assert.equal(hidden,true);assert.equal(closed,true);
  } finally {await transport.close();fs.rmSync(dir,{recursive:true,force:true});}
});
