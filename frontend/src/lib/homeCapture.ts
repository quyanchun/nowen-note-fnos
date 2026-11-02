import { openDB } from "idb";
import { api, getCurrentWorkspace } from "./api";
import { getOfflineQueueStorageKey } from "./offlineScope";
import type { RecordedVoice } from "./voiceRecorder";
import type { CapturePreferences } from "./homeCaptureAI";
import type { Note } from "@/types";

export interface HomeCaptureFile {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  attachment?: { id: string; url: string; filename: string };
}
export interface HomeCaptureDraft {
  key: string;
  id: string;
  text: string;
  files: HomeCaptureFile[];
  voice?: RecordedVoice;
  voiceSegments?: Array<{id:string;voice:RecordedVoice}>;
  notebookId?: string;
  title?: string;
  originalText?: string;
  preferences?: CapturePreferences;
  legacyImported?: boolean;
}
export function getHomeCaptureScope(): string {
  return `${getOfflineQueueStorageKey()}:home:${encodeURIComponent(getCurrentWorkspace())}`;
}
export function emptyHomeCapture(key: string): HomeCaptureDraft {
  return { key, id: crypto.randomUUID(), text: "", files: [] };
}
const database = () => openDB("nowen-home-capture", 1, {
  upgrade(db) { db.createObjectStore("drafts", { keyPath: "key" }); },
});
// Keep page navigation recoverable, but start a fresh capture when the app reopens.
const captureSession = crypto.randomUUID();
export const homeCaptureStore = {
  async read(key: string): Promise<HomeCaptureDraft | undefined> {
    const db = await database();
    try {
      const draft: (HomeCaptureDraft & { session?: string }) | undefined = await db.get("drafts", key);
      if (!draft || draft.session === captureSession) return draft;
      return { ...emptyHomeCapture(key), preferences: draft.preferences, legacyImported: draft.legacyImported };
    } finally { db.close(); }
  },
  async write(draft: HomeCaptureDraft): Promise<void> {
    const db = await database();
    try { await db.put("drafts", { ...draft, session: captureSession }); } finally { db.close(); }
  },
};

/** Persist each acknowledged step so retry never creates another note or re-uploads completed files. */
export async function saveHomeCapture(
  original: HomeCaptureDraft,
  persist: (draft: HomeCaptureDraft) => Promise<void>,
  inboxName: string,
  originalLabel = "原文",
): Promise<Note> {
  let draft = original;
  const workspaceId = getCurrentWorkspace() === "personal" ? null : getCurrentWorkspace();
  const requireScope = () => {
    if (getHomeCaptureScope() !== original.key) throw new Error("HOME_SCOPE_CHANGED");
  };
  requireScope();
  if (!draft.text.trim() && !draft.files.length) throw new Error("HOME_EMPTY");
  await persist(draft);
  requireScope();
  if (!draft.notebookId) {
    const notebooks = await api.getNotebooks();
    requireScope();
    const targetId = draft.preferences?.notebookId;
    let inbox = targetId ? notebooks.find(item => item.id === targetId && (!item.permission || ["write", "manage"].includes(item.permission)))
      : notebooks.find(item => item.name === inboxName && !item.parentId && (item.workspaceId || null) === workspaceId && (!item.permission || ["write", "manage"].includes(item.permission)));
    if (targetId && !inbox) throw new Error("保存文件夹不存在或没有写入权限，请在收集设置里重新选择。");
    if (!inbox) inbox = await api.createNotebook({ name: inboxName, icon: "📥", workspaceId });
    draft = { ...draft, notebookId: inbox.id };
    await persist(draft);
    requireScope();
  }
  const originalBlock = draft.originalText !== undefined ? `---\n\n## ${originalLabel}\n\n${draft.originalText}` : "";
  const bodyText = [draft.text, originalBlock].filter(Boolean).join("\n\n");
  let note: Note;
  try {
    note = await api.getNote(draft.id);
    if (note.notebookId !== draft.notebookId) throw new Error("HOME_NOTE_MISMATCH");
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
    requireScope();
    note = await api.createNoteConfirmed({
      id: draft.id, notebookId: draft.notebookId, workspaceId,
      title: draft.title || draft.text.trim().split(/\r?\n/)[0]?.replace(/^#{1,6}\s+/, "").slice(0, 60) || draft.files[0].name,
      content: bodyText, contentText: [draft.text, draft.originalText].filter(Boolean).join("\n"), contentFormat: "markdown",
    });
  }
  requireScope();
  for (let index = 0; index < draft.files.length; index++) {
    if (draft.files[index].attachment) continue;
    const file = draft.files[index];
    const attachment = await api.attachments.upload(note.id, new File([file.blob], file.name, { type: file.type }));
    draft = { ...draft, files: draft.files.map((item, i) => i === index ? { ...item, attachment } : item) };
    await persist(draft);
    requireScope();
  }
  const links = draft.files.map(file => {
    const name = file.attachment!.filename.replace(/[\\[\]()]/g, "\\$&").replace(/[\r\n]/g, " ");
    return `[${name}](/api/attachments/${encodeURIComponent(file.attachment!.id)})`;
  });
  const content = [bodyText, ...links].filter(Boolean).join("\n\n");
  requireScope();
  return api.updateNoteConfirmed(note.id, { version: note.version, content, contentText: [draft.text, draft.originalText, ...draft.files.map(file => file.name)].filter(Boolean).join("\n"), contentFormat: "markdown" });
}
