import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { voiceApi } from "@/lib/api";
import { aiProfiles } from "@/lib/aiProfiles";
import SpeechSettingsPanel from "../SpeechSettingsPanel";

vi.mock("react-i18next", async (original) => ({ ...await original<typeof import("react-i18next")>(), useTranslation: () => ({ t: (key: string) => key }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement; let root: Root;
const legacy = { apiUrl: "https://speech-only.example/v1", model: "whisper-1", language: null, apiKeySet: true, configured: true };
const profile = { id: "channel", name: "测试渠道", provider: "custom", apiUrl: "https://channel.example/v1", apiKey: "****", apiKeySet: true, customHeaders: { zhixing: "****" }, model: "chat-only", createdAt: "now", updatedAt: "now" };
beforeEach(() => {
  vi.spyOn(voiceApi, "settings").mockResolvedValue({ ...legacy });
  vi.spyOn(aiProfiles, "discoverModels").mockResolvedValue({models:[]});
  vi.spyOn(aiProfiles, "list").mockResolvedValue({ profiles: [profile], activeProfileId: profile.id });
  vi.spyOn(voiceApi, "saveSettings").mockResolvedValue({ ...legacy, source: "profile", profileId: profile.id });
  vi.spyOn(voiceApi, "test").mockResolvedValue({ success: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
function button(key: string) { return Array.from(host.querySelectorAll("button")).find(item => item.textContent === key)!; }
function selectSource(value: string) { act(() => {
 const field = host.querySelector("select")!;
 Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(field, value);
 field.dispatchEvent(new Event("change", { bubbles: true }));
}); }


it("keeps legacy standalone settings and lets speech reference a saved channel without copying secrets or chat model", async () => {
  await act(async () => root.render(<SpeechSettingsPanel />));
  expect(host.querySelector<HTMLInputElement>('input[placeholder="https://api.openai.com/v1"]')?.value).toBe(legacy.apiUrl);
  await act(async()=>selectSource("profile:channel"));
  expect(host.querySelector("select")?.value).toBe("profile:" + profile.id);
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(host.textContent).toContain(profile.name);
  await act(async () => button("voice.test").click());
  expect(voiceApi.test).toHaveBeenCalledWith({ source: "profile", profileId: "channel", model: "whisper-1", language: null });
  expect(voiceApi.saveSettings).not.toHaveBeenCalled();
  await act(async () => button("voice.save").click());
  expect(voiceApi.saveSettings).toHaveBeenCalledWith({ source: "profile", profileId: "channel", model: "whisper-1", language: null });
});

it("supports masked standalone Headers and explicit clearing", async () => {
  vi.mocked(voiceApi.settings).mockResolvedValue({ ...legacy, source: "custom", customHeaders: { zhixing: "****" } });
  await act(async () => root.render(<SpeechSettingsPanel />));
  const area = host.querySelector("textarea")!;
  expect(JSON.parse(area.value)).toEqual({ zhixing: "****" });
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "{}");
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("voice.save").click());
  expect(voiceApi.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ source: "custom", apiUrl: legacy.apiUrl, customHeaders: "{}" }));
});

it("refreshes channel metadata without replacing an unsaved speech model", async () => {
  await act(async () => root.render(<SpeechSettingsPanel />));
  const model = host.querySelector<HTMLInputElement>('input[placeholder="whisper-1"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(model, "speech-unsaved");
    model.dispatchEvent(new Event("input", { bubbles: true }));
  });
  vi.mocked(aiProfiles.list).mockResolvedValue({ profiles: [{ ...profile, name: "新渠道名" }], activeProfileId: profile.id });
  await act(async () => { window.dispatchEvent(new Event("nowen:ai-profiles-changed")); });
  expect(model.value).toBe("speech-unsaved");
  await act(async()=>selectSource("chat"));
  expect(host.textContent).toContain("新渠道名");
});


it("lists models from the selected speech channel without replacing the current model", async () => {
  vi.spyOn(aiProfiles, "discoverModels").mockResolvedValue({ models: [{ id: "speech-new", name: "Speech new" }] });
  await act(async () => root.render(<SpeechSettingsPanel />));
  await act(async()=>selectSource("profile:channel"));
  await act(async () => button("刷新模型").click());
  expect(aiProfiles.discoverModels).toHaveBeenCalledWith(profile, "channel", "all");
  expect(host.querySelector<HTMLInputElement>('input[placeholder="whisper-1"]')!.value).toBe("whisper-1");
  act(() => {
    const model = host.querySelector<HTMLInputElement>('input[placeholder="whisper-1"]')!;
    expect(host.querySelector('select[aria-label$="列表"] option:not([value=""])')?.getAttribute('value')).toBe('speech-new');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(model, "speech-new");
    model.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("voice.save").click());
  expect(voiceApi.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ model: "speech-new", profileId: "channel" }));
});
