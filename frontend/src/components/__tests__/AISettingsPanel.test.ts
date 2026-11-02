import { describe, expect, it } from "vitest";
import { PROVIDER_PRESETS } from "../AISettingsPanel";

describe("AISettingsPanel provider presets", () => {
  it("shows API Key input for custom OpenAI-compatible API", () => {
    const custom = PROVIDER_PRESETS.find(provider => provider.id === "custom");

    expect(custom?.needsKey).toBe(true);
  });

  it("keeps Ollama as a no-key local provider", () => {
    const ollama = PROVIDER_PRESETS.find(provider => provider.id === "ollama");

    expect(ollama?.needsKey).toBe(false);
  });

  it("offers LM Studio as a no-key local or LAN provider", () => {
    const lmstudio = PROVIDER_PRESETS.find(provider => provider.id === "lmstudio");

    expect(lmstudio).toMatchObject({
      url: "http://127.0.0.1:1234/v1",
      needsKey: false,
    });
  });

});
