import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { aiProfiles } from "@/lib/aiProfiles";
import EmbeddingSettingsPanel from "../EmbeddingSettingsPanel";

vi.mock("@/components/EmbeddingIndexFailureDetails", () => ({ default: () => null }));
vi.mock("@/lib/aiReliable", () => ({ getReliableAIStatus: async () => ({ index: { pending: 0, processing: 0, failed: 0, configured: false } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("refreshes channels without discarding an unsaved Embedding model", async () => {
  localStorage.setItem("i18nextLng", "zh-CN");
  vi.spyOn(api, "getAISettings").mockResolvedValue({ ai_provider: "custom", ai_api_url: "https://channel.test/v1", ai_api_key: "", ai_api_key_set: true, ai_model: "chat", ai_embedding_profile_id: "channel", ai_embedding_model: "bge-m3" } as Awaited<ReturnType<typeof api.getAISettings>>);
  const profile = { id: "channel", name: "Original", provider: "custom", apiUrl: "https://channel.test/v1", apiKey: "****", apiKeySet: true, model: "chat", createdAt: "now", updatedAt: "now" };
  vi.spyOn(aiProfiles, "list").mockResolvedValue({ profiles: [profile], activeProfileId: "channel" });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<EmbeddingSettingsPanel />));
    const model = host.querySelector<HTMLInputElement>('input[placeholder="例如：text-embedding-3-small"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(model, "unsaved-embedding");
      model.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.mocked(aiProfiles.list).mockResolvedValue({ profiles: [{ ...profile, name: "Renamed" }], activeProfileId: "channel" });
    await act(async () => { window.dispatchEvent(new Event("nowen:ai-profiles-changed")); });
    expect(model.value).toBe("unsaved-embedding");
    expect(host.textContent).toContain("Renamed");
    expect(api.getAISettings).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); localStorage.clear(); }
});
