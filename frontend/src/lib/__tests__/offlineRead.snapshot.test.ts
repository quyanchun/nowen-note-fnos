import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOfflineNoteSnapshot,
  fingerprintNoteContent,
  getOfflineNoteSnapshot,
  markOfflineNoteSnapshot,
} from "@/lib/offlineRead";

describe("offline note snapshot baselines", () => {
  beforeEach(() => clearOfflineNoteSnapshot("note-1"));

  it("keeps a same-revision body fingerprint when a queue acknowledgement has no body", () => {
    markOfflineNoteSnapshot({
      id: "note-1",
      version: 4,
      content: "cached base body",
      updatedAt: "2026-07-10T00:00:00.000Z",
    });
    markOfflineNoteSnapshot({
      id: "note-1",
      version: 4,
      updatedAt: "2026-07-10T00:01:00.000Z",
    });

    expect(getOfflineNoteSnapshot("note-1")).toEqual(expect.objectContaining({
      version: 4,
      updatedAt: "2026-07-10T00:01:00.000Z",
      contentFingerprint: fingerprintNoteContent("cached base body"),
    }));
  });

  it("does not carry a fingerprint across revision changes", () => {
    markOfflineNoteSnapshot({ id: "note-1", version: 4, content: "old body" });
    markOfflineNoteSnapshot({ id: "note-1", version: 5 });

    expect(getOfflineNoteSnapshot("note-1")).toEqual(expect.objectContaining({
      version: 5,
      contentFingerprint: undefined,
    }));
  });

  it("distinguishes an intentional empty base from missing body metadata", () => {
    expect(fingerprintNoteContent("")).toMatch(/^0:/);
    expect(fingerprintNoteContent(undefined)).toBeUndefined();
  });
});
