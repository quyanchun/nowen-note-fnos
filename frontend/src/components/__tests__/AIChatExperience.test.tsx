import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import type {ReliableDiagnostics} from "@/lib/aiReliable";
const m=vi.hoisted(()=>({list:vi.fn(),create:vi.fn(),history:vi.fn(),append:vi.fn(),update:vi.fn(),ask:vi.fn()}));
vi.mock("react-i18next",()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock("@/store/AppContext",()=>({useApp:()=>({state:{notebooks:[]}})}));
vi.mock("@/components/AIKnowledgeScopePicker",()=>({default:()=> <span>当前空间</span>}));
vi.mock("@/components/PluginPromptPicker",()=>({default:()=>null}));
vi.mock("@/lib/api",()=>({api:{getKnowledgeStats:async()=>null,aiConversations:{list:m.list,create:m.create,update:m.update},getAiChatHistory:m.history,appendAiChatHistory:m.append},resolveAttachmentUrl:(url:string)=>url}));
import AIChatPanel from "../AIChatPanel";
import AIChatReliabilityShell from "../AIChatReliabilityShell";
vi.mock("@/lib/aiReliable",()=>({reliableAsk:async(request:any,handlers:any)=>m.ask(request.question,request.history,handlers.onChunk,handlers.onReferences,request,handlers.onDiagnostics)}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root,host:HTMLDivElement;
const summary={id:"old",title:"旧对话",archived:false,createdAt:"now",updatedAt:"now",messageCount:2,lastMessage:"旧内容",lastRole:"assistant"};
const diagnostics=(model:string):ReliableDiagnostics=>({version:1,requestId:"fixture",provider:"fixture",model,apiHost:null,embeddingModel:"embedding",redacted:[],mode:"knowledge",generatedAt:new Date().toISOString(),scope:{workspaceId:null,notebookId:null,includeChildren:true,resolvedNotebookCount:null,currentNoteId:null},context:{budgetChars:100,originalChars:4,includedChars:4,omittedChars:0,truncated:false,strategy:"full",segments:[]},index:{lastIndexedAt:"now",newestSourceUpdatedAt:null,pending:0,processing:0,failed:0,totalNotes:1,indexedNotes:1,totalAttachments:0,indexedAttachments:0,configured:true,vectorAvailable:true,vectorDimension:1024,stale:false},hits:[],retrieval:["fts"]});
beforeEach(()=>{
 vi.clearAllMocks();m.list.mockResolvedValue({conversations:[summary]});m.create.mockResolvedValue({conversation:{...summary,id:"fresh",title:""}});m.history.mockResolvedValue({messages:[{id:"old-a",role:"assistant",content:"旧回答"}]});m.append.mockResolvedValue({ok:true});m.update.mockResolvedValue({});m.ask.mockImplementation(async(_q,_h,chunk,refs,_options,details)=>{details?.(diagnostics("first-model"));refs?.([{id:"source",title:"参考资料"}]);chunk?.("新回答");return "新回答";});
 Element.prototype.scrollIntoView=vi.fn();HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const button=(title:string)=>host.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;
async function render(initial=true){await act(async()=>root.render(<AIChatPanel onClose={()=>{}} initialQuestion={initial?{id:"request",question:"首页提问"}:undefined} ask={m.ask} />));}
it("opens a fresh conversation for the home question exactly once without loading previous messages",async()=>{
 await render();expect(m.create).toHaveBeenCalledTimes(1);expect(m.history).not.toHaveBeenCalled();expect(m.ask.mock.calls[0][0]).toBe("首页提问");expect(m.ask.mock.calls[0][1]).toEqual([]);expect(m.append).toHaveBeenCalledWith(expect.objectContaining({conversationId:"fresh",role:"user",content:"首页提问"}));expect(host.textContent).not.toContain("旧回答");expect(host.textContent).toContain("新回答");
 await act(async()=>root.render(<AIChatPanel onClose={()=>{}} initialQuestion={{id:"request",question:"首页提问"}} ask={m.ask}/>));expect(m.ask).toHaveBeenCalledTimes(1);
});
it("keeps the question and does not fall back to an old conversation when creation fails",async()=>{
 m.create.mockRejectedValue(new Error("offline"));await render();expect(m.ask).not.toHaveBeenCalled();expect(m.append).not.toHaveBeenCalled();expect(host.querySelector("textarea")!.value).toBe("首页提问");expect(host.textContent).toContain("无法新建对话");
});
it("details belong to the clicked answer, remain hidden by default and show its sources",async()=>{
 await render();expect(document.querySelector("dialog")).toBeNull();expect(host.textContent).not.toContain("参考资料");await act(async()=>button("回答详情").click());expect(document.querySelector("dialog")?.textContent).toContain("first-model");expect(document.querySelector("dialog")?.textContent).toContain("参考资料");await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="关闭回答详情"]')!.click());expect(document.querySelector("dialog")).toBeNull();
});
it("normal entry still restores the recent conversation and offers sources for historical replies",async()=>{
 await render(false);expect(m.create).not.toHaveBeenCalled();expect(m.history).toHaveBeenCalledWith(100,"old");expect(host.textContent).toContain("旧回答");await act(async()=>button("回答详情").click());expect(document.querySelector("dialog")?.textContent).toContain("未记录检索详情");
});
it("keeps model selection beside knowledge scope rather than in the header",async()=>{
 await render(false);expect(host.querySelector('[data-ai-chat-model-host]')?.parentElement?.textContent).toContain("当前空间");expect(host.querySelector('[data-ai-chat-header] [data-ai-chat-model-host]')).toBeNull();
});

it("keeps details tied to each answer instead of showing the latest diagnostics for all replies",async()=>{
 await render();m.ask.mockImplementationOnce(async(_q,_h,chunk,_refs,_options,details)=>{details?.(diagnostics("second-model"));chunk?.("第二次回答");return "第二次回答";});
 const input=host.querySelector("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"第二个问题");input.dispatchEvent(new Event("input",{bubbles:true}));});await act(async()=>button("aiChatUi.send").click());
 const buttons=host.querySelectorAll<HTMLButtonElement>('button[title="回答详情"]');expect(buttons.length).toBe(2);await act(async()=>buttons[0].click());expect(document.querySelector("dialog")?.textContent).toContain("first-model");expect(document.querySelector("dialog")?.textContent).not.toContain("second-model");await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="关闭回答详情"]')!.click());await act(async()=>buttons[1].click());expect(document.querySelector("dialog")?.textContent).toContain("second-model");
});
it("reliable chat has no persistent index/context header and still forwards diagnostics to the answer",async()=>{
 await act(async()=>root.render(<AIChatReliabilityShell onClose={()=>{}} initialQuestion={{id:"shell",question:"检索问题"}}/>));expect(host.textContent).not.toContain("索引已同步");expect(host.textContent).not.toContain("上下文详情");expect(host.textContent).not.toContain("更多范围");expect(host.querySelector("details summary")).toBeNull();await act(async()=>button("回答详情").click());expect(document.querySelector("dialog")?.textContent).toContain("first-model");
});
