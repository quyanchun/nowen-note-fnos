import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ organize: vi.fn(), list: vi.fn(), search: vi.fn(), ask: vi.fn(), openAsk:vi.fn(), transcribe: vi.fn(), save: vi.fn(), read: vi.fn(), write: vi.fn(), scope: "user:personal", refreshNotes: vi.fn(), refreshNotebooks: vi.fn(), recorder: null as any }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }) }));
vi.mock("@/lib/homeCaptureAI", () => ({ defaultCapturePreferences: { method: "tidy" }, organizeCapture: m.organize }));
vi.mock("@/i18n", () => ({ default: { language: "zh-CN" } }));
vi.mock("@/lib/api", () => ({ api: { getNotes: m.list, search: m.search, aiAsk: m.ask }, voiceApi: { transcribeFile: m.transcribe } }));
vi.mock("@/store/AppContext", () => ({ useAppActions: () => ({ refreshNotes: m.refreshNotes, refreshNotebooks: m.refreshNotebooks }) }));
vi.mock("@/hooks/useSiteSettings", () => ({ useSiteSettings: () => ({ siteConfig: { title: "nowen-note", favicon: "" } }) }));
vi.mock("@/lib/homeCapture", () => ({ getHomeCaptureScope: () => m.scope, emptyHomeCapture: (key: string) => ({ key, id: "draft-id", text: "", files: [] }), homeCaptureStore: { read: m.read, write: m.write }, saveHomeCapture: m.save }));
vi.mock("@/lib/liveDictation",async original=>({...await original<typeof import("@/lib/liveDictation")>(),LiveDictationSession:class {
 state="idle";constructor(private changed:(value:any)=>void,public segment:(voice:any)=>void){m.recorder=this;}
 async start(){this.state="recording";this.changed("recording");}
 async stop(){this.state="idle";this.changed("idle");}
 async cancel(){await this.stop();}
}}));
import HomePage from "../HomePage";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement; let root: Root;
const open = vi.fn(); const resource = vi.fn();
beforeEach(() => { vi.clearAllMocks(); m.scope = "user:personal"; m.list.mockResolvedValue([]); m.read.mockResolvedValue(undefined); m.write.mockResolvedValue(undefined); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render(refreshToken = 0) { await act(async () => root.render(<HomePage scope={m.scope} refreshToken={refreshToken} onOpenNote={open} onSearch={resource} onAsk={m.openAsk} />)); }
function button(text: string) { return [...host.querySelectorAll("button")].find(el => el.textContent === text)!; }
function input(el: HTMLInputElement | HTMLTextAreaElement, text: string) { act(() => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, text); el.dispatchEvent(new Event("input", { bubbles: true })); }); }
const summaryNote = (id: string, extra = {}) => ({ id, title: `概览笔记${id}`, contentText: "预览正文", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...extra });
it("shows the site logo and name above the home capture area", async () => {
  await render();
  const header = host.querySelector("header")!;
  expect(header.textContent).toContain("nowen-note");
  expect(header.querySelector('[aria-hidden="true"]')?.textContent).toBe("N");
  expect(header.textContent).toContain("让想法，有迹可循");
});
it("loads the home overview without first opening a list and refreshes after changes", async () => {
  m.list.mockResolvedValueOnce([summaryNote("a"), summaryNote("b"), summaryNote("trash", { isTrashed: 1 }), summaryNote("archive", { isArchived: 1 })]);
  await render(); expect(m.list).toHaveBeenCalledOnce(); expect(host.textContent).toContain("全部 2 条"); expect(host.textContent).not.toContain("概览笔记trash"); expect(host.textContent).not.toContain("概览笔记archive");
  const recent = [...host.querySelectorAll("button")].find(el => el.textContent?.includes("概览笔记a"))!;
  await act(async () => recent.click()); expect(open).toHaveBeenCalledWith("a");
  m.list.mockResolvedValueOnce([summaryNote("c")]); await render(1); expect(host.textContent).toContain("全部 1 条"); expect(host.textContent).not.toContain("概览笔记a");
});
it("does not show zero or another account's overview while a scoped request is pending (DCC-006)", async () => {
  let old!: (value: unknown) => void; let next!: (value: unknown) => void;
  m.list.mockImplementationOnce(() => new Promise(done => { old = done; }));
  await render(); expect(host.textContent).not.toContain("全部 0 条");
  m.scope = "other-user:personal"; m.list.mockImplementationOnce(() => new Promise(done => { next = done; })); await render();
  await act(async () => old([summaryNote("private-old")])); expect(host.textContent).not.toContain("概览笔记private-old");
  await act(async () => next([summaryNote("new")])); expect(host.textContent).toContain("概览笔记new");
});
it("shows an overview failure instead of inventing an empty library", async () => {
  m.list.mockRejectedValueOnce(new Error("HTTP 503")); await render(); expect(host.textContent).toContain("无法加载笔记概览"); expect(host.textContent).not.toContain("全部 0 条");
});
it("parses SQLite UTC timestamps consistently with ISO timestamps in the overview", async () => {
  const sql = new Date().toISOString().slice(0, 19).replace("T", " ");
  m.list.mockResolvedValueOnce([summaryNote("sql", { createdAt: sql, updatedAt: sql })]);
  await render(); expect(host.textContent).toContain("刚刚"); expect(host.textContent).not.toContain("8 小时前");
});
it("opens the dedicated search page and delegates knowledge questions", async () => {
  m.search.mockResolvedValue([{ id: "note-1", title: "项目记录", snippet: "相关正文" }]);
  m.ask.mockImplementation(async (_q, _h, chunk, refs) => { chunk("回答正文"); refs([{ id: "note-1", title: "来源笔记" }]); return "回答正文"; });
  await render(); input(host.querySelector("input")!, "项目");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(resource).toHaveBeenCalledWith("项目");
  expect(m.search).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("项目记录");
  await act(async () => button("知识问答").click());
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(m.openAsk).toHaveBeenCalledWith("项目");expect(m.ask).not.toHaveBeenCalled();expect(host.textContent).not.toContain("回答正文");
});
it("keeps typed text on save failure and clears it only after confirmed save", async () => {
  await render(); input(host.querySelector("textarea")!, "需要保留的中文");
  m.save.mockRejectedValueOnce(new Error("HTTP 503"));
  await act(async () => button("保存为笔记").click());
  expect(host.querySelector("textarea")!.value).toBe("需要保留的中文"); expect(host.textContent).toContain("HTTP 503"); expect(m.refreshNotes).not.toHaveBeenCalled();
  m.save.mockResolvedValueOnce({ id: "saved-note" }); await act(async () => button("保存为笔记").click());
  expect(host.querySelector("textarea")!.value).toBe(""); expect(host.textContent).toContain("笔记已保存"); expect(m.refreshNotes).toHaveBeenCalledOnce();
});
it("restores a retained recording and appends its transcription to editable text", async () => {
  m.read.mockResolvedValue({ key: m.scope, id: "draft", text: "已有文字", files: [], voice: { blob: new Blob(["audio"], { type: "audio/wav" }), mimeType: "audio/wav", extension: "wav", durationMs: 1200 } });
  m.transcribe.mockResolvedValue({ text: "这是中文转写", model: "qwen3-asr-1.7b-q8" });
  await render(); expect(host.querySelector("textarea")!.value).toBe("已有文字"); expect(host.textContent).not.toContain("草稿已暂存到本机"); await act(async () => button("重新转写").click());
  expect(host.querySelector("textarea")!.value).toBe("已有文字\n这是中文转写"); expect(m.save).not.toHaveBeenCalled();
});
it("does not submit a home search after its account scope changes", async () => {
  await render(); input(host.querySelector("input")!, "原工作区");
  m.scope = "other-user:personal";
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(resource).not.toHaveBeenCalled(); expect(m.search).not.toHaveBeenCalled();
});
it("waits for an earlier save before enabling a remounted capture editor", async () => {
  let finish!: (note: { id: string }) => void;
  m.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(); input(host.querySelector("textarea")!, "正在保存的内容");
  await act(async () => button("保存为笔记").click());
  act(() => root.unmount()); root = createRoot(host);
  await render();
  expect(host.querySelector("textarea")!.disabled).toBe(true);
  await act(async () => finish({ id: "saved" }));
  expect(host.querySelector("textarea")!.disabled).toBe(false);
});

const wav=()=>({blob:new Blob(["wave"],{type:"audio/wav"}),mimeType:"audio/wav",extension:"wav",durationMs:3000,size:4});
it("toggles click dictation, inserts ordered segments at the caret, and has no audio download toolbar",async()=>{
 await render();const area=host.querySelector("textarea")!;input(area,"前文后文");area.setSelectionRange(2,2);
 await act(async()=>button("语音输入").click());expect(button("停止")).toBeDefined();
 m.transcribe.mockResolvedValueOnce({text:"第一段"}).mockResolvedValueOnce({text:"第二段"});
 await act(async()=>m.recorder.segment(wav()));expect(area.value).toBe("前文第一段后文");
 await act(async()=>m.recorder.segment(wav()));expect(area.value).toBe("前文第一段第二段后文");
 await act(async()=>button("停止").click());expect(button("语音输入")).toBeDefined();expect(host.textContent).not.toContain("下载录音");expect(m.save).not.toHaveBeenCalled();
});
it("retains failed segments and retries without repeating already inserted text",async()=>{
 await render();await act(async()=>button("语音输入").click());m.transcribe.mockRejectedValueOnce(new Error("HTTP 503"));await act(async()=>m.recorder.segment(wav()));
 expect(host.textContent).toContain("HTTP 503");expect(m.write).toHaveBeenCalledWith(expect.objectContaining({voiceSegments:[expect.objectContaining({voice:expect.any(Object)})]}));
 m.transcribe.mockResolvedValueOnce({text:"恢复结果"});await act(async()=>button("重新转写").click());expect(host.querySelector("textarea")!.value).toBe("恢复结果");expect(m.save).not.toHaveBeenCalled();
});
it("ignores a dictation result from an old account scope",async()=>{
 let done:any;await render();await act(async()=>button("语音输入").click());m.transcribe.mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));await act(async()=>m.recorder.segment(wav()));m.scope="other-user:personal";await act(async()=>done({text:"旧账号的语音"}));expect(host.querySelector("textarea")!.value).not.toContain("旧账号的语音");
});
it("starts on the held shortcut and stops on release",async()=>{
 await render();await act(async()=>window.dispatchEvent(new KeyboardEvent("keydown",{key:" ",code:"Space",ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true})));expect(m.recorder.state).toBe("recording");await act(async()=>window.dispatchEvent(new KeyboardEvent("keyup",{key:" ",code:"Space",ctrlKey:true,shiftKey:true,bubbles:true})));expect(m.recorder.state).toBe("idle");
});
it("organizes in the home capture editor, retains the original and can restore it without saving", async () => {
  m.organize.mockResolvedValue("整理后的文字"); await render(); expect(host.querySelector('[aria-label="还原原文"]')).toBeNull(); input(host.querySelector("textarea")!, "原文：保持路径 /tmp/demo.txt");
  await act(async () => button("AI 整理").click());
  expect(m.organize).toHaveBeenCalledWith("原文：保持路径 /tmp/demo.txt", { method: "tidy" }, expect.any(AbortSignal));
  expect(host.querySelector("textarea")!.value).toBe("整理后的文字");
  expect(m.write.mock.calls.at(-1)?.[0]).toMatchObject({ originalText: "原文：保持路径 /tmp/demo.txt", text: "整理后的文字" });
  expect(m.save).not.toHaveBeenCalled();
  const restore = host.querySelector<HTMLButtonElement>('[aria-label="还原原文"]')!;
  expect(restore.closest('[data-home-capture-editor]')).not.toBeNull(); expect(restore.textContent).toBe("");
  expect(restore.title).toBe("还原原文");
  await act(async () => restore.click()); expect(host.querySelector("textarea")!.value).toBe("原文：保持路径 /tmp/demo.txt");
});
it("keeps raw capture text when AI cleanup fails", async () => {
  m.organize.mockRejectedValueOnce(new Error("模型暂不可用")); await render(); input(host.querySelector("textarea")!, "不能丢失的原文");
  await act(async () => button("AI 整理").click());
  expect(host.querySelector("textarea")!.value).toBe("不能丢失的原文"); expect(host.textContent).toContain("模型暂不可用"); expect(m.save).not.toHaveBeenCalled();
});
it("keeps capture preferences for the next note after a confirmed save", async () => {
  m.read.mockResolvedValueOnce({ key: m.scope, id: "old", text: "保存这段", files: [], preferences: { method: "summary", notebookId: "chosen" } });
  m.save.mockResolvedValueOnce({ id: "saved" }); await render(); await act(async () => button("保存为笔记").click());
  expect(m.write.mock.calls.at(-1)?.[0]).toMatchObject({ text: "", preferences: { method: "summary", notebookId: "chosen" } });
  expect(host.querySelector('[aria-label="收集设置"]')).not.toBeNull();
});
it("ignores AI cleanup output after the account changes", async () => {
  let finish!: (value: string) => void; m.organize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(); input(host.querySelector("textarea")!, "原账号的文字"); await act(async () => button("AI 整理").click());
  m.scope = "other-user:personal"; await act(async () => finish("不能写进新账号的结果"));
  expect(host.querySelector("textarea")!.value).toBe("原账号的文字"); expect(m.write.mock.calls.some(([draft]) => draft.text === "不能写进新账号的结果")).toBe(false);
});
it("shows undo only after AI finishes and removes it after restoring the original", async () => {
  let finish!: (text: string) => void;
  m.read.mockResolvedValueOnce({ key: m.scope, id: "draft", text: "上次整理结果", originalText: "最初原文", files: [] });
  m.organize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render();
  expect(host.querySelector('[aria-label="还原原文"]')).not.toBeNull();
  await act(async () => button("AI 整理").click()); expect(host.querySelector('[aria-label="还原原文"]')).toBeNull();
  await act(async () => finish("再次整理结果"));
  const undo = host.querySelector<HTMLButtonElement>('[aria-label="还原原文"]')!; expect(undo).not.toBeNull();
  await act(async () => undo.click()); expect(host.querySelector("textarea")!.value).toBe("最初原文");
  expect(host.querySelector('[aria-label="还原原文"]')).toBeNull();
});
