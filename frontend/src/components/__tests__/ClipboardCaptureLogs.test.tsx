import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi, beforeEach } from "vitest";

const {logs,deleteLog,forceLog,undoLog}=vi.hoisted(()=>({logs:vi.fn(),deleteLog:vi.fn(),forceLog:vi.fn(),undoLog:vi.fn()}));
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:"zh-CN"}})}));
vi.mock("@/lib/clipboardIntegration",()=>({clipboardIntegrationApi:{logs,deleteLog,forceLog,undoLog}}));
import ClipboardCaptureLogs from "../settings/ClipboardCaptureLogs";
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});

it("explains unknown-purpose skips and distinct image failures without blaming model configuration",async()=>{
  logs.mockResolvedValue({hasMore:false,items:[
    {status:"filtered",code:"CAPTURE_UNCLEAR_PURPOSE"},
    {status:"failed",code:"CAPTURE_IMAGE_HTTP_502"},
    {status:"failed",code:"CAPTURE_IMAGE_EMPTY_RESPONSE"},
    {status:"failed",code:"CAPTURE_IMAGE_TIMEOUT"},
    {status:"failed",code:"CAPTURE_IMAGE_DESCRIPTION_FAILED"},
  ].map((row,index)=>({...row,requestId:String(index),preview:"合成测试内容",warnings:[]}))});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<ClipboardCaptureLogs/>));
    expect(host.textContent).toContain("无法确认用途，已跳过");
    expect(host.textContent).toContain("HTTP 502");
    expect(host.textContent).toContain("未返回可用描述");
    expect(host.textContent).toContain("请求超时");
    expect(host.textContent).toContain("旧记录未保存具体原因");
    expect(host.textContent).not.toContain("检查多模态配置");
  } finally {act(()=>root.unmount());host.remove();}
});

beforeEach(()=>{vi.resetAllMocks();});
const row=(requestId:string,status:string)=>({requestId,status,preview:"合成内容",warnings:[],canForce:["filtered","failed","undone"].includes(status),canUndo:status==="completed"});
async function rendered(items:any[],run:(host:HTMLDivElement)=>Promise<void>){
 logs.mockResolvedValue({items,hasMore:false});const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(<ClipboardCaptureLogs/>));await run(host);}finally{act(()=>root.unmount());host.remove();}
}
const button=(host:HTMLElement,label:string,index=0)=>host.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)[index];
it("shows three compact actions per row and prevents forcing an already saved record",async()=>{
 await rendered([row("filtered","filtered"),row("saved","completed"),row("old","filtered")].map(r=>r.requestId==="old"?{...r,canForce:false}:r),async host=>{
  expect(host.querySelectorAll('[role="group"]')).toHaveLength(3);expect(button(host,"删除").disabled).toBe(false);expect(button(host,"强制收集").disabled).toBe(false);expect(button(host,"撤销").disabled).toBe(true);
  expect(button(host,"强制收集",1).disabled).toBe(true);expect(button(host,"撤销",1).disabled).toBe(false);expect(button(host,"强制收集",2).disabled).toBe(true);
 });
});
it("delete only calls log deletion and reloads history",async()=>{
 deleteLog.mockResolvedValue({deleted:true});await rendered([row("delete-one","completed")],async host=>{
  logs.mockResolvedValue({items:[],hasMore:false});await act(async()=>button(host,"删除").click());expect(deleteLog).toHaveBeenCalledWith("delete-one");expect(undoLog).not.toHaveBeenCalled();expect(host.textContent).toContain("日志已删除，笔记内容不变");expect(host.querySelectorAll('article')).toHaveLength(0);
 });
});
it("force queues once during double click and displays returned filing destination",async()=>{
 let resolve!:(v:unknown)=>void;forceLog.mockImplementation(()=>new Promise(r=>{resolve=r;}));await rendered([row("force-one","filtered")],async host=>{
  act(()=>{button(host,"强制收集").click();button(host,"强制收集").click();});expect(forceLog).toHaveBeenCalledTimes(1);expect(button(host,"删除").disabled).toBe(true);
  logs.mockResolvedValue({items:[{...row("force-one","completed"),path:"技术 / 数据库 / 资料",action:"create"}],hasMore:false});await act(async()=>resolve({status:"queued"}));expect(host.textContent).toContain("技术 / 数据库 / 资料");expect(host.textContent).toContain("已绕过过滤");expect(button(host,"撤销").disabled).toBe(false);
 });
});
it("undo updates status and permits force collecting again",async()=>{
 undoLog.mockResolvedValue({undone:true});await rendered([row("undo-one","completed")],async host=>{
  logs.mockResolvedValue({items:[row("undo-one","undone")],hasMore:false});await act(async()=>button(host,"撤销").click());expect(undoLog).toHaveBeenCalledWith("undo-one");expect(host.textContent).toContain("已撤销");expect(button(host,"撤销").disabled).toBe(true);expect(button(host,"强制收集").disabled).toBe(false);
 });
});
it("failed undo shows concrete reason and enables retry without losing the card",async()=>{
 undoLog.mockRejectedValue(new Error("笔记在收集后已有其他修改，当前内容已保留"));await rendered([row("edited","completed")],async host=>{
  await act(async()=>button(host,"撤销").click());expect(host.querySelector('[role="alert"]')?.textContent).toContain("已有其他修改");expect(button(host,"撤销").disabled).toBe(false);expect(host.querySelectorAll('article')).toHaveLength(1);
 });
});
