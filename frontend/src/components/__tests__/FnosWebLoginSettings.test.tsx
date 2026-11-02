import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("@/lib/api",()=>({getBaseUrl:()=>"/api"}));
vi.mock("@/lib/authSession",()=>({getAccessToken:()=>"test-token",fetchWithAuthRefresh:vi.fn()}));
import {fetchWithAuthRefresh} from "@/lib/authSession";
import FnosWebLoginSettings from "../settings/FnosWebLoginSettings";
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let host:HTMLDivElement,root:Root;
const entries=[{name:"局域网",webOrigin:"http://nas.test:3504",portalOrigin:"http://nas.test"}];
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);vi.mocked(fetchWithAuthRefresh).mockImplementation(async()=>Response.json({available:true,entries}));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
const render=()=>act(async()=>root.render(<FnosWebLoginSettings/>));
const click=(text:string)=>act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.includes(text))!.click());
it("shows existing server pairs and saves explicit changes using authenticated requests",async()=>{
 await render();expect((host.querySelector('[aria-label="笔记访问地址 1"]') as HTMLInputElement).value).toBe(entries[0].webOrigin);
 await click("添加入口");expect(host.querySelector('[aria-label="NAS 授权地址 2"]')).not.toBeNull();
 await click("保存登录入口");const call=vi.mocked(fetchWithAuthRefresh).mock.calls.at(-1)!;expect(call[0]).toBe("/api/settings/fnos-web-login");expect(call[1]?.method).toBe("PUT");expect(JSON.parse(String(call[1]?.body)).entries).toHaveLength(2);expect(host.textContent).toContain("登录入口已保存");
});
it("reports rejected settings without replacing the form",async()=>{
 await render();vi.mocked(fetchWithAuthRefresh).mockResolvedValue(Response.json({error:"笔记地址不能重复"},{status:400}));await click("保存登录入口");expect(host.querySelector('[role="alert"]')?.textContent).toContain("不能重复");expect(host.querySelector('input')?.value).toBe("局域网");
});
it("does not show NAS configuration on ordinary deployments",async()=>{vi.mocked(fetchWithAuthRefresh).mockResolvedValue(Response.json({available:false,entries:[]}));await render();expect(host.textContent).toBe("");});
