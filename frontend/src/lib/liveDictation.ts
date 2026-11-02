import type { RecordedVoice, VoiceRecorderState } from "./voiceRecorder";
export function pcmWave(samples: Float32Array, sampleRate: number): Blob {
 const buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer);
 const text=(at:number,s:string)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
 text(0,"RIFF");v.setUint32(4,buffer.byteLength-8,true);text(8,"WAVEfmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,"data");v.setUint32(40,samples.length*2,true);
 samples.forEach((x,i)=>{x=Math.max(-1,Math.min(1,x));v.setInt16(44+i*2,x<0?x*32768:x*32767,true);});return new Blob([buffer],{type:"audio/wav"});
}
/** Each segment is a complete WAV; compressed MediaRecorder slices are not standalone audio. */
export class LiveDictationSession {
 state:VoiceRecorderState="idle";
 private stream?:MediaStream;private context?:AudioContext;private source?:MediaStreamAudioSourceNode;private processor?:ScriptProcessorNode;
 private frames:Float32Array[]=[];private length=0;private cancelled=false;
 constructor(private onState:(state:VoiceRecorderState)=>void,private onSegment:(voice:RecordedVoice)=>void){}
 private setState(state:VoiceRecorderState){this.state=state;this.onState(state);}
 async start(){
  if(this.state!=="idle")return;
  if(!navigator.mediaDevices?.getUserMedia||typeof AudioContext==="undefined")throw new Error("voice.insecure");
  this.setState("requesting-permission");
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(this.cancelled){stream.getTracks().forEach(t=>t.stop());return;}
   this.stream=stream;const context=new AudioContext();this.context=context;
   this.source=context.createMediaStreamSource(stream);this.processor=context.createScriptProcessor(4096,1,1);
   this.processor.onaudioprocess=event=>{if(this.state!=="recording")return;const frame=new Float32Array(event.inputBuffer.getChannelData(0));this.frames.push(frame);this.length+=frame.length;if(this.length>=context.sampleRate*3)this.flush();};
   this.source.connect(this.processor);this.processor.connect(context.destination);
   stream.getAudioTracks().forEach(track=>track.addEventListener("ended",()=>{void this.stop();}));
   await context.resume();if(this.cancelled){await this.release();return;}this.setState("recording");
  }catch(error){await this.release();this.setState("error");throw error;}
 }
 private flush(){
  if(!this.length||!this.context)return;const samples=new Float32Array(this.length);let offset=0;this.frames.forEach(frame=>{samples.set(frame,offset);offset+=frame.length;});this.frames=[];this.length=0;
  let energy=0;for(const x of samples)energy+=x*x;
  if(samples.length<this.context.sampleRate*0.15||Math.sqrt(energy/samples.length)<0.003)return;
  const blob=pcmWave(samples,this.context.sampleRate);this.onSegment({blob,mimeType:"audio/wav",extension:"wav",durationMs:samples.length/this.context.sampleRate*1000,size:blob.size});
 }
 async stop(){this.cancelled=true;if(this.state==="recording")this.flush();await this.release();this.setState("idle");}
 async cancel(){this.cancelled=true;this.frames=[];this.length=0;await this.release();this.setState("idle");}
 private async release(){if(this.processor){this.processor.onaudioprocess=null;this.processor.disconnect();}this.source?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());if(this.context?.state!=="closed")await this.context?.close();}
}
export function insertDictation(text:string,start:number,end:number,spoken:string){const at=Math.max(0,Math.min(start,text.length)),to=Math.max(at,Math.min(end,text.length));return {text:text.slice(0,at)+spoken+text.slice(to),caret:at+spoken.length};}

/** Recover older compressed dictation drafts using the same WAV upload path. */
export async function dictationWave(voice: RecordedVoice): Promise<RecordedVoice> {
 if(voice.mimeType.toLowerCase().includes("wav"))return voice;
 const context=new AudioContext();
 try{
  const decoded=await context.decodeAudioData(await voice.blob.arrayBuffer());const mono=new Float32Array(decoded.length);
  for(let channel=0;channel<decoded.numberOfChannels;channel++){const data=decoded.getChannelData(channel);for(let i=0;i<data.length;i++)mono[i]+=data[i]/decoded.numberOfChannels;}
  const blob=pcmWave(mono,decoded.sampleRate);return {...voice,blob,mimeType:"audio/wav",extension:"wav",size:blob.size};
 }finally{await context.close();}
}
