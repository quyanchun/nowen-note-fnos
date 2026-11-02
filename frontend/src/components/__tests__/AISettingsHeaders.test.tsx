import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aiProfiles } from "@/lib/aiProfiles";
import AISettingsPanel from "../AISettingsPanel";

vi.mock("@/components/SpeechSettingsPanel", () => ({ default: () => null }));
vi.mock("@/components/settings/PluginPromptPackSettingsSection", () => ({ default: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
const profile = { id: "p1", name: "测试渠道", provider: "custom", apiUrl: "https://gateway.example/v1", apiKey: "****1234", apiKeySet: true, customHeaders: { zhixing: "****" }, model: "qwen-plus", createdAt: "now", updatedAt: "now" };

beforeEach(() => {
  localStorage.setItem("i18nextLng", "zh-CN");
  vi.spyOn(aiProfiles, "list").mockResolvedValue({ profiles: [profile], activeProfileId: profile.id });
  vi.spyOn(aiProfiles, "proxyStatus").mockResolvedValue({ enabled: false, valid: true, message: "direct" });
  vi.spyOn(aiProfiles, "discoverModels").mockResolvedValue({ models: [{ id: "qwen-plus", name: "qwen-plus" }] });
  vi.spyOn(aiProfiles, "update").mockResolvedValue({ profile, activeProfileId: profile.id });
  vi.spyOn(aiProfiles, "testDraft").mockResolvedValue({ success: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); localStorage.clear(); });
function button(text: string) { return Array.from(document.querySelectorAll("button")).find(item => item.textContent === text)!; }
function fill(value: string) {
  const field = document.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("loads masked headers and saves edited JSON without submitting a model", async () => {
  await act(async () => root.render(<AISettingsPanel />));
  await act(async () => button("编辑").click());
  expect(JSON.parse(document.querySelector("textarea")!.value)).toEqual({ zhixing: "****" });
  fill('{"zhixing":"Bearer new-synthetic-token"}');
  await act(async () => button("保存渠道").click());
  expect(aiProfiles.update).toHaveBeenCalledWith("p1", expect.objectContaining({ customHeaders: '{"zhixing":"Bearer new-synthetic-token"}' }));
  expect(vi.mocked(aiProfiles.update).mock.calls[0][1]).not.toHaveProperty("model");
  expect(aiProfiles.testDraft).not.toHaveBeenCalled();
});

it("sends an explicit empty object when the user clears saved custom headers", async () => {
  await act(async () => root.render(<AISettingsPanel />));
  await act(async () => button("编辑").click());
  fill("{}");
  await act(async () => button("保存渠道").click());
  expect(aiProfiles.update).toHaveBeenCalledWith("p1", expect.objectContaining({ customHeaders: "{}" }));
});


it("clears custom credentials when changing provider", async () => {
  await act(async () => root.render(<AISettingsPanel />));
  await act(async () => button("编辑").click());
  const provider = document.querySelector("select[data-app-select-native]")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(provider, "ollama");
    provider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(document.querySelector("textarea")!.value).toBe("{}");
});


it("adds a channel without selecting or activating a model", async () => {
  vi.spyOn(aiProfiles, "create").mockResolvedValue({ profile: { ...profile, id: "new", model: "" }, activeProfileId: "p1" });
  vi.spyOn(aiProfiles, "activate");
  await act(async () => root.render(<AISettingsPanel />));
  expect(host.textContent).not.toContain("默认聊天模型");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="添加渠道"]')!.click());
  await act(async () => button("保存渠道").click());
  expect(aiProfiles.create).toHaveBeenCalledWith(expect.not.objectContaining({ model: expect.anything() }), false);
  expect(aiProfiles.activate).not.toHaveBeenCalled();
});


it("shows a channel list with explicit actions and opens read-only details on demand", async () => {
  await act(async () => root.render(<AISettingsPanel />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector("input")).toBeNull();
  expect(host.querySelector("textarea")).toBeNull();
  expect(button("详情")).toBeTruthy();
  expect(button("编辑")).toBeTruthy();
  await act(async () => button("详情").click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(profile.apiUrl);
  expect(dialog.querySelector("input")).toBeNull();
  expect(dialog.textContent).toContain("****");
  expect(dialog.textContent).not.toContain(profile.model);
  act(() => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("opens editing from details without submitting the channel", async () => {
  await act(async () => root.render(<AISettingsPanel />));
  await act(async () => button("详情").click());
  await act(async () => button("编辑渠道").click());
  expect(document.querySelector('[role="dialog"] input')).not.toBeNull();
  expect(button("保存渠道")).toBeTruthy();
  expect(aiProfiles.update).not.toHaveBeenCalled();
});
