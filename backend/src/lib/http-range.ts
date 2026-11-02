export type ParsedHttpRange =
  | { ok: true; start: number; end: number; length: number }
  | { ok: false; reason: "malformed" | "multiple" | "unsatisfiable" };

/**
 * Parse one RFC 7233 byte range.
 *
 * Nowen intentionally serves a single range only. Browser video elements request one range at
 * a time; rejecting multipart ranges keeps the response path small and prevents accidental large
 * allocations from attacker-controlled range lists.
 */
export function parseSingleHttpRange(
  header: string | null | undefined,
  totalSize: number,
): ParsedHttpRange | null {
  if (!header) return null;
  if (!Number.isSafeInteger(totalSize) || totalSize < 0) {
    return { ok: false, reason: "unsatisfiable" };
  }

  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bytes=")) {
    return { ok: false, reason: "malformed" };
  }

  const raw = trimmed.slice(trimmed.indexOf("=") + 1).trim();
  if (!raw) return { ok: false, reason: "malformed" };
  if (raw.includes(",")) return { ok: false, reason: "multiple" };

  const match = raw.match(/^(\d*)-(\d*)$/);
  if (!match) return { ok: false, reason: "malformed" };
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { ok: false, reason: "malformed" };
  if (totalSize === 0) return { ok: false, reason: "unsatisfiable" };

  let start: number;
  let end: number;

  if (!rawStart) {
    // Suffix range: bytes=-500 means the final 500 bytes.
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { ok: false, reason: "unsatisfiable" };
    }
    const effectiveLength = Math.min(suffixLength, totalSize);
    start = totalSize - effectiveLength;
    end = totalSize - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isSafeInteger(start) || start < 0 || start >= totalSize) {
      return { ok: false, reason: "unsatisfiable" };
    }

    if (!rawEnd) {
      end = totalSize - 1;
    } else {
      end = Number(rawEnd);
      if (!Number.isSafeInteger(end) || end < start) {
        return { ok: false, reason: "unsatisfiable" };
      }
      end = Math.min(end, totalSize - 1);
    }
  }

  return { ok: true, start, end, length: end - start + 1 };
}
