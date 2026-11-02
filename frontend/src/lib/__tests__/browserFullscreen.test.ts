import { describe, expect, it, vi } from "vitest";
import {
  exitBrowserFullscreen,
  isBrowserFullscreen,
  requestBrowserFullscreen,
} from "@/lib/browserFullscreen";

describe("browserFullscreen", () => {
  it("requests fullscreen on the document element", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "documentElement", {
      configurable: true,
      value: { requestFullscreen },
    });

    await expect(requestBrowserFullscreen()).resolves.toBe(true);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("exits fullscreen when the document is fullscreen", async () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.body,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });

    await expect(exitBrowserFullscreen()).resolves.toBe(true);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("reports browser fullscreen state", () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.body,
    });

    expect(isBrowserFullscreen()).toBe(true);
  });
});
