import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveDictationSession, insertDictation, pcmWave } from "../liveDictation";
let processor:any;let track:any;let context:any;
beforeEach(()=>{
 track={stop:vi.fn(),addEventListener:vi.fn()};processor={connect:vi.fn(),disconnect:vi.fn(),onaudioprocess:null};
 context={sampleRate:16000,state:"running",destination:{},createMediaStreamSource:()=>({connect:vi.fn(),disconnect:vi.fn()}),createScriptProcessor:()=>processor,resume:vi.fn(async()=>{}),close:vi.fn(async()=>{context.state="closed";})};
 vi.stubGlobal("AudioContext",class{constructor(){return context;}});Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:vi.fn(async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}))}});
});
afterEach(()=>{vi.unstubAllGlobals();});
const frame=(samples:Float32Array)=>processor.onaudioprocess({inputBuffer:{getChannelData:()=>samples}});
it("encodes valid PCM WAV with clipped samples and correct duration fields",async()=>{
 const blob=pcmWave(new Float32Array([-2,0,2]),16000);const b=await new Promise<ArrayBuffer>(r=>{const f=new FileReader();f.onload=()=>r(f.result as ArrayBuffer);f.readAsArrayBuffer(blob);});const d=new DataView(b);
 expect(String.fromCharCode(...new Uint8Array(b,0,4))).toBe("RIFF");expect(d.getUint32(24,true)).toBe(16000);expect(d.getUint32(40,true)).toBe(6);expect(d.getInt16(44,true)).toBe(-32768);expect(d.getInt16(48,true)).toBe(32767);
});
it("emits complete independent WAV segments while recording and flushes the final tail exactly once",async()=>{
 const output=vi.fn();const session=new LiveDictationSession(vi.fn(),output);await session.start();frame(new Float32Array(48000).fill(.1));expect(output).toHaveBeenCalledTimes(1);expect(session.state).toBe("recording");expect(output.mock.calls[0][0]).toMatchObject({mimeType:"audio/wav",extension:"wav",durationMs:3000});frame(new Float32Array(8000).fill(.1));await session.stop();await session.stop();expect(output).toHaveBeenCalledTimes(2);expect(track.stop).toHaveBeenCalled();expect(context.close).toHaveBeenCalledTimes(1);
});
it("skips silent segments and cancels a late permission grant without starting audio",async()=>{
 const output=vi.fn();const session=new LiveDictationSession(vi.fn(),output);await session.start();frame(new Float32Array(48000));await session.stop();expect(output).not.toHaveBeenCalled();
 let allow:any;vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(new Promise(r=>{allow=r;}));const late=new LiveDictationSession(vi.fn(),output);const start=late.start();await late.stop();allow({getTracks:()=>[track]});await start;expect(late.state).toBe("idle");expect(output).not.toHaveBeenCalled();
});
it("inserts at a caret or selection without replacing surrounding text",()=>{
 expect(insertDictation("前文后文",2,2,"语音")).toEqual({text:"前文语音后文",caret:4});expect(insertDictation("abc def",4,7,"voice")).toEqual({text:"abc voice",caret:9});
});
