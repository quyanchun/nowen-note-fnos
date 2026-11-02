import { getDb } from "../db/schema";
import { getActiveProfile, listProfiles } from "../sync/profile";
import { getRemoteCredential, scopedFetch } from "../sync/credentials";
import { readNoteReceipt } from "../sync/note-receipt";
import { resolveEffectiveNoteCapabilities } from "./share-capabilities";
import { projectMarkdownNoteForUser } from "../lib/markdownUserContent";

class SharePublicationError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
const required = () => new SharePublicationError("SHARE_SERVER_REQUIRED", "请先连接并登录笔记服务端，再发布分享");

function publications() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS desktop_share_publications(
    profileId TEXT NOT NULL,shareId TEXT NOT NULL,PRIMARY KEY(profileId,shareId))`);
  return db;
}

function context(userId: string) {
  const db = getDb(), profile = getActiveProfile(db);
  const credential = profile && getRemoteCredential(profile.id);
  if (!profile || !credential || credential.localUserId !== userId || !credential.remoteUserId
    || credential.remoteUserId !== profile.remoteUserId || credential.serverUrl !== profile.serverUrl
    || !db.prepare("SELECT 1 FROM users WHERE id=? AND isDisabled=0").get(userId)) throw required();
  return { profile, credential };
}

type BoundServer = ReturnType<typeof context>;
function sameServer(userId: string, bound: BoundServer) {
  const current = context(userId);
  if (current.profile.id !== bound.profile.id || current.credential.remoteUserId !== bound.credential.remoteUserId) throw required();
  return current;
}

async function remote(userId: string, bound: BoundServer, path: string, method = "GET", body?: unknown) {
  const before = sameServer(userId, bound);
  const response = await scopedFetch(before.profile.id, before.profile.serverUrl)(`${before.profile.serverUrl}/api${path}`, {
    method, headers: { "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(15000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  sameServer(userId, bound);
  const data = await response.json().catch(() => null) as any;
  if (!data || typeof data !== "object") throw new SharePublicationError("SHARE_SERVER_UNAVAILABLE", "笔记服务端返回异常，分享未确认发布", 502);
  return { status: response.status, data };
}

async function requirePublishedNote(userId: string, bound: BoundServer, noteId: unknown) {
  if (typeof noteId !== "string" || !/^[\w-]{1,128}$/.test(noteId)) throw new SharePublicationError("INVALID_NOTE_ID", "笔记参数无效", 400);
  const { profile } = sameServer(userId, bound), db = getDb();
  const note = db.prepare("SELECT title,content,contentFormat,version FROM notes WHERE id=?").get(noteId) as any;
  if (!note || !resolveEffectiveNoteCapabilities(noteId, userId).reshare) throw new SharePublicationError("RESHARE_FORBIDDEN", "无权发布此笔记", 403);
  if (readNoteReceipt(db, profile.id, noteId).phase !== "confirmed") throw new SharePublicationError("SHARE_NOTE_NOT_SYNCED", "请等待这篇笔记同步到服务端后再发布分享");
  const saved = await remote(userId, bound, `/notes/${encodeURIComponent(noteId)}`);
  if (saved.status !== 200) {
    if (saved.status === 401) throw new SharePublicationError("SHARE_SERVER_LOGIN_REQUIRED", "笔记服务端登录已失效，请重新登录后发布分享");
    if (saved.status >= 500) throw new SharePublicationError("SHARE_SERVER_UNAVAILABLE", "无法连接笔记服务端，分享未发布", 502);
    if (saved.status === 403) throw new SharePublicationError(saved.data.code || "RESHARE_FORBIDDEN", saved.data.error || "无权读取服务端笔记", 403);
    throw new SharePublicationError("SHARE_NOTE_NOT_SYNCED", "这篇笔记尚未在服务端可用，请同步完成后再发布分享");
  }
  // GET /notes projects indexed Markdown block metadata out of the public body.
  const projected = projectMarkdownNoteForUser(db, { id: noteId, ...note });
  if (saved.data.content !== projected.content || saved.data.contentFormat !== note.contentFormat
    || saved.data.version !== note.version || saved.data.title !== note.title) throw new SharePublicationError("SHARE_NOTE_NOT_SYNCED", "服务端笔记与本机版本不同，请同步完成后再发布分享");
  const latest = db.prepare("SELECT title,content,contentFormat,version FROM notes WHERE id=?").get(noteId);
  if (JSON.stringify(latest) !== JSON.stringify(note) || readNoteReceipt(db, profile.id, noteId).phase !== "confirmed") throw new SharePublicationError("SHARE_NOTE_NOT_SYNCED", "笔记正在更新，请同步完成后再发布分享");
  return note.version as number;
}

/** Share records belong to the serving backend, not the local Sync V2 note store. */
export async function desktopShareRequest(request: Request, userId: string, authMode?: string): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname.replace(/^\/api\/shares(?=\/|$)/, "");
  const id = "[\\w-]{1,128}";
  const publish = request.method === "POST" && path.match(new RegExp(`^/local/(${id})/publish$`));
  const managed = (["GET", "POST"].includes(request.method) && (path === "" || path === "/"))
    || (request.method === "GET" && (path === "/status/batch" || new RegExp(`^/note/${id}$`).test(path)))
    || (["GET", "PUT", "DELETE"].includes(request.method) && new RegExp(`^/${id}$`).test(path));
  if (!process.env.ELECTRON_USER_DATA || (!publish && !managed)
    || listProfiles(getDb()).length === 0) return null;
  try {
    if (!userId || authMode === "api-token") throw new SharePublicationError("SHARE_ACCOUNT_LOGIN_REQUIRED", "请使用笔记账号登录后管理服务端分享", 403);
    const bound = context(userId);
    if (publish) {
      const share = getDb().prepare("SELECT * FROM shares WHERE id=? AND ownerId=?").get(publish[1], userId) as any;
      if (!share) throw new SharePublicationError("SHARE_NOT_FOUND", "本机分享不存在", 404);
      const expectedNoteVersion = await requirePublishedNote(userId, bound, share.noteId);
      if (JSON.stringify(getDb().prepare("SELECT * FROM shares WHERE id=? AND ownerId=?").get(publish[1], userId)) !== JSON.stringify(share)) throw new SharePublicationError("SHARE_CHANGED", "本机分享设置已变化，请重试");
      const { id, noteId, shareToken, permission, password, expiresAt, maxViews, isActive } = share;
      const result = await remote(userId, bound, "/shares/import-desktop", "POST", { id, noteId, shareToken, permission, passwordHash: password, expiresAt, maxViews, isActive, expectedNoteVersion });
      if (result.status >= 200 && result.status < 300) {
        if (result.data.id !== id || result.data.shareToken !== shareToken || result.data.noteId !== noteId) throw new SharePublicationError("SHARE_SERVER_UNAVAILABLE", "服务端分享确认不匹配，发布状态待核验", 502);
        const { profile } = sameServer(userId, bound);
        publications().prepare("INSERT OR IGNORE INTO desktop_share_publications VALUES(?,?)").run(profile.id, id);
      }
      return Response.json(result.data, { status: result.status, headers: { "Cache-Control": "no-store" } });
    }
    const body = ["POST", "PUT"].includes(request.method) ? await request.clone().json() : undefined;
    if (["POST", "PUT"].includes(request.method) && (!body || typeof body !== "object" || Array.isArray(body))) throw new SharePublicationError("INVALID_SHARE_PUBLICATION", "分享参数无效", 400);
    if (request.method === "POST" && (path === "" || path === "/")) body.expectedNoteVersion = await requirePublishedNote(userId, bound, body?.noteId);
    const result = await remote(userId, bound, "/shares" + path + url.search, request.method, body);
    if (result.status === 200 && request.method === "GET" && /^\/note\/[\w-]+$/.test(path) && Array.isArray(result.data)) {
      const noteId = path.slice("/note/".length), ids = new Set(result.data.map((share: any) => share.id));
      const { profile } = sameServer(userId, bound), db = publications();
      const legacy = getDb().prepare("SELECT * FROM shares WHERE noteId=? AND ownerId=? ORDER BY createdAt DESC").all(noteId, userId) as any[];
      for (const { password, ...share } of legacy) {
        if (result.data.some((saved: any) => saved.id === share.id && saved.shareToken === share.shareToken && saved.noteId === share.noteId)) {
          db.prepare("INSERT OR IGNORE INTO desktop_share_publications VALUES(?,?)").run(profile.id, share.id);
        } else if (!ids.has(share.id) && !db.prepare("SELECT 1 FROM desktop_share_publications WHERE profileId=? AND shareId=?").get(profile.id, share.id)) {
          result.data.push({ ...share, hasPassword: !!password, localOnly: true });
        }
      }
    }
    return Response.json(result.data, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SharePublicationError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: "无法连接笔记服务端，分享未确认发布，请恢复连接后重试", code: "SHARE_SERVER_UNAVAILABLE" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
