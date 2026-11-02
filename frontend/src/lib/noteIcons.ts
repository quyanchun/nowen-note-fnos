import { getBaseUrl } from "@/lib/api";

type IconMap = Record<string, string>;
type Listener = () => void;

const cache = new Map<string, string | null>();
const loaded = new Set<string>();
const pendingIds = new Set<string>();
const listeners = new Set<Listener>();
let flushTimer: number | null = null;
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    try { listener(); } catch { /* ignore isolated UI listeners */ }
  }
}

function authHeaders(json = false): HeadersInit {
  const token = localStorage.getItem("nowen-token") || "";
  const connectionId = (window as any).__nowenGetConnectionId?.() || "";
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(connectionId ? { "X-Connection-Id": connectionId } : {}),
  };
}

async function readJson(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (response.ok) return body;
  const error = new Error(body?.error || `Request failed (${response.status})`) as Error & {
    code?: string;
    status?: number;
  };
  error.code = body?.code;
  error.status = response.status;
  throw error;
}

async function loadBatch(ids: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean))).slice(0, 200);
  if (uniqueIds.length === 0) return;

  try {
    const response = await fetch(
      `${getBaseUrl()}/user-preferences/note-icons?ids=${encodeURIComponent(uniqueIds.join(","))}`,
      { headers: authHeaders(), cache: "no-store" },
    );
    const body = await readJson(response) as { icons?: IconMap };
    const icons = body.icons || {};
    for (const id of uniqueIds) {
      cache.set(id, typeof icons[id] === "string" && icons[id].trim() ? icons[id] : null);
      loaded.add(id);
    }
    emit();
  } catch (error) {
    console.warn("[note-icons] batch load failed:", error);
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    const ids = Array.from(pendingIds);
    pendingIds.clear();
    void loadBatch(ids);
  }, 16);
}

export function queueNoteIcons(ids: Iterable<string>): void {
  let changed = false;
  for (const id of ids) {
    if (!id || loaded.has(id) || pendingIds.has(id)) continue;
    pendingIds.add(id);
    changed = true;
  }
  if (changed) scheduleFlush();
}

export async function refreshNoteIcons(ids: Iterable<string>): Promise<void> {
  const list = Array.from(new Set(Array.from(ids).filter(Boolean))).slice(0, 200);
  for (const id of list) loaded.delete(id);
  await loadBatch(list);
}

export function getCachedNoteIcon(noteId: string): string | null {
  return cache.get(noteId) ?? null;
}

export function getNoteIconStoreVersion(): number {
  return version;
}

export function subscribeNoteIcons(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function primeNoteIcon(noteId: string, icon: unknown): void {
  if (!noteId) return;
  const normalized = typeof icon === "string" && icon.trim() ? icon.trim() : null;
  if (loaded.has(noteId) && cache.get(noteId) === normalized) return;
  cache.set(noteId, normalized);
  loaded.add(noteId);
  emit();
}

export async function setNoteIcon(noteId: string, icon: string | null): Promise<string | null> {
  const response = await fetch(`${getBaseUrl()}/user-preferences/note-icons/${encodeURIComponent(noteId)}`, {
    method: "PUT",
    headers: authHeaders(true),
    body: JSON.stringify({ icon }),
  });
  const body = await readJson(response) as { icon?: string | null };
  const normalized = typeof body.icon === "string" && body.icon.trim() ? body.icon.trim() : null;
  primeNoteIcon(noteId, normalized);
  return normalized;
}
