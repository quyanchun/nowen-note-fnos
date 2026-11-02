import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { getDb } from "../db/schema";
import { hasPermission, resolveNotePermission } from "../middleware/acl";
import { readAttachmentObject } from "../services/attachment-storage";
import { buildUserSpeechSettings, getUserSpeechSettings, publicSpeechSettings, resolveUserSpeechSettings, setUserSpeechSettings } from "../services/userSpeechSettings";
import { MAX_TRANSCRIPTION_BYTES, SpeechTranscriptionError, speechConnectionProbe, speechEndpoint, transcribeSpeech } from "../services/speechTranscription";

const voice = new Hono();
const language = z.string().regex(/^(auto|[a-z]{2,3})$/).nullable().optional();
const settingsSchema = z.object({ apiUrl: z.string().max(2048).optional(), source: z.enum(["custom", "profile", "chat"]).optional(), profileId: z.string().max(100).optional(), customHeaders: z.union([z.record(z.string()), z.string().max(16384)]).optional(), apiKey: z.string().max(4096).optional(), model: z.string().trim().min(1).max(200), language });

voice.use("*", async (c, next) => {
  if (!c.req.header("X-User-Id")) return c.json({ error: "Unauthorized" }, 401);
  // 语音服务配置和调用仅向登录用户开放，避免通用 API Token 越过资源授权。
  if (c.req.header("X-Auth-Mode") === "api-token") return c.json({ error: "语音功能需要用户登录" }, 403);
  await next();
});

voice.get("/settings", (c) => {
  const userId = c.req.header("X-User-Id")!;
  return c.json(publicSpeechSettings(getUserSpeechSettings(userId), resolveUserSpeechSettings(userId)));
});
voice.put("/settings", async (c) => {
  const input = settingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "语音配置无效" }, 400);
  if (input.data.apiUrl) {
    try { speechEndpoint(input.data.apiUrl); } catch { return c.json({ error: "请输入有效的 HTTP/HTTPS 服务地址" }, 400); }
  }
  const userId = c.req.header("X-User-Id")!;
  try {
    setUserSpeechSettings(userId, { ...input.data, language: input.data.language === "auto" ? null : input.data.language || null });
    return c.json(publicSpeechSettings(getUserSpeechSettings(userId), resolveUserSpeechSettings(userId)));
  } catch (error) { return c.json({ error: (error as Error).message }, 400); }
});

voice.post("/test", async (c) => {
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json().catch(() => ({}));
  let draft;
  if (body && Object.keys(body).length) {
    const input = settingsSchema.safeParse(body);
    if (!input.success) return c.json({ error: "语音配置无效" }, 400);
    if (input.data.apiUrl) {
      try { speechEndpoint(input.data.apiUrl); } catch { return c.json({ error: "请输入有效的 HTTP/HTTPS 服务地址" }, 400); }
    }
    try { draft = buildUserSpeechSettings(userId, { ...input.data, language: input.data.language === "auto" ? null : input.data.language || null }); }
    catch (error) { return c.json({ error: (error as Error).message }, 400); }
  }
  try {
    await transcribeSpeech(resolveUserSpeechSettings(userId, draft), speechConnectionProbe(), "probe.wav", "audio/wav", "auto", c.req.raw.signal);
    return c.json({ success: true });
  } catch (error) {
    if (error instanceof SpeechTranscriptionError) return c.json({ error: error.message }, error.status);
    return c.json({ error: "语音转写测试失败" }, 502);
  }
});

voice.post("/transcriptions", async (c) => {
  const input = z.object({ attachmentId: z.string().uuid(), language }).safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "转写请求无效" }, 400);
  const row = getDb().prepare("SELECT id, noteId, mimeType, size, path, filename FROM attachments WHERE id = ?").get(input.data.attachmentId) as { noteId: string; mimeType: string; size: number; path: string; filename: string } | undefined;
  if (!row) return c.json({ error: "附件不存在" }, 404);
  if (!hasPermission(resolveNotePermission(row.noteId, c.req.header("X-User-Id")!).permission, "read")) return c.json({ error: "无权读取此附件" }, 403);
  if (!row.mimeType.toLowerCase().startsWith("audio/")) return c.json({ error: "仅支持音频附件转写" }, 400);
  if (row.size > MAX_TRANSCRIPTION_BYTES) return c.json({ error: "音频超过转写限制（25 MB）" }, 413);
  try {
    const bytes = await readAttachmentObject(row.path);
    if (!bytes) return c.json({ error: "附件文件不存在" }, 404);
    return c.json(await transcribeSpeech(resolveUserSpeechSettings(c.req.header("X-User-Id")!), bytes, row.filename, row.mimeType, input.data.language, c.req.raw.signal));
  } catch (error) {
    if (error instanceof SpeechTranscriptionError) return c.json({ error: error.message }, error.status);
    return c.json({ error: "读取或转写音频失败" }, 502);
  }
});

// Homepage dictation returns editable text without first creating a note or attachment.
voice.post("/input", bodyLimit({ maxSize: MAX_TRANSCRIPTION_BYTES + 128 * 1024,
  onError: c => c.json({ error: "音频超过转写限制（25 MB）" }, 413) }), async c => {
  const body = await c.req.parseBody().catch(() => null);
  const file = body?.file;
  if (!(file instanceof Blob) || !file.type.toLowerCase().startsWith("audio/")) return c.json({ error: "请选择有效的音频文件" }, 400);
  if (file.size > MAX_TRANSCRIPTION_BYTES) return c.json({ error: "音频超过转写限制（25 MB）" }, 413);
  if (!file.size) return c.json({ error: "未录到有效音频" }, 400);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = "name" in file && typeof file.name === "string" ? file.name : "recording.webm";
    return c.json(await transcribeSpeech(resolveUserSpeechSettings(c.req.header("X-User-Id")!), bytes, name, file.type, "auto", c.req.raw.signal));
  } catch (error) {
    if (error instanceof SpeechTranscriptionError) return c.json({ error: error.message }, error.status);
    return c.json({ error: "语音输入转写失败，请重试" }, 502);
  }
});

export default voice;
