import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {it,expect,vi,beforeEach,afterEach} from "vitest";
import SyncReviewCenter from "../settings/SyncReviewCenter";
const m=vi.hoisted(()=>({read:vi.fn(),smart:vi.fn(),apply:vi.fn(),undo:vi.fn(),versions:vi.fn(),recover:vi.fn()}));
vi.mock("@/lib/syncLocalApi",()=>({fetchSyncReview:m.read,runSmartSyncReview:m.smart,applySyncReviewPlan:m.apply,undoSyncReview:m.undo,fetchSyncReviewVersions:m.versions,recoverSyncReviewCopy:m.recover}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root,host:HTMLElement;
const item={id:"opaque-internal-id",title:"周末备份计划",type:"note",state:"content",reason:"两端新增了不同安排，可以合并并撤销",protected:false,
  local:{exists:true,text:"周五备份",location:"工作 / 运维",updatedAt:"2026-10-30 10:00"},remote:{exists:true,text:"周六验证",location:"工作 / 运维",updatedAt:"2026-10-30 10:01"}};
beforeEach(()=>{vi.resetAllMocks();m.read.mockResolvedValue({items:[item],consistent:99,total:100,history:[]});host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=()=>act(async()=>root.render(<SyncReviewCenter/>));
const button=(s:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent?.trim()===s)!;
const click=(s:string)=>act(async()=>button(s).click());
it("names the content and compares real text and locations without exposing internal IDs",async()=>{
 await render();expect(host.textContent).toContain("周末备份计划");expect(host.textContent).not.toContain(item.id);expect(host.textContent).toContain("99 条历史记录已一致");
 await click("查看具体差异");expect(host.textContent).toContain("周五备份");expect(host.textContent).toContain("周六验证");expect(host.textContent).toContain("工作 / 运维");
});
it("failed actions remain retryable on the same item (DCC-003)",async()=>{
 m.smart.mockRejectedValueOnce(new Error("原目录尚未就绪，后台同步后可重试")).mockResolvedValueOnce({processed:1});
 await render();await click("智能处理");expect(host.querySelector('[role="alert"]')?.textContent).toContain("后台同步后可重试");expect(button("智能处理").disabled).toBe(false);
 await click("智能处理");expect(m.smart).toHaveBeenCalledTimes(2);expect(host.textContent).toContain("智能处理已完成");
});
it("can preview before applying and keeps an accessible, actual undo action",async()=>{
 m.smart.mockResolvedValue({plan:{id:"plan",title:item.title,reason:"保留两端安排",content:"周五备份\n周六验证"}});m.apply.mockResolvedValue({applied:true});
 await render();await click("先看合并建议");expect(host.querySelector('[role="dialog"]')?.textContent).toContain("周五备份");
 await click("按建议合并");expect(m.apply).toHaveBeenCalledWith("plan");
 m.read.mockResolvedValue({items:[],consistent:0,total:0,history:[{id:"done",title:item.title,kind:"ai-merge",reason:"保留两端安排",state:"applied",createdAt:"2026-10-30"}]});
 await act(async()=>root.render(<SyncReviewCenter refreshKey={1}/>));
 const tab=[...host.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(b=>b.textContent?.includes("处理记录"))!;await act(async()=>tab.click());
 m.undo.mockRejectedValueOnce(new Error("处理后又有新编辑"));await click("撤销这次处理");expect(m.undo).toHaveBeenCalledWith("done");expect(host.textContent).toContain("处理后又有新编辑");expect(button("撤销这次处理").disabled).toBe(false);
 m.recover.mockResolvedValue({noteId:"recovered"});await click("取回原文副本");expect(m.recover).toHaveBeenCalledWith("done");expect(host.textContent).toContain("已将处理前原文另存为笔记");
});
