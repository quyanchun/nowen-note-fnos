type PinnableNote = { isPinned?: number | null };

export function comparePinnedFirst(a: PinnableNote, b: PinnableNote): number {
  return Number(b.isPinned || 0) - Number(a.isPinned || 0);
}

export function sortNotesPinnedFirst<T extends PinnableNote>(
  notes: readonly T[],
  compareWithinGroup: (a: T, b: T) => number = () => 0,
): T[] {
  return [...notes].sort((a, b) => comparePinnedFirst(a, b) || compareWithinGroup(a, b));
}
