import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api", () => ({ getServerUrl: () => "" }));
vi.mock("@/lib/serverUrl", () => ({ getResolvedApiBaseUrl: () => "/api" }));
vi.mock("@/lib/authSession", () => ({ storeAuthTokens: vi.fn() }));
import FnosWebLogin from "../FnosWebLogin";
import { storeAuthTokens } from "@/lib/authSession";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
let onLogin: ReturnType<typeof vi.fn>, onAvailable: ReturnType<typeof vi.fn>;
let result: any, popup: any, fetchMock: ReturnType<typeof vi.fn<any[], Promise<Response>>>;
const pending = { id: "a".repeat(43), proof: "b".repeat(43), expiresIn: 300, portalUrl: "http://localhost/" };
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  onLogin = vi.fn(); onAvailable = vi.fn(); result = { status: "waiting" };
  popup = { closed: false, close: vi.fn(), location: { replace: vi.fn() } };
  vi.spyOn(window, "open").mockReturnValue(popup);
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/options")) return Response.json({ enabled: true, webOrigin: window.location.origin, portalOrigin: "http://localhost" });
    if (url.endsWith("/start")) return Response.json(pending);
    if (url.endsWith("/cancel")) return Response.json({ cancelled: true });
    return Response.json(result);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const render = () => act(async () => root.render(<FnosWebLogin onLogin={onLogin} onAvailable={onAvailable} />));
const button = (text: string) => Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes(text))!;

it("offers NAS authorization only on the configured independent web origin", async () => {
  await render(); expect(onAvailable).toHaveBeenCalledWith(true); expect(host.textContent).toContain("飞牛授权登录");
});
it("does not add NAS controls to ordinary or differently hosted deployments", async () => {
  fetchMock.mockResolvedValue(Response.json({ enabled: true, webOrigin: "http://other.test:3504" }));
  await render(); expect(host.textContent).toBe(""); expect(onAvailable).toHaveBeenCalledWith(false);
});
it("opens the normal NAS login flow and polls with credentials kept out of the URL", async () => {
  await render(); await act(async () => button("飞牛授权登录").click());
  expect(popup.location.replace).toHaveBeenCalledWith(pending.portalUrl);
  const poll = fetchMock.mock.calls.find(call => call[0].endsWith("/poll"));
  expect(poll?.[0]).not.toContain(pending.proof);
  expect(JSON.parse(poll?.[1].body)).toMatchObject({ id: pending.id, proof: pending.proof });
  expect(host.textContent).toContain("等待飞牛登录"); expect(onLogin).not.toHaveBeenCalled();
});
it("completes only after an approved login and stores both session tokens", async () => {
  await render(); result = { status: "connected", login: { token: "access", refreshToken: "refresh", user: { id: "nas-owner" } } };
  await act(async () => button("飞牛授权登录").click());
  expect(storeAuthTokens).toHaveBeenCalledWith({ token: "access", refreshToken: "refresh" });
  expect(onLogin).toHaveBeenCalledWith("access", { id: "nas-owner" }); expect(popup.close).toHaveBeenCalled();
  expect(popup.location.replace).not.toHaveBeenCalled();
});
it("cancel invalidates pending approval without logging in", async () => {
  await render(); await act(async () => button("飞牛授权登录").click()); await act(async () => button("取消").click());
  expect(fetchMock.mock.calls.some(call => call[0].endsWith("/cancel"))).toBe(true);
  await act(async () => vi.advanceTimersByTime(5000)); expect(onLogin).not.toHaveBeenCalled();
  expect(host.textContent).toContain("飞牛授权登录");
});
it("shows an explicit retry message for blocked popups and failed approvals", async () => {
  await render(); vi.mocked(window.open).mockReturnValueOnce(null);
  await act(async () => button("飞牛授权登录").click()); expect(host.querySelector('[role="alert"]')?.textContent).toContain("允许弹窗");
  result = { status: "connected", login: {} };
  await act(async () => button("飞牛授权登录").click()); expect(host.querySelector('[role="alert"]')?.textContent).toContain("结果无效");
  expect(onLogin).not.toHaveBeenCalled();
});
it("closing the login page cancels approval and stops polling", async () => {
  await render(); await act(async () => button("飞牛授权登录").click());
  await act(async () => root.render(<div>closed</div>));
  expect(popup.close).toHaveBeenCalled(); const count = fetchMock.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(6000)); expect(fetchMock.mock.calls.length).toBe(count); expect(onLogin).not.toHaveBeenCalled();
});

it("uses the configured public NAS origin and a browser-bound callback without forwarding cookies", async () => {
  const a={...pending,portalUrl:"https://nas.test/",authorizeUrl:"https://nas.test/app/nowen-note-private/api/auth/web/authorize?requestId="+pending.id};
  fetchMock.mockImplementation(async(url:string)=>url.includes("/options")?Response.json({enabled:true,webOrigin:window.location.origin,portalOrigin:"https://nas.test"}):url.endsWith("/start")?Response.json(a):Response.json(result));
  await render(); await act(async()=>button("飞牛授权登录").click());
  expect(popup.location.replace).toHaveBeenCalledWith(a.portalUrl);
  expect(host.querySelector("iframe")?.src).toBe(a.authorizeUrl);
  expect(host.querySelector("iframe")?.src).not.toContain(a.proof);
  await act(async()=>vi.advanceTimersByTime(3100));
  expect(host.querySelector("iframe")?.src).toContain("&probe=");
  await act(async()=>button("已登录，继续授权").click()); expect(popup.location.replace).toHaveBeenLastCalledWith(a.authorizeUrl);
});
it("rejects a portal response outside its administrator-configured pair",async()=>{
  fetchMock.mockImplementation(async(url:string)=>url.includes("/options")?Response.json({enabled:true,webOrigin:window.location.origin,portalOrigin:"https://nas.test"}):Response.json({...pending,portalUrl:"https://evil.test/"}));
  await render();await act(async()=>button("飞牛授权登录").click());expect(host.querySelector('[role="alert"]')?.textContent).toContain("地址不匹配");expect(popup.location.replace).not.toHaveBeenCalled();
});
