import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db/schema.js";
import { JWT_SECRET } from "../lib/auth-security.js";
import { initApiTokensTable } from "../lib/api-tokens.js";
import { CaptureError, captureInput, getCapture, initCaptures, presentCapture, submitCapture, type CaptureActor } from "./captures.js";
import { hasPermission, resolveNotebookPermission } from "../middleware/acl.js";
import { captureImagesSchema } from "./capture-images";

const lines = z.array(z.string().trim().min(1).max(200)).max(100);
const serviceAddress = z.string().trim().max(2000).default("").refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !/^\/app(?:\/|$)/.test(url.pathname); }
  catch { return false; }
}, "请填写不含凭据、查询参数或片段的 HTTP/HTTPS 服务地址");
export const clipboardSettingsSchema = z.object({
  integrationMode: z.enum(["nas", "standalone"]).default("nas"),
  standaloneUrl: serviceAddress,
  enabled: z.boolean().default(false),
  organize: z.boolean().default(true),
  notebookId: z.string().max(160).default(""),
  instruction: z.string().trim().max(2000).default("保留事实、数字和链接，按主题整理，优先使用合适的已有目录和笔记。"),
  systemPrompt: z.string().trim().max(6000).default(""),
  minChars: z.number().int().min(1).max(32000).default(1),
  includeKeywords: lines.default([]),
  excludeKeywords: lines.default([]),
  excludeApps: lines.default([]),
  excludeExtensions: lines.default([]),
  filterFiles: z.boolean().default(true),
  filterImages: z.boolean().default(true),
  aiFilterEnabled: z.boolean().default(false),
  aiFilterPrompt: z.string().trim().max(4000).default(""),
}).strict().refine(settings => settings.integrationMode !== "standalone" || !!settings.standaloneUrl, { message: "请填写独立服务地址", path: ["standaloneUrl"] }).refine(settings => !settings.aiFilterEnabled || !!settings.aiFilterPrompt, { message: "启用AI过滤时请填写提示词", path: ["aiFilterPrompt"] });
export type ClipboardSettings = z.infer<typeof clipboardSettingsSchema>;
export const clipboardSubmissionSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  content: z.string().min(1).max(32000).refine(value => !!value.trim()),
  kind: z.enum(["text", "file", "image"]).default("text"),
  sourceApp: z.string().trim().max(200).default(""),
  fileName: z.string().max(500).default(""),
  organize: z.boolean().optional(),
  instruction: z.string().trim().max(2000).default(""),
  notebookId: z.string().min(1).max(160).optional(),
  noteId: z.string().min(1).max(160).optional(),
  images: captureImagesSchema.optional(),
}).strict();
type Submission = z.infer<typeof clipboardSubmissionSchema>;
type Integration = { userId: string; settings: string; nonce: string | null; tokenId: string | null; tokenHash: string | null };
export function isClipboardCapabilityRoute(pathname: string, method: string): boolean {
  return (method === "GET" && pathname === "/api/clipboard/policy")
    || (method === "POST" && pathname === "/api/clipboard/captures")
    || (method === "GET" && /^\/api\/clipboard\/captures\/[A-Za-z0-9_-]{1,160}$/.test(pathname))
    || (method === "POST" && /^\/api\/clipboard\/captures\/[A-Za-z0-9_-]{1,160}\/retry$/.test(pathname));
}
const scopes = JSON.stringify(["notes:read", "notes:write", "notebooks:read", "notebooks:write"]);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const rawToken = (row: Integration) => row.nonce ? "ncc_" + createHmac("sha256", JWT_SECRET).update(`clipboard-token-v1:${row.userId}:${row.nonce}`).digest("base64url") : null;

export function initClipboardIntegration() {
  initApiTokensTable(getDb()); initCaptures();
  getDb().exec(`CREATE TABLE IF NOT EXISTS clipboard_integrations (
    userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings TEXT NOT NULL, nonce TEXT, tokenId TEXT, tokenHash TEXT UNIQUE
  ); CREATE TABLE IF NOT EXISTS clipboard_submissions (
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requestId TEXT NOT NULL, tokenId TEXT NOT NULL, inputHash TEXT NOT NULL,
    jobId TEXT, reasonCode TEXT, PRIMARY KEY(userId,requestId)
  );`);
  getDb().exec(`CREATE TABLE IF NOT EXISTS clipboard_log_actions(userId TEXT NOT NULL,requestId TEXT NOT NULL,hiddenAt TEXT,forcedJobId TEXT,PRIMARY KEY(userId,requestId));`);
  const submissionColumns=getDb().prepare("PRAGMA table_info(clipboard_submissions)").all() as {name:string}[];
  if(!submissionColumns.some(c=>c.name==="originalInput"))getDb().exec("ALTER TABLE clipboard_submissions ADD COLUMN originalInput TEXT");
  const columns = getDb().prepare("PRAGMA table_info(clipboard_submissions)").all() as {name:string}[];
  for (const [name,definition] of [["createdAt","TEXT NOT NULL DEFAULT ''"],["metadata","TEXT NOT NULL DEFAULT '{}' "]]) {
    if (!columns.some(column=>column.name===name)) getDb().exec(`ALTER TABLE clipboard_submissions ADD COLUMN ${name} ${definition}`);
  }
  getDb().exec(`CREATE TABLE IF NOT EXISTS clipboard_rejections(
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,requestId TEXT NOT NULL,
    metadata TEXT NOT NULL,errorCode TEXT NOT NULL,createdAt TEXT NOT NULL DEFAULT(datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT(datetime('now')),PRIMARY KEY(userId,requestId));`);
  const rejectionColumns=getDb().prepare("PRAGMA table_info(clipboard_rejections)").all() as {name:string}[];
  if(!rejectionColumns.some(c=>c.name==="originalInput"))getDb().exec("ALTER TABLE clipboard_rejections ADD COLUMN originalInput TEXT");
}
function integration(userId: string): Integration {
  initClipboardIntegration();
  getDb().prepare("INSERT OR IGNORE INTO clipboard_integrations(userId,settings) VALUES(?,?)")
    .run(userId, JSON.stringify(clipboardSettingsSchema.parse({})));
  return getDb().prepare("SELECT * FROM clipboard_integrations WHERE userId=?").get(userId) as Integration;
}
export function getClipboardSettings(userId: string) {
  const row = integration(userId);
  const active = row.tokenId && getDb().prepare("SELECT 1 FROM api_tokens WHERE id=? AND revokedAt IS NULL").get(row.tokenId);
  return { settings: clipboardSettingsSchema.parse(JSON.parse(row.settings)), tokenSet: !!active,
    endpoint: process.env.NOWEN_CLIPBOARD_PUBLIC_URL || null,
    delivery: process.env.NOWEN_FNOS_SOCKET ? "desktop-required" : "direct" };
}
function setGrant(row: Integration, settings: ClipboardSettings) {
  if (!row.tokenId) return;
  const db = getDb();
  db.prepare("UPDATE api_tokens SET resourceMode=? WHERE id=?").run(settings.notebookId ? "restricted" : "unrestricted", row.tokenId);
  db.prepare("DELETE FROM api_token_resources WHERE tokenId=?").run(row.tokenId);
  if (settings.notebookId) db.prepare(`INSERT INTO api_token_resources(id,tokenId,resourceType,resourceId,permission,includeDescendants)
    VALUES(?,?,'notebook',?,'write',1)`).run(randomUUID(), row.tokenId, settings.notebookId);
}
export function saveClipboardSettings(userId: string, settings: ClipboardSettings) {
  if (settings.notebookId) {
    const folder = getDb().prepare("SELECT userId,workspaceId,isDeleted FROM notebooks WHERE id=?").get(settings.notebookId) as any;
    if (!folder || folder.userId !== userId || folder.workspaceId || folder.isDeleted
      || !hasPermission(resolveNotebookPermission(settings.notebookId, userId).permission, "write")) {
      throw new CaptureError("CAPTURE_TARGET_FORBIDDEN", "请选择个人空间中可写的文件夹");
    }
  }
  getDb().transaction(() => {
    const row = integration(userId);
    getDb().prepare("UPDATE clipboard_integrations SET settings=? WHERE userId=?").run(JSON.stringify(settings), userId);
    setGrant(row, settings);
  })();
  return getClipboardSettings(userId);
}
export function copyClipboardToken(userId: string, rotate = false) {
  return getDb().transaction(() => {
    let row = integration(userId);
    const active = row.tokenId && getDb().prepare("SELECT 1 FROM api_tokens WHERE id=? AND revokedAt IS NULL").get(row.tokenId);
    if (!active || !row.nonce || hash(rawToken(row)!) !== row.tokenHash || rotate) {
      if (row.tokenId) getDb().prepare("UPDATE api_tokens SET revokedAt=datetime('now') WHERE id=?").run(row.tokenId);
      row = { ...row, nonce: randomBytes(32).toString("base64url"), tokenId: randomUUID() };
      const raw = rawToken(row)!;
      // This internal grant has no usable PAT: the external ncc_ token is accepted only by clipboard routes.
      getDb().prepare("INSERT INTO api_tokens(id,userId,name,tokenHash,scopes) VALUES(?,?,?,?,?)")
        .run(row.tokenId, userId, "剪贴板集成（专用授权）", hash(randomBytes(32).toString("hex")), scopes);
      getDb().prepare("UPDATE clipboard_integrations SET nonce=?,tokenId=?,tokenHash=? WHERE userId=?")
        .run(row.nonce, row.tokenId, hash(raw), userId);
      setGrant(row, clipboardSettingsSchema.parse(JSON.parse(row.settings)));
    }
    return { token: rawToken(row)! };
  })();
}
export function revokeClipboardToken(userId: string) {
  const row = integration(userId);
  getDb().transaction(() => {
    if (row.tokenId) getDb().prepare("UPDATE api_tokens SET revokedAt=datetime('now') WHERE id=?").run(row.tokenId);
    getDb().prepare("UPDATE clipboard_integrations SET nonce=NULL,tokenId=NULL,tokenHash=NULL WHERE userId=?").run(userId);
  })();
}
export function authenticateClipboard(raw: string): CaptureActor {
  initClipboardIntegration();
  if (!/^ncc_[A-Za-z0-9_-]{43}$/.test(raw)) throw new CaptureError("CLIPBOARD_TOKEN_INVALID", "剪贴板Token无效或已撤销", 401);
  const row = getDb().prepare(`SELECT i.* FROM clipboard_integrations i JOIN users u ON u.id=i.userId
    JOIN api_tokens t ON t.id=i.tokenId WHERE i.tokenHash=? AND u.isDisabled=0 AND t.userId=i.userId
    AND t.revokedAt IS NULL AND (t.expiresAt IS NULL OR julianday(t.expiresAt)>julianday('now'))`).get(hash(raw)) as Integration | undefined;
  if (!row || !clipboardSettingsSchema.parse(JSON.parse(row.settings)).enabled) throw new CaptureError("CLIPBOARD_TOKEN_INVALID", "剪贴板集成未启用或Token已撤销", 401);
  return { userId: row.userId, tokenId: row.tokenId };
}
export function clipboardFilter(settings: ClipboardSettings, input: Submission): string | null {
  if (input.kind === "file" && settings.filterFiles) return "FILE_FILTERED";
  if (input.kind === "image" && settings.filterImages) return "IMAGE_FILTERED";
  if (input.content.trim().length < settings.minChars) return "TEXT_TOO_SHORT";
  const content = input.content.toLowerCase();
  if (settings.includeKeywords.length && !settings.includeKeywords.some(word => content.includes(word.toLowerCase()))) return "KEYWORD_NOT_INCLUDED";
  if (settings.excludeKeywords.some(word => content.includes(word.toLowerCase()))) return "KEYWORD_EXCLUDED";
  if (settings.excludeApps.some(app => input.sourceApp.toLowerCase() === app.toLowerCase())) return "APP_EXCLUDED";
  const extension = input.fileName.split(".").slice(1).at(-1)?.toLowerCase();
  if (extension && settings.excludeExtensions.some(ext => ext.replace(/^\./, "").toLowerCase() === extension)) return "EXTENSION_EXCLUDED";
  // A bare credential carries no service/account context for automatic filing.
  if (!input.noteId && input.kind === "text" && !input.images?.length
    && /^(?:Bearer\s+)?(?:sk-|ncc_)[A-Za-z0-9._~+\/-]{16,}={0,2}$/i.test(input.content.trim())) return "CAPTURE_UNCLEAR_PURPOSE";
  return null;
}
export function submitClipboard(actor: CaptureActor, input: Submission) {
  const metadata = JSON.stringify({preview:input.content.slice(0,160),sourceApp:input.sourceApp,kind:input.kind});
  try { return getDb().transaction(() => {
    const db = getDb();
    const inputHash = hash(JSON.stringify(input));
    const existing = db.prepare("SELECT * FROM clipboard_submissions WHERE userId=? AND requestId=?").get(actor.userId,input.requestId) as any;
    if (existing) {
      if (existing.tokenId !== actor.tokenId) throw new CaptureError("CAPTURE_NOT_FOUND", "收集任务不存在", 404);
      if (existing.inputHash !== inputHash) throw new CaptureError("CAPTURE_REQUEST_CONFLICT", "同一个requestId不能提交不同内容", 409);
      return existing.jobId ? { ...presentCapture(getCapture(actor, existing.jobId)), duplicate: true }
        : { requestId: input.requestId, status: "filtered", reasonCode: existing.reasonCode, duplicate: true };
    }
    const { settings } = getClipboardSettings(actor.userId);
    const reasonCode = clipboardFilter(settings, input);
    let jobId: string | null = null;
    let result: any;
    if (reasonCode) result = { requestId: input.requestId, status: "filtered", reasonCode, duplicate: false };
    else {
      const effective = captureInput.parse({ requestId: input.requestId, content: input.content,
        minFolderDepth: 2,
        organize: input.organize ?? settings.organize,
        instruction: [settings.instruction, input.instruction].filter(Boolean).join("\n").slice(0,2000),
        ...(settings.systemPrompt ? { systemPrompt: settings.systemPrompt } : {}),
        ...(settings.aiFilterEnabled ? { aiFilterPrompt: settings.aiFilterPrompt } : {}),
        ...((input.notebookId || settings.notebookId) ? { notebookId: input.notebookId || settings.notebookId } : {}),
        ...(input.noteId ? { noteId: input.noteId } : {}),
        ...(!settings.filterImages&&input.images?.length?{images:input.images}:{}),
      });
      const submitted = submitCapture(actor, effective); jobId = submitted.job.id;
      result = { ...presentCapture(submitted.job), duplicate: submitted.duplicate };
    }
    const logMetadata=reasonCode==="CAPTURE_UNCLEAR_PURPOSE"?JSON.stringify({preview:"无用途说明的密钥片段",sourceApp:input.sourceApp,kind:input.kind}):metadata;
    db.prepare("INSERT INTO clipboard_submissions(userId,requestId,tokenId,inputHash,jobId,reasonCode,createdAt,metadata,originalInput) VALUES(?,?,?,?,?,?,datetime('now'),?,?)")
      .run(actor.userId,input.requestId,actor.tokenId,inputHash,jobId,reasonCode,logMetadata,jobId?null:JSON.stringify(input));
    db.prepare("DELETE FROM clipboard_rejections WHERE userId=? AND requestId=?").run(actor.userId,input.requestId);
    return result;
  })(); } catch(error) {
    if (error instanceof CaptureError && !["CAPTURE_REQUEST_CONFLICT","CAPTURE_NOT_FOUND"].includes(error.code)) getDb().prepare(`INSERT INTO clipboard_rejections(userId,requestId,metadata,errorCode,originalInput) VALUES(?,?,?,?,?)
      ON CONFLICT(userId,requestId) DO UPDATE SET errorCode=excluded.errorCode,updatedAt=datetime('now'),originalInput=excluded.originalInput`).run(actor.userId,input.requestId,metadata,error.code,JSON.stringify(input));
    throw error;
  }
}

/** Account-only log: external collection Tokens cannot enumerate submitted content. */
export function listClipboardLogs(userId:string, offset=0) {
  initClipboardIntegration();
  const rows=getDb().prepare(`WITH entries AS (
    SELECT s.requestId,COALESCE(a.forcedJobId,s.jobId) jobId,s.reasonCode,s.createdAt,s.metadata,s.originalInput,a.hiddenAt,'filtered' fallbackStatus FROM clipboard_submissions s
    LEFT JOIN clipboard_log_actions a ON a.userId=s.userId AND a.requestId=s.requestId WHERE s.userId=?
    UNION ALL SELECT r.requestId,a.forcedJobId,r.errorCode,r.createdAt,r.metadata,r.originalInput,a.hiddenAt,'failed' fallbackStatus FROM clipboard_rejections r
    LEFT JOIN clipboard_log_actions a ON a.userId=r.userId AND a.requestId=r.requestId WHERE r.userId=?
  ) SELECT e.requestId,e.jobId,CASE WHEN j.undoneAt IS NOT NULL THEN 'undone' ELSE COALESCE(j.status,e.fallbackStatus) END status,
    CASE WHEN j.id IS NOT NULL THEN COALESCE(j.errorCode,CASE WHEN j.status='filtered' THEN 'AI_FILTERED' END) ELSE e.reasonCode END code,
    COALESCE(NULLIF(e.createdAt,''),j.createdAt) createdAt,COALESCE(j.updatedAt,NULLIF(e.createdAt,'')) updatedAt,e.metadata,
    substr(json_extract(j.input,'$.content'),1,160) preview,json_extract(j.result,'$.path') path,
    json_extract(j.result,'$.noteId') noteId,json_extract(j.result,'$.action') action,
    json_extract(j.result,'$.warnings') warnings,json_extract(j.result,'$.imageCount') imageCount,j.errorMessage,
    CASE WHEN e.originalInput IS NOT NULL OR j.input IS NOT NULL THEN 1 ELSE 0 END canForce
    FROM entries e LEFT JOIN capture_jobs j ON j.id=e.jobId AND j.userId=? WHERE e.hiddenAt IS NULL ORDER BY createdAt DESC,e.requestId DESC LIMIT 31 OFFSET ?`).all(userId,userId,userId,offset) as any[];
  const hasMore=rows.length>30;
  return {items:rows.slice(0,30).map(({metadata,preview,warnings,...row})=>{
    const meta=JSON.parse(metadata);return {...row,canForce:!!row.canForce&&["filtered","failed","undone"].includes(row.status),canUndo:row.status==="completed",warnings:warnings?JSON.parse(warnings):[],preview:preview??meta.preview??"",sourceApp:meta.sourceApp||"",kind:meta.kind||"text"};
  }),hasMore};
}
