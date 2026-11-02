import { describe, expect, it } from "vitest";
import { sortNotesPinnedFirst } from "@/lib/notePinnedOrder";

type Item = { id: string; isPinned: number; sortOrder: number };

const item = (id: string, isPinned: number, sortOrder: number): Item => ({
  id,
  isPinned,
  sortOrder,
});

describe("sortNotesPinnedFirst", () => {
  it("stable-groups pinned notes without changing relevance order inside groups", () => {
    const notes = [
      item("normal-a", 0, 3),
      item("pinned-a", 1, 8),
      item("pinned-b", 1, 2),
      item("normal-b", 0, 1),
    ];

    expect(sortNotesPinnedFirst(notes).map((note) => note.id)).toEqual([
      "pinned-a",
      "pinned-b",
      "normal-a",
      "normal-b",
    ]);
    expect(notes.map((note) => note.id)).toEqual([
      "normal-a",
      "pinned-a",
      "pinned-b",
      "normal-b",
    ]);
  });

  it("uses the supplied comparator inside pinned and normal groups", () => {
    const notes = [
      item("normal-a", 0, 3),
      item("pinned-a", 1, 8),
      item("pinned-b", 1, 2),
      item("normal-b", 0, 1),
    ];

    expect(
      sortNotesPinnedFirst(notes, (a, b) => a.sortOrder - b.sortOrder)
        .map((note) => note.id),
    ).toEqual([
      "pinned-b",
      "pinned-a",
      "normal-b",
      "normal-a",
    ]);
  });
});
