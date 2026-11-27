import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi, beforeEach } from "vitest";

const {logs,deleteLog,forceLog,undoLog,logContent,editLog,getNote,navigate,scope}=vi.hoisted(()=>({logs:vi.fn(),deleteLog:vi.fn(),forceLog:vi.fn(),undoLog:vi.fn(),logContent:vi.fn(),editLog:vi.fn(),getNote:vi.fn(),navigate:vi.fn(),scope:vi.fn()}));
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:"zh-CN"}})}));
vi.mock("@/lib/clipboardIntegration",()=>({clipboardIntegrationApi:{logs,deleteLog,forceLog,undoLog,logContent,editLog}}));
vi.mock("@/lib/api",()=>({api:{getNote},getCurrentWorkspace:()=>null,setCurrentWorkspace:vi.fn(),getServerUrl:()=>"https://notes.example"}));
vi.mock("@/lib/authSession",()=>({getAccessToken:()=>"synthetic-token"}));
vi.mock("@/lib/offlineScope",()=>({getOfflineQueueStorageKey:scope}));
vi.mock("@/lib/noteDeepLink",()=>({pushNoteAppPath:navigate}));
import ClipboardCaptureLogs from "../settings/ClipboardCaptureLogs";
import {toast} from "@/lib/toast";
vi.mock("@/lib/toast",()=>({toast:{success:vi.fn(),error:vi.fn()}}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});

it("keeps failure diagnostics but hides all filter reasons and redacted previews",async()=>{
  logs.mockResolvedValue({hasMore:false,items:[
    {status:"filtered",code:"CAPTURE_UNCLEAR_PURPOSE",canForce:true},
    {status:"filtered",code:"AI_FILTERED",canForce:true,errorMessage:"AI判断无需收集"},
    {status:"filtered",code:"CAPTURE_CONTEXT_REQUIRED",canForce:false,preview:"缺少所属服务的账号或敏感片段（原文未保留）"},
    {status:"failed",code:"CAPTURE_IMAGE_HTTP_502"},
    {status:"failed",code:"CAPTURE_IMAGE_EMPTY_RESPONSE"},
    {status:"failed",code:"CAPTURE_IMAGE_TIMEOUT"},
    {status:"failed",code:"CAPTURE_IMAGE_DESCRIPTION_FAILED"},
  ].map((row,index)=>({preview:"合成测试内容",warnings:[],...row,requestId:String(index)}))});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<ClipboardCaptureLogs/>));
    expect([...host.querySelectorAll("article")].slice(0,3).map(article=>article.querySelector("span")?.textContent)).toEqual(["已过滤","已过滤","已过滤"]);
    expect(host.textContent).toContain("合成测试内容");
    expect(host.textContent).not.toContain("无法确认用途");
    expect(host.textContent).not.toContain("AI判断无需收集");
    expect(host.textContent).not.toContain("缺少所属服务");
    expect(host.querySelector('[title="CAPTURE_CONTEXT_REQUIRED"]')).toBeNull();
    expect(host.textContent).toContain("HTTP 502");
    expect(host.textContent).toContain("未返回可用描述");
    expect(host.textContent).toContain("请求超时");
    expect(host.textContent).toContain("旧记录未保存具体原因");
    expect(host.textContent).not.toContain("检查多模态配置");
  } finally {act(()=>root.unmount());host.remove();}
});

beforeEach(()=>{vi.resetAllMocks();scope.mockReturnValue("notes.example:owner");});
const row=(requestId:string,status:string)=>({requestId,status,jobId:"job-"+requestId,noteId:status==="completed"?"note-"+requestId:null,preview:"合成内容",warnings:[],canEdit:status==="completed",canForce:["filtered","failed","undone"].includes(status),canUndo:status==="completed"});
async function rendered(items:any[],run:(host:HTMLDivElement)=>Promise<void>,onOpenNote?:()=>void,serverUrl?:string){
 logs.mockResolvedValue({items,hasMore:false});const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(<ClipboardCaptureLogs onOpenNote={onOpenNote} serverUrl={serverUrl}/>));await run(host);}finally{act(()=>root.unmount());host.remove();}
}
const button=(host:HTMLElement,label:string,index=0)=>host.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)[index];
it("shows compact record actions and prevents forcing an already saved record",async()=>{
 await rendered([row("filtered","filtered"),row("saved","completed"),row("old","filtered")].map(r=>r.requestId==="old"?{...r,canForce:false}:r),async host=>{
  expect(host.querySelectorAll('[aria-label="记录操作"]')).toHaveLength(3);expect(button(host,"删除").disabled).toBe(false);expect(button(host,"强制收集").disabled).toBe(false);expect(button(host,"撤销").disabled).toBe(true);
  expect(button(host,"强制收集",1).disabled).toBe(true);expect(button(host,"撤销",1).disabled).toBe(false);expect(button(host,"强制收集",2).disabled).toBe(true);
 });
});
it("delete only calls log deletion and reloads history",async()=>{
 deleteLog.mockResolvedValue({deleted:true});await rendered([row("delete-one","completed")],async host=>{
  logs.mockResolvedValue({items:[],hasMore:false});await act(async()=>button(host,"删除").click());expect(deleteLog).toHaveBeenCalledWith("delete-one");expect(undoLog).not.toHaveBeenCalled();expect(toast.success).toHaveBeenCalledWith("记录已删除，笔记内容不变");expect(host.textContent).not.toContain("记录已删除，笔记内容不变");expect(host.querySelectorAll('article')).toHaveLength(0);
 });
});
it("force queues once during double click and displays returned filing destination",async()=>{
 let resolve!:(v:unknown)=>void;forceLog.mockImplementation(()=>new Promise(r=>{resolve=r;}));await rendered([row("force-one","filtered")],async host=>{
  act(()=>{button(host,"强制收集").click();button(host,"强制收集").click();});expect(forceLog).toHaveBeenCalledTimes(1);expect(button(host,"删除").disabled).toBe(true);
  logs.mockResolvedValue({items:[{...row("force-one","completed"),path:"技术 / 数据库 / 资料",action:"create"}],hasMore:false});await act(async()=>resolve({status:"queued"}));expect(host.textContent).toContain("技术 / 数据库 / 资料");expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("已绕过过滤"));expect(button(host,"撤销").disabled).toBe(false);
 });
});
it("undo updates status and permits force collecting again",async()=>{
 undoLog.mockResolvedValue({undone:true});await rendered([row("undo-one","completed")],async host=>{
  logs.mockResolvedValue({items:[row("undo-one","undone")],hasMore:false});await act(async()=>button(host,"撤销").click());expect(undoLog).toHaveBeenCalledWith("undo-one");expect(host.textContent).toContain("已撤销");expect(button(host,"撤销").disabled).toBe(true);expect(button(host,"强制收集").disabled).toBe(false);
 });
});
it("failed undo shows concrete reason and enables retry without losing the card",async()=>{
 undoLog.mockRejectedValue(new Error("笔记在收集后已有其他修改，当前内容已保留"));await rendered([row("edited","completed")],async host=>{
  await act(async()=>button(host,"撤销").click());expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("已有其他修改"));expect(button(host,"撤销").disabled).toBe(false);expect(host.querySelectorAll('article')).toHaveLength(1);
 });
});

it("loads full source for editing and submits one atomic reorganization request",async()=>{
 const original="完整原文".repeat(100);logContent.mockResolvedValue({jobId:"job-source",content:original});editLog.mockResolvedValue({status:"queued"});
 await rendered([row("editable","completed")],async host=>{
  await act(async()=>button(host,"编辑").click());const field=host.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑原文"]')!;
  expect(field.value).toBe(original);const revised=original+"修改";
  act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,revised);field.dispatchEvent(new Event("input",{bubbles:true}));});
  const submit=Array.from(host.querySelectorAll("button")).find(x=>x.textContent==="重新整理")!;
  logs.mockResolvedValue({items:[row("editable","queued")],hasMore:false});
  await act(async()=>{submit.click();submit.click();});
  expect(editLog).toHaveBeenCalledTimes(1);expect(editLog).toHaveBeenCalledWith("editable",{jobId:"job-source",requestId:expect.any(String),content:revised});
  expect(undoLog).not.toHaveBeenCalled();expect(host.querySelector("textarea")).toBeNull();expect(toast.success).toHaveBeenCalledWith("已排队重新整理");expect(host.textContent).not.toContain("已排队重新整理");
 });
});
it("preserves the edited draft when safe undo is rejected",async()=>{
 logContent.mockResolvedValue({jobId:"job-source",content:"完整草稿"});editLog.mockRejectedValue(new Error("笔记已有其他修改"));
 await rendered([row("conflict","completed")],async host=>{
  await act(async()=>button(host,"编辑").click());
  await act(async()=>Array.from(host.querySelectorAll("button")).find(x=>x.textContent==="重新整理")!.click());
  expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("完整草稿");expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("其他修改"));
 });
});
it("loads a rejected record's full text for editing and offers a blank editor when the original was discarded",async()=>{
 const retained={...row("ai","filtered"),canEdit:true,code:"AI_FILTERED"};
 const missing={...row("missing-context","filtered"),jobId:null,canEdit:true,canForce:false,code:"CAPTURE_CONTEXT_REQUIRED"};
 const original="完整的测试原文".repeat(35);
 logContent.mockResolvedValueOnce({jobId:"job-ai",content:original}).mockResolvedValueOnce({jobId:null,content:""});
 editLog.mockResolvedValue({status:"queued"});
 await rendered([retained,missing],async host=>{
  const filteredTab=Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="记录状态"] button')).find(x=>x.textContent==="已过滤")!;
  await act(async()=>filteredTab.click());
  await act(async()=>button(host,"编辑后收集").click());
  expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(original);
  const named=(name:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>("textarea + div button")).find(x=>x.textContent===name)!;
  act(()=>named("取消").click());
  await act(async()=>button(host,"编辑后收集",1).click());
  const field=host.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(field.value).toBe("");
  expect(field.placeholder).toBe("粘贴或输入要收集的内容");
  expect(named("强制收集").disabled).toBe(true);
  act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,"服务：示例服务\n补充内容");field.dispatchEvent(new Event("input",{bubbles:true}));});
  await act(async()=>named("强制收集").click());
  expect(editLog).toHaveBeenCalledWith("missing-context",{jobId:null,requestId:expect.any(String),content:"服务：示例服务\n补充内容"});
  expect(forceLog).not.toHaveBeenCalled();
  expect(logs).toHaveBeenLastCalledWith(0,"all");
 });
});
it("does not submit a manually entered draft to a different account or server",async()=>{
 logContent.mockResolvedValue({jobId:"job-ai",content:"示例原文"});
 await rendered([{...row("ai","filtered"),canEdit:true}],async host=>{
  await act(async()=>button(host,"编辑后收集").click());
  scope.mockReturnValue("other.example:owner");
  await act(async()=>host.querySelector<HTMLButtonElement>("textarea + div button")!.click());
  expect(editLog).not.toHaveBeenCalled();
  expect(host.querySelector("textarea")).toBeNull();
  expect(toast.error).toHaveBeenCalledWith("账号或服务器已切换，请重试");
 });
});
it("opens the saved note and closes settings only after current permission succeeds",async()=>{
 const close=vi.fn(),note={id:"note-open",notebookId:"folder",workspaceId:null,isTrashed:0};getNote.mockResolvedValue(note);
 await rendered([row("open","completed")],async host=>{
  await act(async()=>button(host,"打开笔记").click());expect(getNote).toHaveBeenCalledWith("note-open");expect(navigate).toHaveBeenCalledWith("note-open");expect(close).toHaveBeenCalledWith(note);
 },close);
});
it("keeps settings open when the target note is unavailable",async()=>{
 const close=vi.fn();getNote.mockRejectedValue(new Error("笔记不存在或尚未同步"));
 await rendered([row("missing","completed")],async host=>{
  await act(async()=>button(host,"打开笔记").click());expect(close).not.toHaveBeenCalled();expect(navigate).not.toHaveBeenCalled();expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("尚未同步"));
 },close);
});
it("opens the server note when desktop has not downloaded it yet",async()=>{
 const external=vi.spyOn(window,"open").mockImplementation(()=>null);
 getNote.mockRejectedValue(Object.assign(new Error("尚未同步"),{status:404}));
 try{await rendered([row("remote","completed")],async host=>{
  await act(async()=>button(host,"打开笔记").click());
  expect(external).toHaveBeenCalledWith("https://nas.example/app/nowen-note-private/notes/note-remote","_blank","noopener,noreferrer");expect(navigate).not.toHaveBeenCalled();
 },undefined,"https://nas.example/app/nowen-note-private");}finally{external.mockRestore();}
});
it("retries a lost reorganization response with the same operation and preserves cancel",async()=>{
 logContent.mockResolvedValue({jobId:"job-source",content:"原文"});editLog.mockRejectedValueOnce(new Error("网络中断")).mockResolvedValueOnce({status:"queued"});
 await rendered([row("retry","completed")],async host=>{
  await act(async()=>button(host,"编辑").click());
  const submit=()=>Array.from(host.querySelectorAll("button")).find(x=>x.textContent==="重新整理")!;
  await act(async()=>submit().click());const first=editLog.mock.calls[0][1];
  await act(async()=>submit().click());expect(editLog.mock.calls[1][1]).toEqual(first);
  expect(undoLog).not.toHaveBeenCalled();
 });
});
it("filters on the server and resets pagination when changing record status",async()=>{
 await rendered([row("saved","completed")],async host=>{
  expect(logs).toHaveBeenLastCalledWith(0,"all");
  const filter=(name:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="记录状态"] button')).find(button=>button.textContent===name)!;
  logs.mockResolvedValue({items:[row("filtered","filtered")],hasMore:true});
  await act(async()=>filter("已过滤").click());expect(logs).toHaveBeenLastCalledWith(0,"filtered");
  await act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent==="下一页")!.click());expect(logs).toHaveBeenLastCalledWith(30,"filtered");
  logs.mockResolvedValue({items:[row("saved","completed")],hasMore:false});
  await act(async()=>filter("成功").click());expect(logs).toHaveBeenLastCalledWith(0,"completed");expect(filter("成功").getAttribute("aria-pressed")).toBe("true");
 });
});
