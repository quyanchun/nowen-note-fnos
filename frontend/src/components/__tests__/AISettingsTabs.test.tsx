import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AISettingsReliabilityShell from "../AISettingsReliabilityShell";
import { aiProfiles } from "@/lib/aiProfiles";

vi.mock("../AISettingsPanel", () => ({ default: () => <section aria-label="厂商渠道管理">厂商渠道管理</section> }));
vi.mock("../EmbeddingSettingsPanel", () => ({ default: () => <input aria-label="Embedding 模型" /> }));
vi.mock("../SpeechSettingsPanel", () => ({ default: () => <input aria-label="声音模型" /> }));
vi.mock("../settings/PluginPromptPackSettingsSection", () => ({ default: () => null }));
vi.mock("@/lib/aiReliable", () => ({ getReliableAIStatus: async () => ({ enabled: true, provider: "custom", model: "chat-current", embeddingModel: "bge-m3", index: { pending: 0, processing: 0, totalNotes: 28, indexedNotes: 25, configured: true, vectorAvailable: true, vectorState: "ready", vectorDimension: 1024, stale: false } }), setReliableAIEnabled: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  localStorage.setItem("i18nextLng", "zh-CN");
  vi.spyOn(aiProfiles, "list").mockResolvedValue({ profiles: [], activeProfileId: "" });
  vi.spyOn(aiProfiles, "modelSettings").mockResolvedValue({ profileId: "", model: "" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); localStorage.clear(); });
function tab(name: string) { return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(item => item.textContent === name)!; }
function visiblePanel() { return host.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!; }

it("places channels above four model tabs and shows exactly one panel", async () => {
  await act(async () => root.render(<AISettingsReliabilityShell />));
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(4);
  expect(visiblePanel().id).toBe("ai-model-panel-chat");
  await act(async () => tab("多模态").click());
  expect(host.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
  expect(visiblePanel().id).toBe("ai-model-panel-multimodal");
  expect(tab("多模态").getAttribute("aria-selected")).toBe("true");
  expect(host.textContent).not.toContain("关闭后会清空");
  const overview = host.querySelector('[aria-label="AI 助手状态"]')!;
  expect(overview.textContent).toContain("当前对话模型");
  expect(overview.textContent).toContain("chat-current");
  expect(overview.textContent).toContain("Embedding 模型");
  expect(overview.textContent).toContain("bge-m3");
  expect(overview.textContent).toContain("知识库索引");
  expect(overview.textContent).toContain("25/28");
  expect(overview.textContent).toContain("向量引擎");
  expect(overview.textContent).toContain("1024 维");
});

it("preserves unsaved model text while switching tabs and supports keyboard navigation", async () => {
  await act(async () => root.render(<AISettingsReliabilityShell />));
  const model = visiblePanel().querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(model, "draft-model");
    model.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => tab("声音").click());
  await act(async () => tab("对话").click());
  expect(visiblePanel().querySelector("input")!.value).toBe("draft-model");
  act(() => tab("对话").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(visiblePanel().id).toBe("ai-model-panel-embedding");
  expect(document.activeElement).toBe(tab("Embedding"));
});
