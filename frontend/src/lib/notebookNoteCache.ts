import type { NoteListItem } from "@/types";
import type { NotebookSortPref } from "@/lib/notebookSort";
import { sortNotesPinnedFirst } from "@/lib/notePinnedOrder";

export function directNotebookNotes(notes: NoteListItem[], notebookId: string): NoteListItem[] {
  return notes.filter((note) => note.notebookId === notebookId);
}

export function syncPinnedStateToNotebookCache(
  cache: Map<string, NoteListItem[]>,
  sourceNotes: readonly NoteListItem[],
): Map<string, NoteListItem[]> {
  const pinnedById = new Map(sourceNotes.map((note) => [note.id, note.isPinned || 0]));
  const next = new Map(cache);
  let cacheChanged = false;

  cache.forEach((notes, notebookId) => {
    let notesChanged = false;
    const syncedNotes = notes.map((note) => {
      const isPinned = pinnedById.get(note.id);
      if (isPinned === undefined || isPinned === (note.isPinned || 0)) return note;
      notesChanged = true;
      return { ...note, isPinned };
    });

    if (notesChanged) {
      cacheChanged = true;
      next.set(notebookId, syncedNotes);
    }
  });

  return cacheChanged ? next : cache;
}

export function sortNotebookNotes(notes: NoteListItem[], pref: NotebookSortPref): NoteListItem[] {
  const dir = pref.dir === "asc" ? 1 : -1;
  return sortNotesPinnedFirst(notes, (a, b) => {
    if (pref.by === "manual") {
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    }
    if (pref.by === "name") {
      const cmp = (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
      return cmp * dir || a.id.localeCompare(b.id);
    }
    const field = pref.by as "updatedAt" | "createdAt";
    const av = a[field] || "";
    const bv = b[field] || "";
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return cmp * dir || a.id.localeCompare(b.id);
  });
}

export function moveNoteInNotebookCache(
  cache: Map<string, NoteListItem[]>,
  noteId: string,
  targetNotebookId: string,
  movedNote: NoteListItem,
): Map<string, NoteListItem[]> {
  const next = new Map<string, NoteListItem[]>();

  cache.forEach((notes, notebookId) => {
    next.set(notebookId, notes.filter((note) => note.id !== noteId));
  });

  const targetNotes = next.get(targetNotebookId);
  if (targetNotes) {
    next.set(targetNotebookId, [movedNote, ...targetNotes]);
  }

  return next;
}

export function addNoteToNotebookCache(
  cache: Map<string, NoteListItem[]>,
  notebookId: string,
  note: NoteListItem,
): Map<string, NoteListItem[]> {
  const next = new Map(cache);
  const existing = next.get(notebookId) || [];
  next.set(notebookId, [note, ...existing.filter((item) => item.id !== note.id)]);
  return next;
}

export function upsertNoteInNotebookCache(
  cache: Map<string, NoteListItem[]>,
  notebookId: string,
  note: NoteListItem,
): Map<string, NoteListItem[]> {
  const existing = cache.get(notebookId);
  if (!existing) return addNoteToNotebookCache(cache, notebookId, note);

  const index = existing.findIndex((item) => item.id === note.id);
  if (index === -1) return addNoteToNotebookCache(cache, notebookId, note);

  const next = new Map(cache);
  const notes = [...existing];
  notes[index] = note;
  next.set(notebookId, notes);
  return next;
}
