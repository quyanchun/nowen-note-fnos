import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";
import JSZip from "jszip";
import type Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-voice-"));
process.env.DB_PATH = path.join(tmpDir, "voice.db"); process.env.ELECTRON_USER_DATA = tmpDir;
let db: Database.Database;
let closeDb: () => void;
let app: Hono;
let speech: typeof import("../src/services/speechTranscription");
let settings: typeof import("../src/services/userSpeechSettings");
let extract: typeof import("../src/routes/attachments").extractInlineBase64Images;
const originalFetch = globalThis.fetch;
const AUDIO_ID = "11fe46d6-1a50-4a3b-b251-8486a1e7e9ea";
const TEXT_ID = "22fe46d6-1a50-4a3b-b251-8486a1e7e9ea";
test.before(async () => {
  const [schema, router, service, speechSettings, attachments] = await Promise.all([import("../src/db/schema"), import("../src/routes/voice"), import("../src/services/speechTranscription"), import("../src/services/userSpeechSettings"), import("../src/routes/attachments")]);
  db = schema.getDb(); closeDb = schema.closeDb; speech = service; settings = speechSettings; extract = attachments.extractInlineBase64Images;
  app = new Hono(); app.route("/voice", router.default); app.route("/attachments", attachments.default);
  for (const id of ["voice-a", "voice-b"]) db.prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, 'hash')").run(id, id);
  db.prepare("INSERT INTO notebooks (id, userId, name) VALUES ('voice-nb','voice-a','Voice')").run();
  db.prepare("INSERT INTO notes (id,userId,notebookId,title,content,contentText) VALUES ('voice-note','voice-a','voice-nb','Voice','{}','Voice')").run();
  const attachmentsDir = attachments.getAttachmentsDir(); fs.mkdirSync(attachmentsDir, { recursive: true }); fs.writeFileSync(path.join(attachmentsDir, "voice.webm"), Buffer.from([1, 2, 3]));
  const insert = db.prepare("INSERT INTO attachments (id,noteId,userId,filename,mimeType,size,path) VALUES (?,'voice-note','voice-a',?,?,3,'voice.webm')");
  insert.run(AUDIO_ID, "voice.webm", "audio/webm"); insert.run(TEXT_ID, "text.txt", "text/plain");
});
test.after(() => { closeDb(); fs.rmSync(tmpDir, { recursive: true, force: true }); });
test.afterEach(() => { globalThis.fetch = originalFetch; });
const request = (attachmentId: string, user = "voice-a") => app.request("/voice/transcriptions", { method: "POST", headers: { "X-User-Id": user, "Content-Type": "application/json" }, body: JSON.stringify({ attachmentId }) });

test("speech settings are isolated, masked, and independent from chat settings", async () => {
  settings.setUserSpeechSettings("voice-a", { apiUrl: "https://speech.example/v1", apiKey: "secret-a", model: "whisper-1", language: "zh" });
  const response = await app.request("/voice/settings", { headers: { "X-User-Id": "voice-a" } }); const data = await response.json();
  assert.equal(data.apiKeySet, true); assert.equal(data.configured, true); assert.equal(JSON.stringify(data).includes("secret-a"), false);
  assert.equal(settings.getUserSpeechSettings("voice-b").apiUrl, "");
  settings.setUserSpeechSettings("voice-a", { apiUrl: "https://speech.example/v1", model: "whisper-1", language: null });
  assert.equal(settings.getUserSpeechSettings("voice-a").apiKey, "secret-a");
});
test("anonymous, unauthorized, missing and non-audio attachments cannot be transcribed", async () => {
  assert.equal((await app.request("/voice/settings")).status, 401);
  assert.equal((await request(AUDIO_ID, "voice-b")).status, 403);
  assert.equal((await request(TEXT_ID)).status, 400);
  assert.equal((await request("33fe46d6-1a50-4a3b-b251-8486a1e7e9ea")).status, 404);
});
test("API tokens cannot read speech credentials or invoke paid speech services", async () => {
  for (const endpoint of ["settings", "transcriptions", "test"]) {
    const response = await app.request(`/voice/${endpoint}`, { method: endpoint === "settings" ? "GET" : "POST", headers: { "X-User-Id": "voice-a", "X-Auth-Mode": "api-token" } });
    assert.equal(response.status, 403);
  }
});
test("multipart transcription uses server credentials and returns preview text", async () => {
  globalThis.fetch = (async (url, options) => {
    assert.equal(String(url), "https://speech.example/v1/audio/transcriptions");
    assert.equal((options!.headers as Record<string, string>).Authorization, "Bearer secret-a");
    const form = options!.body as FormData; assert.equal(form.get("model"), "whisper-1"); assert.equal((form.get("file") as File).name, "voice.webm");
    return new Response(JSON.stringify({ text: "今天讨论发布计划", language: "zh" }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const response = await request(AUDIO_ID); assert.equal(response.status, 200); assert.equal((await response.json()).text, "今天讨论发布计划");
});
test("provider failure does not change the stored recording or leak secrets", async () => {
  globalThis.fetch = (async () => new Response("secret-a provider diagnostic", { status: 401 })) as typeof fetch;
  const response = await request(AUDIO_ID); assert.equal(response.status, 502); assert.equal((await response.text()).includes("secret-a"), false);
  assert.equal((db.prepare("SELECT size FROM attachments WHERE id=?").get(AUDIO_ID) as { size: number }).size, 3);
});
test("missing speech configuration and oversized recordings fail before provider upload", async () => {
  await assert.rejects(speech.transcribeSpeech({ apiUrl: "", apiKey: "", model: "whisper-1", language: null }, new Uint8Array(3), "voice.webm", "audio/webm"), /配置/);
  db.prepare("UPDATE attachments SET size=? WHERE id=?").run(speech.MAX_TRANSCRIPTION_BYTES + 1, AUDIO_ID);
  assert.equal((await request(AUDIO_ID)).status, 413); db.prepare("UPDATE attachments SET size=3 WHERE id=?").run(AUDIO_ID);
});
test("ZIP imported audio is extracted into attachment storage and references remain discoverable", async () => {
  const data = Buffer.from([4, 5, 6]).toString("base64");
  const result = extract(`<audio controls src="data:audio/mp4;base64,${data}"></audio>`, "voice-a", "voice-note", null);
  assert.equal(result.replacedCount, 1); assert.match(result.content, /\/api\/attachments\//);
  const row = db.prepare("SELECT mimeType FROM attachments WHERE id=?").get(result.attachmentIds[0]) as { mimeType: string }; assert.equal(row.mimeType, "audio/mp4");
  const refs = await import("../src/lib/attachmentRefs"); assert.deepEqual([...refs.extractAttachmentIdsFromContent(result.content)], result.attachmentIds);
});
test("the existing upload pipeline preserves recorded audio MIME and ownership", async () => {
  for (const mimeType of ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"]) {
    const form = new FormData(); form.set("noteId", "voice-note");
    form.set("file", new File([new Uint8Array([1, 2, 3, mimeType.length])], `voice.${mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm"}`, { type: mimeType }));
    const response = await app.request("/attachments", { method: "POST", headers: { "X-User-Id": "voice-a" }, body: form });
    assert.equal(response.status, 201); const result = await response.json(); assert.match(result.mimeType, /^audio\//);
    const row = db.prepare("SELECT noteId, userId FROM attachments WHERE id=?").get(result.id) as { noteId: string; userId: string };
    assert.deepEqual(row, { noteId: "voice-note", userId: "voice-a" });
  }
});
test("reliable Markdown ZIP exports include nested audio sources even with inline images enabled", async () => {
  const service = await import("../src/services/reliableExportJobs");
  const created = service.createReliableMarkdownExportJob({ userId: "voice-a", inlineImages: true, notes: [{ id: "voice-note", title: "Voice", notebookName: "Memo", createdAt: "2026-09-30", updatedAt: "2026-09-30", markdown: `<audio controls><source src="/api/attachments/${AUDIO_ID}" type="audio/webm"></audio>` }] });
  let snapshot = created;
  for (let i = 0; i < 300 && snapshot.state !== "ready" && snapshot.state !== "error"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10)); snapshot = service.getReliableExportJob(created.id, "voice-a")!;
  }
  assert.equal(snapshot.state, "ready", snapshot.message);
  const downloadApp = new Hono(); downloadApp.get("/download/:token", service.handleReliableExportDownload);
  const response = await downloadApp.request(`/download/${snapshot.downloadToken}`); assert.equal(response.status, 200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const markdown = await zip.file("Memo/Voice.md")!.async("string"); assert.match(markdown, /<audio/); assert.match(markdown, /\.\/assets\//); assert.equal(markdown.includes(`/api/attachments/${AUDIO_ID}`), false);
  const asset = Object.values(zip.files).find((entry) => !entry.dir && entry.name.endsWith(".webm")); assert.ok(asset); assert.deepEqual([...await asset.async("uint8array")], [1, 2, 3]);
});

test("speech reuses a saved channel's current credentials and headers while keeping its own model (DCC-006)", async () => {
  const { setUserAISettings } = await import("../src/services/user-ai-settings");
  const profile = { id: "speech-channel", name: "测试渠道", provider: "custom", apiUrl: "https://channel.example/v1", apiKey: "channel-key", customHeaders: { zhixing: "Bearer channel-token", "content-type": "application/json" }, model: "chat-only" };
  const saveProfile = () => setUserAISettings("voice-a", [{ key: "ai_profiles_v1", value: JSON.stringify([profile]) }]);
  saveProfile();
  const response = await app.request("/voice/settings", { method: "PUT", headers: { "X-User-Id": "voice-a", "Content-Type": "application/json" }, body: JSON.stringify({ source: "profile", profileId: profile.id, model: "speech-model", language: "zh" }) });
  assert.equal(response.status, 200); const data = await response.json() as any;
  assert.equal(data.source, "profile"); assert.equal(data.profileId, profile.id); assert.equal(data.configured, true);
  assert.doesNotMatch(JSON.stringify(data), /channel-key|channel-token/);
  assert.equal(settings.getUserSpeechSettings("voice-a").apiKey, "secret-a", "must not copy the channel key into standalone speech settings");
  let requests = 0;
  globalThis.fetch = (async (url, options) => {
    requests++;
    assert.equal(String(url), `${profile.apiUrl}/audio/transcriptions`);
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${profile.apiKey}`);
    assert.equal(headers.get("zhixing"), "Bearer channel-token");
    assert.equal(headers.has("content-type"), false, "multipart boundary must be generated from FormData");
    assert.equal((options!.body as FormData).get("model"), "speech-model");
    return Response.json({ text: "channel transcription", language: "zh" });
  }) as typeof fetch;
  assert.equal((await request(AUDIO_ID)).status, 200);
  profile.apiUrl = "https://changed-channel.example/v1"; profile.apiKey = "changed-channel-key"; saveProfile();
  assert.equal((await app.request("/voice/test", { method: "POST", headers: { "X-User-Id": "voice-a" } })).status, 200);
  assert.equal(requests, 2);
  const foreign = await app.request("/voice/settings", { method: "PUT", headers: { "X-User-Id": "voice-b", "Content-Type": "application/json" }, body: JSON.stringify({ source: "profile", profileId: profile.id, model: "speech-model" }) });
  assert.equal(foreign.status, 400);
  setUserAISettings("voice-a", [{ key: "ai_profiles_v1", value: "[]" }]);
  const deleted = await request(AUDIO_ID); assert.equal(deleted.status, 400); assert.match(await deleted.text(), /渠道.*删除|渠道.*不存在/);
  assert.equal(requests, 2, "deleted channel must not fall back to standalone or another user's credentials");
});

test("speech draft tests custom headers without saving and preserves standalone keys on masked updates", async () => {
  const headers = { "X-User-Id": "voice-b", "Content-Type": "application/json" };
  const body = { source: "custom", apiUrl: "https://standalone.example/v1", apiKey: "speech-own-key", customHeaders: { zhixing: "Bearer own-token" }, model: "whisper-1", language: null };
  globalThis.fetch = (async (_url, options) => {
    assert.equal(new Headers(options?.headers).get("zhixing"), "Bearer own-token");
    return Response.json({ text: "test" });
  }) as typeof fetch;
  assert.equal((await app.request("/voice/test", { method: "POST", headers, body: JSON.stringify(body) })).status, 200);
  assert.equal(settings.getUserSpeechSettings("voice-b").apiUrl, "", "testing a draft must not save it");
  const saved = await app.request("/voice/settings", { method: "PUT", headers, body: JSON.stringify(body) });
  assert.equal(saved.status, 200); const publicSettings = await saved.json() as any;
  assert.deepEqual(publicSettings.customHeaders, { zhixing: "****" }); assert.doesNotMatch(JSON.stringify(publicSettings), /own-token|speech-own-key/);
  assert.equal((await app.request("/voice/settings", { method: "PUT", headers, body: JSON.stringify({ ...body, apiKey: undefined, customHeaders: publicSettings.customHeaders }) })).status, 200);
  assert.equal(settings.getUserSpeechSettings("voice-b").customHeaders?.zhixing, "Bearer own-token");
  assert.equal((await app.request("/voice/settings", { method: "PUT", headers, body: JSON.stringify({ ...body, customHeaders: {} }) })).status, 200);
  assert.deepEqual(Object.keys(settings.getUserSpeechSettings("voice-b").customHeaders || {}), []);
});

test("speech can follow the active chat channel without inheriting its model or altering standalone credentials", async () => {
  const { setUserAISettings } = await import("../src/services/user-ai-settings");
  setUserAISettings("voice-b", [
    { key: "ai_api_url", value: "https://active-channel.example/v1" }, { key: "ai_api_key", value: "active-key" },
    { key: "ai_model", value: "chat-model" }, { key: "ai_custom_headers", value: JSON.stringify({ zhixing: "Bearer active-token" }) },
  ]);
  const response = await app.request("/voice/settings", { method: "PUT", headers: { "X-User-Id": "voice-b", "Content-Type": "application/json" }, body: JSON.stringify({ source: "chat", model: "speech-only-model", language: null }) });
  assert.equal(response.status, 200);
  const resolved = settings.resolveUserSpeechSettings("voice-b");
  assert.equal(resolved.apiUrl, "https://active-channel.example/v1"); assert.equal(resolved.apiKey, "active-key");
  assert.equal(resolved.customHeaders?.zhixing, "Bearer active-token"); assert.equal(resolved.model, "speech-only-model");
  assert.equal(settings.getUserSpeechSettings("voice-b").apiKey, "speech-own-key");
  assert.notEqual(settings.resolveUserSpeechSettings("voice-a").apiKey, "active-key");
});

test("home voice input transcribes an uploaded audio file with saved credentials without creating notes or attachments", async () => {
  settings.setUserSpeechSettings("voice-a", { source: "custom", apiUrl: "https://speech.example/v1", apiKey: "voice-key", customHeaders: { zhixing: "Bearer synthetic" }, model: "qwen3-asr-1.7b-q8", language: null });
  const notesBefore = (db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n;
  const attachmentsBefore = (db.prepare("SELECT COUNT(*) AS n FROM attachments").get() as { n: number }).n;
  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer voice-key");
    assert.equal(new Headers(init?.headers).get("zhixing"), "Bearer synthetic");
    assert.equal((init?.body as FormData).get("model"), "qwen3-asr-1.7b-q8");
    return new Response(JSON.stringify({ text: "这是首页语音输入。" }), { headers: { "Content-Type": "application/json" } });
  };
  const form = new FormData(); form.append("file", new Blob([speech.speechConnectionProbe()], { type: "audio/wav" }), "probe.wav");
  const response = await app.request("/voice/input", { method: "POST", headers: { "X-User-Id": "voice-a" }, body: form });
  assert.equal(response.status, 200); assert.equal((await response.json()).text, "这是首页语音输入。");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n, notesBefore);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM attachments").get() as { n: number }).n, attachmentsBefore);
});

test("home voice input rejects anonymous and API-token callers, non-audio uploads and oversized recordings", async () => {
  const form = () => { const data = new FormData(); data.append("file", new Blob(["text"], { type: "text/plain" }), "test.txt"); return data; };
  assert.equal((await app.request("/voice/input", { method: "POST", body: form() })).status, 401);
  assert.equal((await app.request("/voice/input", { method: "POST", headers: { "X-User-Id": "voice-a", "X-Auth-Mode": "api-token" }, body: form() })).status, 403);
  assert.equal((await app.request("/voice/input", { method: "POST", headers: { "X-User-Id": "voice-a" }, body: form() })).status, 400);
  const large = new FormData(); large.append("file", new Blob([new Uint8Array(speech.MAX_TRANSCRIPTION_BYTES + 1)], { type: "audio/wav" }), "large.wav");
  assert.equal((await app.request("/voice/input", { method: "POST", headers: { "X-User-Id": "voice-a" }, body: large })).status, 413);
});
