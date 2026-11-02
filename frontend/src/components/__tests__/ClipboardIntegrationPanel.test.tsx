import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ClipboardIntegrationPanel from "../settings/ClipboardIntegrationPanel";
import { clipboardIntegrationApi } from "@/lib/clipboardIntegration";
import { copyText } from "@/lib/clipboard";
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:"zh-CN"}})}));
vi.mock("@/lib/api",()=>({api:{getNotebooks:vi.fn(async()=>[{id:"inbox",name:"收集箱",workspaceId:null},{id:"team",name:"团队目录",workspaceId:"team"}])}}));
vi.mock("@/lib/clipboard",()=>({copyText:vi.fn(async()=>true)}));
const initial={enabled:false,organize:true,notebookId:"",instruction:"保留数字和链接",systemPrompt:"",minChars:1,includeKeywords:[],excludeKeywords:[],excludeApps:[],excludeExtensions:[],filterFiles:true,filterImages:true,aiFilterEnabled:false,aiFilterPrompt:""};
vi.mock("@/lib/clipboardIntegration",async importOriginal=>({...await importOriginal<typeof import("@/lib/clipboardIntegration")>(),clipboardIntegrationApi:{get:vi.fn(),save:vi.fn(),token:vi.fn(),revoke:vi.fn(),logs:vi.fn()},clipboardSubmissionUrl:()=>"https://nas.example/app/nowen-note-private/api/clipboard/captures"}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root;let host:HTMLDivElement;
beforeEach(()=>{vi.mocked(clipboardIntegrationApi.get).mockResolvedValue({settings:{...initial},tokenSet:false});vi.mocked(clipboardIntegrationApi.token).mockResolvedValue({token:"ncc_private"});vi.mocked(clipboardIntegrationApi.save).mockImplementation(async settings=>({settings,tokenSet:true}));vi.mocked(clipboardIntegrationApi.revoke).mockResolvedValue({success:true});host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.clearAllMocks();});
const button=(name:string)=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.trim()===name)!;
async function render(){await act(async()=>root.render(<ClipboardIntegrationPanel/>));}
function input(element:HTMLInputElement|HTMLTextAreaElement,value:string){act(()=>{Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));});}
it("copies a dedicated token repeatedly without exposing it in the DOM or requiring a Cookie field",async()=>{await render();await act(async()=>button("复制 Token").click());expect(clipboardIntegrationApi.token).toHaveBeenCalledWith();expect(copyText).toHaveBeenCalledWith("ncc_private");expect(host.textContent).toContain("Token 已复制");expect(host.innerHTML).not.toContain("ncc_private");expect(host.textContent).not.toContain("Cookie");await act(async()=>button("复制 Token").click());expect(copyText).toHaveBeenCalledTimes(2);});
it("saves real filters and prompts, restricting directory choices to personal space",async()=>{await render();expect(host.querySelector('option[value="team"]')).toBeNull();act(()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());input(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="排除关键词"]')!," password \n\n验证码\n");input(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="系统 AI 提示词"]')!,"请使用简洁中文标题");await act(async()=>button("保存设置").click());expect(clipboardIntegrationApi.save).toHaveBeenCalledWith(expect.objectContaining({enabled:true,excludeKeywords:["password","验证码"],systemPrompt:"请使用简洁中文标题"}));expect(host.textContent).toContain("剪贴板设置已保存");});
it("revokes and rotates tokens with accurate feedback",async()=>{vi.mocked(clipboardIntegrationApi.get).mockResolvedValue({settings:{...initial,enabled:true},tokenSet:true});await render();await act(async()=>button("重置并复制").click());expect(clipboardIntegrationApi.token).toHaveBeenCalledWith(true);expect(host.textContent).toContain("旧 Token 已失效");await act(async()=>button("撤销 Token").click());expect(clipboardIntegrationApi.revoke).toHaveBeenCalledOnce();expect(button("撤销 Token").disabled).toBe(true);});
it("reports failed persistence and failed copy without claiming success",async()=>{await render();vi.mocked(clipboardIntegrationApi.save).mockRejectedValueOnce(new Error("服务不可用"));await act(async()=>button("保存设置").click());expect(host.querySelector('[role="alert"]')?.textContent).toBe("服务不可用");expect(host.textContent).not.toContain("设置已保存");vi.mocked(copyText).mockResolvedValueOnce(false);await act(async()=>button("复制 Token").click());expect(host.querySelector('[role="alert"]')?.textContent).toContain("复制失败");expect(host.textContent).not.toContain("Token 已复制");});
it("does not initialize after the panel is closed",async()=>{let finish:any;vi.mocked(clipboardIntegrationApi.get).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));act(()=>root.render(<ClipboardIntegrationPanel/>));act(()=>root.render(<div>已关闭</div>));await act(async()=>finish({settings:initial,tokenSet:false}));expect(host.textContent).toBe("已关闭");});

it("copies the advertised NAS capture endpoint instead of the authenticated page URL",async()=>{vi.mocked(clipboardIntegrationApi.get).mockResolvedValue({settings:initial,tokenSet:true,endpoint:"http://192.0.2.10:3503/api/clipboard/captures"});await render();await act(async()=>button("复制接口地址").click());expect(copyText).toHaveBeenCalledWith("http://192.0.2.10:3503/api/clipboard/captures");});

it("enables optional AI filtering with a dedicated prompt and retains it when switched off",async()=>{await render();const checkbox=Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(input=>input.parentElement?.textContent?.includes('启用 AI 过滤'))!;expect(host.querySelector('[aria-label="AI 过滤提示词"]')).toBeNull();act(()=>checkbox.click());await act(async()=>button("保存设置").click());expect(host.querySelector('[role="alert"]')?.textContent).toContain("请填写 AI 过滤提示词");expect(clipboardIntegrationApi.save).not.toHaveBeenCalled();input(host.querySelector<HTMLTextAreaElement>('[aria-label="AI 过滤提示词"]')!,"只收集技术资料");await act(async()=>button("保存设置").click());expect(clipboardIntegrationApi.save).toHaveBeenLastCalledWith(expect.objectContaining({aiFilterEnabled:true,aiFilterPrompt:"只收集技术资料"}));act(()=>checkbox.click());expect(host.querySelector('[aria-label="AI 过滤提示词"]')).toBeNull();await act(async()=>button("保存设置").click());expect(clipboardIntegrationApi.save).toHaveBeenLastCalledWith(expect.objectContaining({aiFilterEnabled:false,aiFilterPrompt:"只收集技术资料"}));});
it("uses compact fields and focusable help controls instead of persistent long hints",async()=>{await render();expect(host.querySelector('[data-testid="clipboard-settings-compact"]')).not.toBeNull();expect(host.querySelector('textarea[rows="5"]')).toBeNull();expect(host.querySelectorAll('button[aria-label$="说明"]').length).toBeGreaterThan(5);expect(host.querySelector('textarea[aria-label="排除关键词"]')?.getAttribute('rows')).toBe("2");});

it("shows NAS directly on desktop and never exposes a local relay",async()=>{
  vi.mocked(clipboardIntegrationApi.get).mockResolvedValue({settings:initial,tokenSet:true,delivery:"desktop",serverUrl:"https://nas.example/app/nowen-note-private",serverEndpoint:"https://nas.example/app/nowen-note-private/api/clipboard/captures",endpoint:"http://127.0.0.1:57892/api/desktop-clipboard/captures",folders:[{id:"remote-only",name:"NAS 资料"}]});
  await render();expect(host.querySelector('input[aria-label="NAS 服务地址"]')).toHaveProperty("value","https://nas.example/app/nowen-note-private/api/clipboard/captures");
  expect(host.textContent).not.toContain("请保持桌面客户端运行");expect(host.textContent).not.toContain("内容经现有 HTTPS");
  expect(host.querySelector('option[value="remote-only"]')).not.toBeNull();expect(host.querySelector('option[value="inbox"]')).toBeNull();
  expect(host.querySelector("details")).toBeNull();
  expect(host.innerHTML).not.toContain("127.0.0.1");
  await act(async()=>button("复制 NAS 地址").click());expect(copyText).toHaveBeenLastCalledWith("https://nas.example/app/nowen-note-private/api/clipboard/captures");
  expect(button("复制提交地址")).toBeUndefined();
});
it("NAS web exposes the same token copy and reset actions without requiring desktop copying",async()=>{
  vi.mocked(clipboardIntegrationApi.get).mockResolvedValue({settings:initial,tokenSet:true,delivery:"desktop-required",endpoint:"https://nas.example/app/nowen-note-private/api/clipboard/captures"});
  await render();expect(host.querySelector('input[aria-label="NAS 服务地址"]')).toHaveProperty("value","https://nas.example/app/nowen-note-private/api/clipboard/captures");
  await act(async()=>button("复制 Token").click());expect(clipboardIntegrationApi.token).toHaveBeenCalledWith();expect(copyText).toHaveBeenLastCalledWith("ncc_private");
  await act(async()=>button("重置并复制").click());expect(clipboardIntegrationApi.token).toHaveBeenCalledWith(true);expect(copyText).toHaveBeenLastCalledWith("ncc_private");
  expect(host.textContent).not.toContain("请在桌面客户端重新复制配置");expect(host.innerHTML).not.toContain("ncc_private");
});

const mode = (value:string) => act(()=>{const select=host.querySelector<HTMLSelectElement>('select[aria-label="集成方式"]')!;select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));});
it("switches standalone and NAS without changing the NAS endpoint or token",async()=>{
 vi.mocked(clipboardIntegrationApi.get).mockResolvedValue({settings:initial,tokenSet:true,delivery:"desktop",serverEndpoint:"https://nas.example/app/nowen-note-private/api/clipboard/captures",endpoint:"http://127.0.0.1:57892/api/desktop-clipboard/captures",folders:[]});
 await render();mode("standalone");input(host.querySelector<HTMLInputElement>('[aria-label="独立服务地址"]')!,"https://notes.example.net/prefix/");
 expect(host.querySelector<HTMLInputElement>('[aria-label="提交接口地址"]')!.value).toBe("https://notes.example.net/prefix/api/clipboard/captures");expect(host.querySelector("details")).toBeNull();
 await act(async()=>button("复制接口地址").click());expect(copyText).toHaveBeenLastCalledWith("https://notes.example.net/prefix/api/clipboard/captures");
 await act(async()=>button("保存设置").click());expect(clipboardIntegrationApi.save).toHaveBeenLastCalledWith(expect.objectContaining({integrationMode:"standalone",standaloneUrl:"https://notes.example.net/prefix/"}));
 mode("nas");expect(host.querySelector<HTMLInputElement>('[aria-label="NAS 服务地址"]')!.value).toBe("https://nas.example/app/nowen-note-private/api/clipboard/captures");expect(host.querySelector("details")).toBeNull();
 mode("standalone");expect(host.querySelector<HTMLInputElement>('[aria-label="独立服务地址"]')!.value).toBe("https://notes.example.net/prefix/");expect(clipboardIntegrationApi.token).not.toHaveBeenCalled();expect(clipboardIntegrationApi.revoke).not.toHaveBeenCalled();
});
it("restores standalone mode and rejects unsafe and gateway URLs before save",async()=>{
 vi.mocked(clipboardIntegrationApi.get).mockResolvedValue({settings:{...initial,integrationMode:"standalone",standaloneUrl:"https://notes.example.net"},tokenSet:true});await render();
 expect(host.querySelector<HTMLInputElement>('[aria-label="提交接口地址"]')!.value).toBe("https://notes.example.net/api/clipboard/captures");
 for(const url of ["https://user:secret@notes.example.net","javascript:alert(1)","https://notes.example.net?token=secret","https://nas.example/app/nowen-note-private"]){input(host.querySelector<HTMLInputElement>('[aria-label="独立服务地址"]')!,url);await act(async()=>button("保存设置").click());expect(host.querySelector('[role="alert"]')).not.toBeNull();}
 expect(clipboardIntegrationApi.save).not.toHaveBeenCalled();
});

it("shows service capture outcomes in the logs tab and preserves unsaved configuration",async()=>{
  vi.mocked(clipboardIntegrationApi.logs).mockResolvedValue({items:[{requestId:"r",jobId:"job",status:"failed",code:"CAPTURE_TARGET_FORBIDDEN",preview:"合成测试原文",sourceApp:"Editor",kind:"text",path:null,noteId:null,action:null,createdAt:"2026-10-28 12:00:00",updatedAt:null}],hasMore:false});
  await render();input(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="整理提示词"]')!,"未保存提示词");
  await act(async()=>button("日志").click());expect(clipboardIntegrationApi.logs).toHaveBeenCalledWith(0);expect(host.textContent).toContain("目标已删除");expect(host.textContent).toContain("合成测试原文");
  await act(async()=>button("配置").click());expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="整理提示词"]')?.value).toBe("未保存提示词");expect(clipboardIntegrationApi.save).not.toHaveBeenCalled();
});
it("shows log load failure and can refresh without pretending that no jobs exist",async()=>{
  vi.mocked(clipboardIntegrationApi.logs).mockRejectedValueOnce(new Error("日志暂不可用"));await render();await act(async()=>button("日志").click());expect(host.querySelector('[role="alert"]')?.textContent).toBe("日志暂不可用");
  vi.mocked(clipboardIntegrationApi.logs).mockResolvedValueOnce({items:[],hasMore:false});await act(async()=>button("刷新").click());expect(host.textContent).toContain("暂无收集记录");
});
