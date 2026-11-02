// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  classifyMobileBootstrapTarget,
  selectNotesFromBootstrap,
  type MobileBootstrapPayload,
} from "@/lib/mobileStartupBridge";

const payload: MobileBootstrapPayload = {
  schemaVersion: 1,
  workspaceId: "personal",
  generatedAt: 1,
  notebooks: [
    { id: "root", parentId: null },
    { id: "child", parentId: "root" },
    { id: "other", parentId: null },
  ],
  notes: [
    {
      id: "a",
      notebookId: "root",
      title: "Beta",
      contentText: "beta preview",
      contentLength: 9000,
      isPinned: 0,
      isFavorite: 1,
      sortOrder: 2,
      createdAt: "2026-07-01 00:00:00",
      updatedAt: "2026-07-10 00:00:00",
    },
    {
      id: "b",
      notebookId: "child",
      title: "Alpha",
      contentText: "alpha preview",
      contentLength: 12000,
      isPinned: 1,
      isFavorite: 0,
      sortOrder: 9,
      createdAt: "2026-07-02 00:00:00",
      updatedAt: "2026-07-11 00:00:00",
    },
    {
      id: "c",
      notebookId: "other",
      title: "Gamma",
      contentText: "gamma preview",
      contentLength: 200,
      isPinned: 0,
      isFavorite: 1,
      sortOrder: 1,
      createdAt: "2026-07-03 00:00:00",
      updatedAt: "2026-07-12 00:00:00",
    },
  ],
  tags: [],
  sharedNoteIds: ["a"],
  sharedNotebooks: [],
  preferences: {},
};

describe("mobile startup bootstrap routing", () => {
  it("only intercepts safe collection reads", () => {
    expect(classifyMobileBootstrapTarget(new URL("https://nas.test/api/notes?workspaceId=personal"))).toBe("notes");
    expect(classifyMobileBootstrapTarget(new URL("https://nas.test/api/notebooks?workspaceId=personal"))).toBe("notebooks");
    expect(classifyMobileBootstrapTarget(new URL("https://nas.test/api/shares/status/batch"))).toBe("shared-note-ids");
    expect(classifyMobileBootstrapTarget(new URL("https://nas.test/api/notes?workspaceId=personal&isTrashed=1"))).toBeNull();
    expect(classifyMobileBootstrapTarget(new URL("https://nas.test/api/notes?workspaceId=personal&tagIds=x"))).toBeNull();
    expect(classifyMobileBootstrapTarget(new URL("https://nas.test/api/notes/abc"))).toBeNull();
    expect(classifyMobileBootstrapTarget(new URL("https://nas.test/api/notes"), "POST")).toBeNull();
  });

  it("keeps pinned notes first and sorts updatedAt descending", () => {
    const selected = selectNotesFromBootstrap(
      payload,
      new URL("https://nas.test/api/notes?workspaceId=personal&sortBy=updatedAt&sortOrder=desc"),
    );
    expect(selected?.map((note) => note.id)).toEqual(["b", "c", "a"]);
  });

  it("includes descendant notebooks without returning sibling notes", () => {
    const selected = selectNotesFromBootstrap(
      payload,
      new URL("https://nas.test/api/notes?workspaceId=personal&notebookId=root"),
    );
    expect(selected?.map((note) => note.id)).toEqual(["b", "a"]);
  });

  it("supports favorite and date filters while preserving compact metadata", () => {
    const selected = selectNotesFromBootstrap(
      payload,
      new URL("https://nas.test/api/notes?workspaceId=personal&isFavorite=1&dateFrom=2026-07-11"),
    );
    expect(selected?.map((note) => note.id)).toEqual(["c"]);
    expect(selected?.[0].contentLength).toBe(200);
  });

  it("does not serve a snapshot from another workspace", () => {
    expect(selectNotesFromBootstrap(
      payload,
      new URL("https://nas.test/api/notes?workspaceId=workspace-1"),
    )).toBeNull();
  });
});
