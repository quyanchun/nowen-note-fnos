import { api } from "@/lib/api";

export interface PutWithReconcileOptions<T> {
  /** Revision the local edit was based on. */
  initialVersion: number;
  /** Send the mutation using the supplied base revision. */
  send: (version: number) => Promise<T>;
  /** Optional metadata lookup used to enrich the conflict error. */
  fetchLatestVersion?: () => Promise<number | undefined>;
  /** Abort before any optional retry, for example after switching notes. */
  onAbort?: () => boolean;
  /**
   * Explicit opt-in for mutations that are safe to replay against a newer revision.
   * Content/title writes must leave this false. The default is deliberately false so a
   * stale payload can never overwrite another device merely because its version was
   * refreshed after a 409.
   */
  retryOnConflict?: boolean;
}

export function is409Error(error: any): boolean {
  if (!error) return false;
  if (error.status === 409 || error.code === "VERSION_CONFLICT") return true;
  return /409|conflict/i.test(String(error.message || ""));
}

function abortedError(): Error {
  const error = new Error("putWithReconcile aborted");
  (error as any).aborted = true;
  return error;
}

/**
 * Execute a versioned PUT.
 *
 * A previous implementation automatically fetched the newest version after a 409 and
 * replayed the original payload. That turns optimistic locking into last-writer-wins and
 * can let a stale/empty mobile snapshot replace newer server content. Conflicts now stop
 * by default. Only callers that can prove their mutation is commutative may explicitly
 * set retryOnConflict=true.
 */
export async function putWithReconcile<T>(
  options: PutWithReconcileOptions<T>,
): Promise<T> {
  const {
    initialVersion,
    send,
    fetchLatestVersion,
    onAbort,
    retryOnConflict = false,
  } = options;

  try {
    return await send(initialVersion);
  } catch (error: any) {
    if (!is409Error(error)) throw error;
    if (onAbort?.()) throw abortedError();

    let latestVersion: number | undefined = error?.currentVersion;
    if (typeof latestVersion !== "number" && fetchLatestVersion) {
      try { latestVersion = await fetchLatestVersion(); } catch { /* keep original conflict */ }
    }
    if (typeof latestVersion === "number") {
      error.currentVersion = latestVersion;
    }

    if (!retryOnConflict || typeof latestVersion !== "number") {
      throw error;
    }
    if (onAbort?.()) throw abortedError();
    return send(latestVersion);
  }
}

export function isAborted(error: any): boolean {
  return !!(error && error.aborted === true);
}

export function makeFetchLatestNoteVersion(noteId: string) {
  return async (): Promise<number | undefined> => {
    try {
      const latest = await api.getNoteSlim(noteId);
      return latest?.version;
    } catch {
      return undefined;
    }
  };
}
