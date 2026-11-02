// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import {
  installNoteUpdateResponseGuard,
  isCompleteNoteUpdateResponse,
} from "@/lib/noteUpdateResponseGuard";

const INSTALL_KEY = "__NOWEN_NOTE_UPDATE_RESPONSE_GUARD_V1__";
const realUpdateNote = api.updateNote;

function completeNote() {
  return {
    id: "note-1",
    userId: "user-1",
    notebookId: "notebook-1",
    workspaceId: null,
    title: "Title",
    content: "Body",
    contentText: "Body",
    contentFormat: "markdown",
    version: 4,
    isPinned: 0,
    isFavorite: 0,
    isLocked: 0,
    isArchived: 0,
    isTrashed: 0,
    trashedAt: null,
    sortOrder: 0,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  } as any;
}

beforeEach(() => {
  const uninstall = (window as any)[INSTALL_KEY] as (() => void) | undefined;
  uninstall?.();
  (api as any).updateNote = realUpdateNote;
});

afterEach(() => {
  const uninstall = (window as any)[INSTALL_KEY] as (() => void) | undefined;
  uninstall?.();
  (api as any).updateNote = realUpdateNote;
});

describe("note update response guard", () => {
  it("recognizes complete note details", () => {
    expect(isCompleteNoteUpdateResponse(completeNote(), "note-1")).toBe(true);
    expect(isCompleteNoteUpdateResponse({ id: "note-1", version: 1 }, "note-1")).toBe(false);
    expect(isCompleteNoteUpdateResponse(completeNote(), "other-note")).toBe(false);
  });

  it("rejects a body-shaped object that lacks server identity fields", () => {
    expect(isCompleteNoteUpdateResponse({
      id: "note-1",
      title: "Title",
      content: "",
      contentText: "",
      version: 1,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    }, "note-1")).toBe(false);
  });

  it("prevents a partial offline acknowledgement from reaching active-note callers", async () => {
    const transport = vi.fn().mockResolvedValue({
      id: "note-1",
      version: 1,
      isFavorite: 1,
    });
    (api as any).updateNote = transport;
    installNoteUpdateResponseGuard();

    await expect(api.updateNote("note-1", { isFavorite: 1 } as any))
      .rejects.toMatchObject({
        code: "OFFLINE_WRITE_QUEUED",
        queued: true,
        noteId: "note-1",
      });

    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("passes through a complete server response", async () => {
    const response = completeNote();
    const transport = vi.fn().mockResolvedValue(response);
    (api as any).updateNote = transport;
    installNoteUpdateResponseGuard();

    await expect(api.updateNote("note-1", { isFavorite: 1 } as any))
      .resolves.toBe(response);
  });
});
