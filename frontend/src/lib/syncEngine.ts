import { getOfflineQueueStorageKey } from "./offlineScope";
import { assertConversionNote } from "./encryptedNotes/conversionBarrier";
import { api, getCurrentWorkspace } from "@/lib/api";
import {
  setCurrentUser,
  putNotebooks,
  putNoteListItems,
  putNote,
  putTags,
  setMeta,
  getMeta,
  getNote as getCachedNote,
  isReady as localStoreReady,
} from "@/lib/localStore";
import {
  flushQueue,
  discardNoteQueueItems,
  getFailedQueueItems,
  getQueue as getOfflineQueue,
  getQueueLength,
  subscribe as subscribeOfflineQueue,
  type OfflineQueueItem,
} from "@/lib/offlineQueue";
import { offlineQueueFetch } from "@/lib/offlineQueueFetch";
import { resolveQueuedNoteConflicts } from "@/lib/conflictResolution";
import type { Note, User } from "@/types";
import {
  reportTransientNoteImageSource,
  stabilizeNoteMutationPayload,
} from "@/lib/noteContentPersistence";

type SyncState = "idle" | "bootstrapping" | "ready" | "error";
let state: SyncState = "idle";
let lastError: string | null = null;
const stateListeners = new Set<(state: SyncState) => void>();

export const SYNC_SNAPSHOT_APPLIED_EVENT = "nowen:sync-snapshot-applied";

export interface SyncSummary {
  state: SyncState;
  lastError: string | null;
  pending: number;
  versionConflicts: number;
  lastSyncAt: number | null;
}

const summaryListeners = new Set<(summary: SyncSummary) => void>();
let lastSyncAtCache: number | null = null;
let queueSubscribed = false;

function buildSummary(): SyncSummary {
  const pending = getQueueLength();
  return {
    state,
    lastError,
    pending,
    versionConflicts: countVersionConflicts(getFailedQueueItems()),
    lastSyncAt: lastSyncAtCache,
  };
}

function notifySummary(): void {
  const summary = buildSummary();
  summaryListeners.forEach((listener) => {
    try { listener(summary); } catch { /* listener isolation */ }
  });
}

function setState(next: SyncState, error?: string): void {
  state = next;
  lastError = error || null;
  stateListeners.forEach((listener) => {
    try { listener(next); } catch { /* listener isolation */ }
  });
  notifySummary();
}

function describePendingQueue(pending: number): string {
  const failed = getFailedQueueItems();
  const conflicts = countVersionConflicts(failed);
  const blocked = failed.filter((item) => item.blocked && !item.conflict).length;
  const visiblePending = Math.max(0, pending - conflicts);
  if (blocked > 0) {
    return `仍有 ${visiblePending} 条待同步操作，其中 ${blocked} 条已暂停自动重试；请查看失败原因后重试或导出诊断。`;
  }
  return `仍有 ${visiblePending} 条待同步操作，服务器尚未确认完成，请稍后重试。`;
}

export function countVersionConflicts(
  items: ReadonlyArray<Pick<OfflineQueueItem, "conflict" | "errorCode">>,
): number {
  return items.filter((item) => item.conflict || item.errorCode === "VERSION_CONFLICT").length;
}

async function resolveConfiguredVersionConflicts(): Promise<void> {
  const result = await resolveQueuedNoteConflicts(getOfflineQueue());
  if (result.failed > 0) {
    console.warn("[syncEngine] automatic server-version conflict resolution incomplete", {
      attempted: result.attempted,
      resolved: result.resolved,
      failures: result.failures,
    });
  }
}

type QueueConflictEntry = Pick<OfflineQueueItem, "noteId" | "type" | "conflict" | "errorCode">;

function conflictedUpdates(items: ReadonlyArray<QueueConflictEntry>): Set<string> {
  return new Set(items
    .filter(item => item.type === "updateNote" && (item.conflict || item.errorCode === "VERSION_CONFLICT"))
    .map(item => item.noteId));
}

export async function findServerDeletedQueuedNoteIds(
  remoteNoteIds: ReadonlySet<string>,
  queuedItems: ReadonlyArray<QueueConflictEntry>,
  fetchNote: (noteId: string) => Promise<{ isTrashed?: number }>,
): Promise<string[]> {
  const candidates = [...conflictedUpdates(queuedItems)].filter(id => !remoteNoteIds.has(id));
  const deleted: string[] = [];

  for (const noteId of candidates) {
    try {
      const note = await fetchNote(noteId);
      if (note.isTrashed === 1) deleted.push(noteId);
    } catch {
      // GET /notes/:id returns the same 404 for missing resources and ACL denial.
      // Without an explicit tombstone, preserve the local version/conflict.
    }
  }

  return deleted;
}

export function getSyncState(): { state: SyncState; lastError: string | null } {
  return { state, lastError };
}

export function subscribeSyncState(listener: (state: SyncState) => void): () => void {
  stateListeners.add(listener);
  return () => { stateListeners.delete(listener); };
}

export function getSyncSummary(): SyncSummary {
  return buildSummary();
}

export function subscribeSyncSummary(listener: (summary: SyncSummary) => void): () => void {
  if (!queueSubscribed) {
    queueSubscribed = true;
    subscribeOfflineQueue(() => notifySummary());
  }
  summaryListeners.add(listener);
  listener(buildSummary());
  return () => { summaryListeners.delete(listener); };
}

async function pullServerSnapshot(): Promise<void> {
  const currentWorkspace = getCurrentWorkspace();
  const currentWorkspaceId = currentWorkspace === "personal" ? null : currentWorkspace;
  const isCurrentScope = (value: { workspaceId?: string | null }) =>
    (value.workspaceId ?? null) === currentWorkspaceId;
  const [notebooksResult, notesResult, tagsResult] = await Promise.allSettled([
    api.getNotebooks(),
    api.getNotes(),
    api.getTags(),
  ]);

  const pullErrors: string[] = [];

  if (notebooksResult.status === "fulfilled") {
    // A scoped/filtered snapshot is not a deletion feed. Keep cached notebooks
    // until the server provides an explicit, verified deletion/tombstone.
    await putNotebooks(notebooksResult.value);
  } else {
    console.warn("[syncEngine] pull notebooks failed:", notebooksResult.reason);
    pullErrors.push(`笔记本：${notebooksResult.reason instanceof Error ? notebooksResult.reason.message : String(notebooksResult.reason)}`);
  }

  if (notesResult.status === "fulfilled") {
    // Read only conflicted notes. A full cache scan also materializes every offline note body.
    const locallyDeletedQueueIds: string[] = [];
    for (const id of conflictedUpdates(getOfflineQueue())) {
      const note = await getCachedNote(id);
      if (note?.isTrashed === 1 && isCurrentScope(note)) locallyDeletedQueueIds.push(id);
    }
    discardNoteQueueItems(locallyDeletedQueueIds);
    const remoteIds = new Set(notesResult.value.map((note) => note.id));
    // 历史版本可能在删除成功后仍留下冲突队列。对列表中缺失的冲突做轻量确认：
    // 只能根据明确的回收站状态清理；404 也可能是权限拒绝。
    const serverDeletedQueueIds = await findServerDeletedQueuedNoteIds(
      remoteIds,
      getOfflineQueue(),
      (noteId) => api.getNoteSlim(noteId),
    );
    discardNoteQueueItems(serverDeletedQueueIds);
    // A filtered listing is not a deletion feed. Only upsert returned notes.
    await putNoteListItems(notesResult.value);
  } else {
    console.warn("[syncEngine] pull notes list failed:", notesResult.reason);
    pullErrors.push(`笔记列表：${notesResult.reason instanceof Error ? notesResult.reason.message : String(notesResult.reason)}`);
  }

  if (tagsResult.status === "fulfilled") {
    // Missing tags may be filtered or temporarily inaccessible, not deleted.
    await putTags(tagsResult.value);
  } else {
    console.warn("[syncEngine] pull tags failed:", tagsResult.reason);
    pullErrors.push(`标签：${tagsResult.reason instanceof Error ? tagsResult.reason.message : String(tagsResult.reason)}`);
  }

  if (pullErrors.length > 0) {
    throw new Error(`同步补拉未完整完成（${pullErrors.join("；")}）`);
  }

  lastSyncAtCache = Date.now();
  await setMeta("lastSyncAt", lastSyncAtCache);
  notifySummary();

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SYNC_SNAPSHOT_APPLIED_EVENT, {
      detail: {
        lastSyncAt: lastSyncAtCache,
        notesPulled: notesResult.status === "fulfilled",
        notebooksPulled: notebooksResult.status === "fulfilled",
        tagsPulled: tagsResult.status === "fulfilled",
      },
    }));
  }
}

export async function bootstrap(user: User): Promise<void> {
  setCurrentUser(user.id);
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setState("ready");
    return;
  }

  setState("bootstrapping");
  try {
    if (getOfflineQueue().length > 0) {
      await flushQueue(offlineQueueFetch).catch((error) => {
        console.warn("[syncEngine] flush offline queue before pull failed:", error);
      });
    }
    if (getOfflineQueue().length > 0) await resolveConfiguredVersionConflicts();
    await pullServerSnapshot();
    const pending = getQueueLength();
    const versionConflicts = countVersionConflicts(getFailedQueueItems());
    if (pending > versionConflicts) setState("error", describePendingQueue(pending));
    else setState("ready");
  } catch (error) {
    console.warn("[syncEngine] bootstrap failed:", error);
    setState("error", error instanceof Error ? error.message : String(error));
  }
}

export async function syncNow(): Promise<{
  ok: boolean;
  pending: number;
  versionConflicts: number;
  lastSyncAt?: number;
  error?: string;
}> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const error = "offline";
    setState("error", error);
    return {
      ok: false,
      pending: getQueueLength(),
      versionConflicts: countVersionConflicts(getFailedQueueItems()),
      lastSyncAt: lastSyncAtCache ?? undefined,
      error,
    };
  }

  setState("bootstrapping");
  try {
    if (getQueueLength() > 0) await flushQueue(offlineQueueFetch);
    if (getQueueLength() > 0) await resolveConfiguredVersionConflicts();
    await pullServerSnapshot();

    const pending = getQueueLength();
    const versionConflicts = countVersionConflicts(getFailedQueueItems());
    if (pending > versionConflicts) {
      const error = describePendingQueue(pending);
      setState("error", error);
      return { ok: false, pending, versionConflicts, lastSyncAt: lastSyncAtCache ?? undefined, error };
    }

    setState("ready");
    return { ok: true, pending, versionConflicts, lastSyncAt: lastSyncAtCache ?? undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[syncEngine] syncNow failed:", error);
    setState("error", message);
    return {
      ok: false,
      pending: getQueueLength(),
      versionConflicts: countVersionConflicts(getFailedQueueItems()),
      lastSyncAt: lastSyncAtCache ?? undefined,
      error: message,
    };
  }
}

export function teardown(): void {
  setCurrentUser(null);
  setState("idle");
}

export async function getLastSyncAt(): Promise<number | null> {
  if (!localStoreReady()) return null;
  const value = await getMeta<number>("lastSyncAt");
  lastSyncAtCache = typeof value === "number" ? value : null;
  notifySummary();
  return lastSyncAtCache;
}

export function isCompleteNoteDetail(note: unknown): note is Note {
  const value = note as Partial<Note> | null;
  return !!value &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.userId === "string" && value.userId.length > 0 &&
    typeof value.notebookId === "string" && value.notebookId.length > 0 &&
    typeof value.title === "string" &&
    typeof value.content === "string" &&
    typeof value.contentText === "string" &&
    typeof value.version === "number" && Number.isFinite(value.version) &&
    typeof value.createdAt === "string" && value.createdAt.length > 0 &&
    typeof value.updatedAt === "string" && value.updatedAt.length > 0;
}

export async function cacheNoteContent(note: Note, expectedScope = getOfflineQueueStorageKey()): Promise<void> {
  if (!localStoreReady() || expectedScope !== getOfflineQueueStorageKey()) return;
  if (!isCompleteNoteDetail(note)) {
    console.warn("[syncEngine] refused incomplete note detail cache write", {
      id: (note as any)?.id,
      version: (note as any)?.version,
      userId: (note as any)?.userId,
      notebookId: (note as any)?.notebookId,
      hasContent: typeof (note as any)?.content === "string",
      hasContentText: typeof (note as any)?.contentText === "string",
    });
    return;
  }
  let stableNote: Note;
  try {
    stableNote = stabilizeNoteMutationPayload(note);
  } catch (error) {
    reportTransientNoteImageSource(error, { operation: "cacheNoteContent", noteId: note.id });
    return;
  }
  try {
    assertConversionNote(stableNote);
    if (expectedScope !== getOfflineQueueStorageKey()) return;
    await putNote({ ...stableNote, __detailCached: true });
  } catch (error) {
    console.warn("[syncEngine] cacheNoteContent failed:", error);
  }
}
