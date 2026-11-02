import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractLegacyDownloadToken,
  isReliableExportFilename,
  scheduleObjectUrlRevocation,
} from "@/lib/reliableExportDownloadBridge";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("reliableExportDownloadBridge", () => {
  it("recognizes every affected export type", () => {
    expect(isReliableExportFilename("note.md")).toBe(true);
    expect(isReliableExportFilename("note.markdown")).toBe(true);
    expect(isReliableExportFilename("notebook.zip")).toBe(true);
    expect(isReliableExportFilename("note.pdf")).toBe(true);
    expect(isReliableExportFilename("note.docx")).toBe(true);
    expect(isReliableExportFilename("cover.png")).toBe(false);
  });

  it("extracts only synthetic legacy fallback tokens", () => {
    expect(extractLegacyDownloadToken("https://note.test/api/export/download/legacy-export-123"))
      .toBe("legacy-export-123");
    expect(extractLegacyDownloadToken("https://note.test/api/export/download/real-token"))
      .toBeNull();
  });

  it("keeps an export object URL alive until the cleanup delay expires", () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revoke,
    });

    scheduleObjectUrlRevocation("blob:https://note.test/export", 60_000);

    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59_999);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith("blob:https://note.test/export");
  });
});
