import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aiProfiles } from "@/lib/aiProfiles";
import AIModelSettingsPanel from "../AIModelSettingsPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
const profile = { id: "channel", name: "渠道", provider: "custom", apiUrl: "https://channel.test/v1", apiKey: "****", apiKeySet: true, customHeaders: { zhixing: "****" }, model: "legacy-chat", createdAt: "now", updatedAt: "now" };
beforeEach(() => {
  localStorage.setItem("i18nextLng", "zh-CN");
  vi.spyOn(aiProfiles, "list").mockResolvedValue({ profiles: [profile], activeProfileId: profile.id });
  vi.spyOn(aiProfiles, "modelSettings").mockImplementation(async purpose => ({ profileId: profile.id, model: purpose === "chat" ? "chat-model" : "vision-model" }));
  vi.spyOn(aiProfiles, "saveModelSettings").mockImplementation(async (_purpose, selection) => selection);
  vi.spyOn(aiProfiles, "testDraft").mockResolvedValue({ success: true });
  vi.spyOn(aiProfiles, "testMultimodal").mockResolvedValue({ success: true });
  vi.spyOn(aiProfiles, "discoverModels").mockResolvedValue({ models: [{ id: "available", name: "Available model" }] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); localStorage.clear(); });
function button(text: string) { return Array.from(host.querySelectorAll("button")).find(item => item.textContent === text)!; }
function fill(value: string) {
  const field = host.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("saves multimodal selection independently and discovers the chosen channel's catalog", async () => {
  await act(async () => root.render(<AIModelSettingsPanel purpose="multimodal" />));
  expect(host.querySelector("input")!.value).toBe("vision-model");
  fill("new-vision-model");
  await act(async () => button("刷新模型").click());
  expect(aiProfiles.discoverModels).toHaveBeenCalledWith(profile, "channel", "all");
  expect(host.querySelector('select[aria-label$="列表"] option:not([value=""])')?.getAttribute("value")).toBe("available");
  await act(async () => button("保存配置").click());
  expect(aiProfiles.saveModelSettings).toHaveBeenCalledWith("multimodal", { profileId: "channel", model: "new-vision-model" });
  expect(aiProfiles.testDraft).not.toHaveBeenCalled();
});

it("tests an unsaved chat model using the channel's masked credentials without saving it", async () => {
  await act(async () => root.render(<AIModelSettingsPanel purpose="chat" />));
  fill("draft-chat");
  await act(async () => button("测试连接").click());
  expect(aiProfiles.testDraft).toHaveBeenCalledWith({ ...profile, model: "draft-chat" }, "channel");
  expect(aiProfiles.saveModelSettings).not.toHaveBeenCalled();
});

it("preserves an unsaved model when channels refresh and blocks deleted channel selections", async () => {
  await act(async () => root.render(<AIModelSettingsPanel purpose="chat" />));
  fill("unsaved-chat");
  vi.mocked(aiProfiles.list).mockResolvedValue({ profiles: [], activeProfileId: "" });
  await act(async () => { window.dispatchEvent(new Event("nowen:ai-profiles-changed")); });
  expect(host.querySelector("input")!.value).toBe("unsaved-chat");
  expect(button("保存配置").disabled).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("已删除");
});

it("ignores a late catalog response after the selected channel changes", async () => {
  let resolve!: (value: { models: { id: string; name: string }[] }) => void;
  vi.mocked(aiProfiles.discoverModels).mockReturnValue(new Promise(done => { resolve = done; }));
  await act(async () => root.render(<AIModelSettingsPanel purpose="chat" />));
  act(() => button("刷新模型").click());
  act(() => {
    const select = host.querySelector("select")!;
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => resolve({ models: [{ id: "stale", name: "Stale" }] }));
  expect(host.querySelector('select[aria-label$="列表"] option:not([value=""])')).toBeNull();
  expect(host.querySelector("input")!.value).toBe("");
});


it("keeps an unsaved model and reports a failed save", async () => {
  vi.mocked(aiProfiles.saveModelSettings).mockRejectedValue(new Error("Server unavailable"));
  await act(async () => root.render(<AIModelSettingsPanel purpose="multimodal" />));
  fill("keep-draft");
  await act(async () => button("保存配置").click());
  expect(host.querySelector("input")!.value).toBe("keep-draft");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Server unavailable");
});

it("does not allow clearing settings after an initial load failure", async () => {
  vi.mocked(aiProfiles.modelSettings).mockRejectedValue(new Error("Load failed"));
  await act(async () => root.render(<AIModelSettingsPanel purpose="multimodal" />));
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Load failed");
});


it("tests the unsaved multimodal model without saving or activating it", async () => {
  await act(async () => root.render(<AIModelSettingsPanel purpose="multimodal" />));
  fill("vision-unsaved");
  await act(async () => button("测试连接").click());
  expect(aiProfiles.testMultimodal).toHaveBeenCalledWith({ profileId: "channel", model: "vision-unsaved" });
  expect(aiProfiles.saveModelSettings).not.toHaveBeenCalled();
  expect(aiProfiles.testDraft).not.toHaveBeenCalled();
});

it("automatically discovers a catalog while still accepting a custom name and dropdown selection",async()=>{
 await act(async()=>root.render(<AIModelSettingsPanel purpose="chat"/>));expect(aiProfiles.discoverModels).toHaveBeenCalledWith(profile,"channel","chat");
 const select=host.querySelector<HTMLSelectElement>('select[aria-label="模型列表"]')!;await act(async()=>{select.value="available";select.dispatchEvent(new Event("change",{bubbles:true}));});expect(host.querySelector("input")!.value).toBe("available");fill("not-in-catalog");await act(async()=>button("保存配置").click());expect(aiProfiles.saveModelSettings).toHaveBeenCalledWith("chat",{profileId:"channel",model:"not-in-catalog"});
});
it("keeps manual input usable when automatic discovery fails",async()=>{
 vi.mocked(aiProfiles.discoverModels).mockRejectedValue(new Error("No catalog"));await act(async()=>root.render(<AIModelSettingsPanel purpose="chat"/>));fill("manual-model");await act(async()=>button("保存配置").click());expect(aiProfiles.saveModelSettings).toHaveBeenCalledWith("chat",{profileId:"channel",model:"manual-model"});
});
