import { describe, expect, it, vi } from "vitest";
import { enterEditorFullscreen, exitEditorFullscreen } from "@/lib/editorFullscreen";

describe("editorFullscreen", () => {
  it("enables page fullscreen and then requests browser fullscreen", async () => {
    const calls: string[] = [];
    const controls = {
      setEditorFullscreen: vi.fn((value: boolean) => calls.push(`page:${value}`)),
      requestBrowserFullscreen: vi.fn(async () => {
        calls.push("browser:request");
        return true;
      }),
      exitBrowserFullscreen: vi.fn(async () => true),
      ownsBrowserFullscreenRef: { current: false },
    };

    await enterEditorFullscreen(controls);

    expect(calls).toEqual(["page:true", "browser:request"]);
    expect(controls.ownsBrowserFullscreenRef.current).toBe(true);
  });

  it("keeps page fullscreen even when browser fullscreen is denied", async () => {
    const controls = {
      setEditorFullscreen: vi.fn(),
      requestBrowserFullscreen: vi.fn(async () => false),
      exitBrowserFullscreen: vi.fn(async () => true),
      ownsBrowserFullscreenRef: { current: false },
    };

    await enterEditorFullscreen(controls);

    expect(controls.setEditorFullscreen).toHaveBeenCalledWith(true);
    expect(controls.ownsBrowserFullscreenRef.current).toBe(false);
  });

  it("exits both page fullscreen and owned browser fullscreen", () => {
    const controls = {
      setEditorFullscreen: vi.fn(),
      requestBrowserFullscreen: vi.fn(async () => true),
      exitBrowserFullscreen: vi.fn(async () => true),
      ownsBrowserFullscreenRef: { current: true },
    };

    exitEditorFullscreen(controls);

    expect(controls.setEditorFullscreen).toHaveBeenCalledWith(false);
    expect(controls.exitBrowserFullscreen).toHaveBeenCalledTimes(1);
    expect(controls.ownsBrowserFullscreenRef.current).toBe(false);
  });
});
