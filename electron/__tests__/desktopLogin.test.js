const test=require('node:test'),assert=require('node:assert/strict');
const {registerDesktopLogin}=require('../desktop-login');
test('desktop login rejects untrusted callers and never exposes remote credentials',async()=>{
 const handlers=new Map(),seen=[],signed=[];const original=global.fetch;
 global.fetch=async(url,init)=>{seen.push([url,JSON.parse(init.body||'{}')]);return Response.json(url.includes('/status')?{status:'connected',result:{profile:{serverUrl:'https://nas.test'},login:{token:'local-token',user:{id:'local'}}}}:{mode:'device-only',profiles:[]});};
 try{
 registerDesktopLogin({ipcMain:{handle:(k,v)=>handlers.set(k,v)},assertSender:e=>e.trusted?null:{error:'denied'},getConnection:async()=>({baseUrl:'http://127.0.0.1:12345',token:'internal'}),startAuthorization:async(_e,_url,login)=>{assert.equal(login,true);return {requestId:'pending'};},getLastServer:()=>'',onLogin:async(...args)=>signed.push(args)});
 assert.equal((await handlers.get('desktop:login-start')({},{})).error,'denied');assert.equal(seen.length,0);
 await handlers.get('desktop:login-start')({trusted:true},{method:'nas',serverUrl:'https://nas.test'});
 const done=await handlers.get('desktop:login-status')({trusted:true},{requestId:'pending'});assert.equal(done.login.token,'local-token');assert.equal(done.login.serverUrl,'http://127.0.0.1:12345');assert.equal(signed.length,1);
 assert.ok((await handlers.get('desktop:login-status')({trusted:true},{requestId:'pending'})).error);
 }finally{global.fetch=original;}
});
