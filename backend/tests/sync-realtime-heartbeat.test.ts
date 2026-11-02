import test from 'node:test';
import assert from 'node:assert/strict';
import {SyncRealtimeSubscription} from '../src/sync/realtime';
test('background sync sends application heartbeats and cancels them on close and stop',()=>{
 const pending=new Map<number,{fn:()=>void;ms:number}>();let id=0;let socket:any;
 class Socket {readyState=1;onopen:any;onclose:any;onerror:any;onmessage:any;sent:string[]=[];constructor(){socket=this;}send(value:string){this.sent.push(value);}close(){this.readyState=3;}}
 const sub=new SyncRealtimeSubscription({serverUrl:'http://nas.test',token:'fixture',onNotice:()=>{},webSocketImpl:Socket as unknown as typeof WebSocket,scheduler:{setTimeout:(fn,ms)=>{pending.set(++id,{fn,ms});return id;},clearTimeout:key=>{pending.delete(key as number);}}});
 sub.start();socket.onopen();
 for(let i=0;i<6;i++){const entry=[...pending.entries()].find(([,value])=>value.ms===20000)!;assert.ok(entry);pending.delete(entry[0]);entry[1].fn();}
 assert.equal(socket.sent.length,6);assert.ok(socket.sent.every((value:string)=>JSON.parse(value).type==='ping'));
 socket.onclose();assert.equal([...pending.values()].filter(value=>value.ms===20000).length,0);
 sub.stop();assert.equal(pending.size,0);
});
