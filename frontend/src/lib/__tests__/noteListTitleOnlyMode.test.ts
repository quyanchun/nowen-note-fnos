import { afterEach, describe, expect, it, vi } from "vitest";

describe("noteListTitleOnlyMode", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("does not start the global observer on module import", async () => {
    let observerCount = 0;
    class FakeMutationObserver {
      constructor() {
        observerCount += 1;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("MutationObserver", FakeMutationObserver);

    const mod = await import("../noteListTitleOnlyMode");

    expect(observerCount).toBe(0);
    mod.initNoteListTitleOnlyMode();
    expect(observerCount).toBe(1);
  });
});
