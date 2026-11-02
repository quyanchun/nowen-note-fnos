import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FileText, Loader2, Mic, Paperclip, Clipboard, Square, X, RotateCcw, Search, Settings2, Sparkles, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, voiceApi } from "@/lib/api";
import { useAppActions } from "@/store/AppContext";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { emptyHomeCapture, getHomeCaptureScope, homeCaptureStore, saveHomeCapture, type HomeCaptureDraft } from "@/lib/homeCapture";
import { recordedVoiceFile, type RecordedVoice, type VoiceRecorderState } from "@/lib/voiceRecorder";
import { LiveDictationSession, insertDictation, dictationWave } from "@/lib/liveDictation";
import { getShortcutChords, shortcutChordMatchesEvent, formatShortcutForCommand } from "@/lib/shortcutRegistry";
import type { NoteListItem } from "@/types";
import { defaultCapturePreferences, organizeCapture } from "@/lib/homeCaptureAI";
import type { CollaborationDraft } from "@/lib/aiCollaboration";
import { parseServerTime } from "@/lib/dateTime";

const CaptureSettings = React.lazy(() => import("./HomeCaptureSettings"));

// A returning Home must not edit a draft while its previous instance is still saving it.
const pendingCaptures = new Map<string, Promise<void>>();
function trackCapture(scope: string, pending: Promise<void>) {
  pendingCaptures.set(scope, pending);
  void pending.then(() => { if (pendingCaptures.get(scope) === pending) pendingCaptures.delete(scope); });
}

const pad2 = (value: number) => String(value).padStart(2, "0");
function relativeTime(iso: string, zh: boolean) {
  const date = parseServerTime(iso);
  if (!date) return "";
  const gap = Date.now() - date.getTime();
  if (gap < 60_000) return zh ? "刚刚" : "just now";
  if (gap < 3_600_000) return zh ? `${Math.max(1, Math.round(gap / 60_000))} 分钟前` : `${Math.max(1, Math.round(gap / 60_000))}m ago`;
  if (gap < 86_400_000) return zh ? `${Math.round(gap / 3_600_000)} 小时前` : `${Math.round(gap / 3_600_000)}h ago`;
  if (gap < 604_800_000) return zh ? `${Math.round(gap / 86_400_000)} 天前` : `${Math.round(gap / 86_400_000)}d ago`;
  return date.toLocaleDateString(zh ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit" });
}

export default function HomePage({ scope, notes, refreshToken = 0, onOpenNote, onSearch, onAsk }: {
  scope: string;
  /** 可选预加载数据；正式首页缺省时独立加载当前工作区，不依赖列表页先打开。 */
  notes?: NoteListItem[];
  refreshToken?: number;
  onAsk:(question:string)=>void;
  onOpenNote: (id: string) => void;
  onSearch: (query: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const actions = useAppActions();
  const { siteConfig } = useSiteSettings();
  const brandMark = (siteConfig.title || "N").trim().charAt(0).toUpperCase() || "N";
  const zh = (i18n.resolvedLanguage || i18n.language).startsWith("zh");
  const copy = zh ? {
    search: "搜索笔记", ask: "知识问答", searchPlaceholder: "搜索笔记标题与正文…", askPlaceholder: "向你的笔记提个问题…", stop: "停止", collect: "随手收集", hint: "文件拖进来，灵感记下来", placeholder: "粘贴一段文字，或点击语音输入说点什么…", file: "添加文件", paste: "粘贴文本", mic: "语音输入", release: "停止", save: "保存为笔记", inbox: "收集箱", results: "相关笔记", sources: "引用来源", noResults: "没有找到相关笔记", error: "操作失败，请重试", storage: "无法暂存草稿，请重试，文字和待识别语音仍保留在本机", pasteHint: "请在输入框内粘贴文字", saved: "笔记已保存", retry: "重新转写", download: "下载录音", voicePending: "录音已暂存", changed: "账号或工作区已切换，草稿保留在原位置", open: "打开笔记", transcribing: "正在转写…",
  } : {
    search: "Search notes", ask: "Ask your notes", searchPlaceholder: "Search note titles and content…", askPlaceholder: "Ask a question about your notes…", stop: "Stop", collect: "Quick capture", hint: "Drop a file or capture a thought", placeholder: "Paste text, or click voice input to speak…", file: "Add files", paste: "Paste text", mic: "Voice input", release: "Stop", save: "Save as note", inbox: "Inbox", results: "Related notes", sources: "Sources", noResults: "No matching notes", error: "Something went wrong. Please retry.", storage: "Could not store the draft. Retry; text and pending audio remain on this device.", pasteHint: "Paste text into the input below", saved: "Note saved", retry: "Retry transcription", download: "Download recording", voicePending: "Recording stored", changed: "Account or workspace changed. The draft remains in its original scope.", open: "Open note", transcribing: "Transcribing…",
  };
  const [mode, setMode] = useState<"search" | "ask">("search");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(() => emptyHomeCapture(scope));
  const draftRef = useRef(draft);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<"save" | "voice" | "organize" | null>(null);
  const busyRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const organizeAbort = useRef<AbortController | null>(null);
  const [recording, setRecording] = useState<VoiceRecorderState>("idle");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const mounted = useRef(false);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingWrite = useRef(false);
  const recorder = useRef<LiveDictationSession | null>(null);
  const holding = useRef(false);
  const caret = useRef<{start:number;end:number}|null>(null);
  const insertedCaret = useRef<number|null>(null);
  const pumping = useRef<Promise<void>|null>(null);
  const shortcutHeld = useRef<string|null>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = () => mounted.current && getHomeCaptureScope() === scope;

  const [summary, setSummary] = useState<{ scope: string; notes: NoteListItem[] } | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  useEffect(() => {
    if (notes) return;
    let cancelled = false;
    setSummaryError(false);
    void api.getNotes().then(value => {
      if (!cancelled && getHomeCaptureScope() === scope) setSummary({ scope, notes: value });
    }).catch(() => {
      if (!cancelled && getHomeCaptureScope() === scope) { setSummary(null); setSummaryError(true); }
    });
    return () => { cancelled = true; };
  }, [scope, notes, refreshToken]);
  const visibleNotes = notes ?? (summary?.scope === scope ? summary.notes : undefined);

  const today = useMemo(() => new Date(), []);
  const dateLabel = `${today.getFullYear()} · ${pad2(today.getMonth() + 1)} · ${pad2(today.getDate())}${zh ? `  星期${"日一二三四五六"[today.getDay()]}` : `  ${today.toLocaleDateString("en-US", { weekday: "short" })}`}`;
  const liveNotes = useMemo(() => (visibleNotes || []).filter(note => !note.isTrashed && !note.isArchived), [visibleNotes]);
  const recentNotes = useMemo(() => [...liveNotes].sort((a, b) => (parseServerTime(b.updatedAt)?.getTime() || 0) - (parseServerTime(a.updatedAt)?.getTime() || 0)).slice(0, 3), [liveNotes]);
  const stats = useMemo(() => {
    if (!visibleNotes) return null;
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
    const monthNew = liveNotes.filter(note => (parseServerTime(note.createdAt)?.getTime() || 0) >= monthStart).length;
    const days = Array.from({ length: 7 }, (_, index) => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      from.setDate(from.getDate() - (6 - index));
      const to = from.getTime() + 86_400_000;
      return liveNotes.filter(note => { const at = parseServerTime(note.createdAt)?.getTime() || 0; return at >= from.getTime() && at < to; }).length;
    });
    const lastUpdated = recentNotes[0]?.updatedAt;
    return { total: liveNotes.length, monthNew, days, peak: Math.max(1, ...days), lastUpdated: lastUpdated ? relativeTime(lastUpdated, zh) : "" };
  }, [visibleNotes, liveNotes, recentNotes, zh, today]);

  const commit = useCallback((value: HomeCaptureDraft): Promise<void> => {
    draftRef.current = value;
    if (mounted.current) { setDraft(value); setSavedNote(null); }
    pendingWrite.current = true;
    const next = writeQueue.current.catch(() => {}).then(() => homeCaptureStore.write(value));
    writeQueue.current = next;
    next.then(() => { if (writeQueue.current === next) pendingWrite.current = false; if (mounted.current) setStorageError(""); }, () => {
      if (mounted.current) setStorageError(zh ? "无法暂存草稿，请重试，文字和待识别语音仍保留在本机" : "Could not store the draft. Text and pending audio remain on this device.");
    });
    return next;
  }, [zh]);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void Promise.resolve(pendingCaptures.get(scope)).then(() => homeCaptureStore.read(scope)).then(value => {
      if (cancelled) return;
      if (value?.key === scope) { draftRef.current = value; setDraft(value); }
    }).catch(() => { if (!cancelled) setStorageError(copy.storage); }).finally(() => { if (!cancelled) setReady(true); });
    return () => {
      cancelled = true; mounted.current = false; voiceAbort.current?.abort(); organizeAbort.current?.abort();
      const session = recorder.current;
      let stopped: Promise<unknown> = Promise.resolve();
      if (session?.state === "recording" || session?.state === "paused") {
        stopped = session.stop();
      } else if (session) stopped = session.cancel();
      trackCapture(scope, Promise.all([pendingCaptures.get(scope), writeQueue.current, stopped]).then(() => undefined, () => undefined));
    };
    // The parent keys this component by server, account and workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pendingWrite.current || recording === "recording" || recording === "requesting-permission" || storageError) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording, storageError]);

  useLayoutEffect(()=>{
    if(insertedCaret.current!==null){areaRef.current?.setSelectionRange(insertedCaret.current,insertedCaret.current);insertedCaret.current=null;}
  },[draft.text]);
  const find = (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim() || !current()) return;
    if (mode === "search") onSearch(query.trim());
    else onAsk(query.trim());
  };
  const switchMode = (next: typeof mode) => setMode(next);
  const addFiles = (files: FileList | File[]) => {
    if (!ready || busyRef.current) return;
    void commit({ ...draftRef.current, files: [...draftRef.current.files, ...Array.from(files).map(file => ({ id: crypto.randomUUID(), name: file.name, type: file.type, blob: file }))] }).catch(() => {});
  };
  const transcribe = async (voice: RecordedVoice) => {
    if (busyRef.current) return;
    busyRef.current = true;
    if (mounted.current) { setBusy("voice"); setError(""); }
    try {
      await commit({ ...draftRef.current, voice });
      if (!current()) return;
      const abort = new AbortController(); voiceAbort.current = abort;
      const result = await voiceApi.transcribeFile(recordedVoiceFile(await dictationWave(voice)), abort.signal);
      if (!current() || abort.signal.aborted) return;
      if (!result.text.trim()) { setError(t("voice.noSpeech")); return; }
      await commit({ ...draftRef.current, voice: undefined, text: [draftRef.current.text, result.text].filter(Boolean).join("\n") });
    } catch (failure) {
      if (current() && !voiceAbort.current?.signal.aborted) setError((failure as Error).message || copy.error);
    } finally { busyRef.current = false; if (mounted.current) setBusy(null); }
  };
  const pumpSegments = () => {
    if (pumping.current) return pumping.current;
    let failed=false;
    const run = async () => {
      busyRef.current=true;if(mounted.current)setBusy("voice");
      try {
        await writeQueue.current;
        while(current() && draftRef.current.voiceSegments?.length){
          const segment=draftRef.current.voiceSegments[0];
          const abort=new AbortController();voiceAbort.current=abort;
          const result=await voiceApi.transcribeFile(recordedVoiceFile(segment.voice),abort.signal);
          if(!current()||abort.signal.aborted)return;
          const position=caret.current || {start:draftRef.current.text.length,end:draftRef.current.text.length};
          const insertion=insertDictation(draftRef.current.text,position.start,position.end,result.text);
          caret.current={start:insertion.caret,end:insertion.caret};insertedCaret.current=insertion.caret;
          await commit({...draftRef.current,text:insertion.text,voiceSegments:draftRef.current.voiceSegments.filter(item=>item.id!==segment.id)});

        }
      } catch(failure) {
        failed=true;await recorder.current?.stop();
        if(current() && !voiceAbort.current?.signal.aborted)setError((failure as Error).message || copy.error);
      } finally {busyRef.current=false;if(mounted.current)setBusy(null);}
    };
    const pending=run();pumping.current=pending;
    void pending.finally(()=>{if(pumping.current===pending)pumping.current=null;if(!failed && current() && draftRef.current.voiceSegments?.length)void pumpSegments();});return pending;
  };
  const startVoice = async () => {
    if(!ready || busyRef.current || draftRef.current.voice || draftRef.current.voiceSegments?.length || ["recording","requesting-permission"].includes(recorder.current?.state || ""))return;
    holding.current=true;setError("");
    const area=areaRef.current;if(area)caret.current={start:area.selectionStart,end:area.selectionEnd};
    const session=new LiveDictationSession(value=>{if(mounted.current)setRecording(value);},voice=>{
      const segments=[...(draftRef.current.voiceSegments || []),{id:crypto.randomUUID(),voice}];
      const stored=commit({...draftRef.current,voiceSegments:segments});
      void stored.then(()=>{if(current())void pumpSegments();}).catch(()=>{void session.stop();});
    });recorder.current=session;
    try{await session.start();if(!holding.current)await session.stop();}
    catch(failure){if(current()){const message=(failure as Error).message;setError(message.startsWith("voice.")?t(message):t("voice.denied"));}}
  };
  const finishVoice = async () => {
    holding.current=false;await recorder.current?.stop();
    if(current())await pumpSegments();
  };
  useEffect(()=>{
    const down=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.repeat||event.isComposing||shortcutHeld.current||document.querySelector('[role="dialog"], [aria-label="设置分类"]'))return;
      if(!getShortcutChords("home-dictation").some(chord=>shortcutChordMatchesEvent(chord,event)))return;
      event.preventDefault();shortcutHeld.current=event.code || event.key;void startVoice();
    };
    const up=(event:KeyboardEvent)=>{if(shortcutHeld.current && ((event.code || event.key)===shortcutHeld.current || ["Alt","Control","Meta","Shift"].includes(event.key))){event.preventDefault();shortcutHeld.current=null;void finishVoice();}};
    const blur=()=>{if(shortcutHeld.current){shortcutHeld.current=null;void finishVoice();}};
    window.addEventListener("keydown",down);window.addEventListener("keyup",up);window.addEventListener("blur",blur);
    return()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);window.removeEventListener("blur",blur);};
  });
  const save = async () => {
    if (!ready || busyRef.current || draftRef.current.voice || draftRef.current.voiceSegments?.length || recorder.current?.state === "recording") return;
    busyRef.current = true; setBusy("save"); setError("");
    let release!: () => void;
    trackCapture(scope, new Promise<void>(resolve => { release = resolve; }));
    try {
      const note = await saveHomeCapture(draftRef.current, commit, copy.inbox, zh ? "原文" : "Original");
      if (getHomeCaptureScope() !== scope) return;
      await commit({ ...emptyHomeCapture(scope), preferences: draftRef.current.preferences, legacyImported: draftRef.current.legacyImported });
      actions.refreshNotes(); actions.refreshNotebooks();
      if (mounted.current) setSavedNote(note.id);
    } catch (failure) { if (current()) setError((failure as Error).message === "HOME_SCOPE_CHANGED" ? copy.changed : (failure as Error).message || copy.error); }
    finally { release(); busyRef.current = false; if (mounted.current) setBusy(null); }
  };
  const organize = async () => {
    if (!ready || busyRef.current || !current() || !draftRef.current.text.trim()) return;
    if (draftRef.current.text.length > 8000) { setError(zh ? "一次可整理 8000 字，请先缩短文字，或直接保存。" : "AI cleanup supports up to 8,000 characters. Shorten the text or save it directly."); return; }
    busyRef.current = true; setBusy("organize"); setError("");
    const abort = new AbortController(); organizeAbort.current = abort;
    let release!: () => void; trackCapture(scope, new Promise<void>(resolve => { release = resolve; }));
    const source = draftRef.current;
    try {
      await commit(source);
      if (!current() || abort.signal.aborted) return;
      const text = await organizeCapture(source.text, source.preferences || defaultCapturePreferences, abort.signal);
      if (!current() || abort.signal.aborted) return;
      await commit({ ...draftRef.current, text, originalText: source.originalText ?? (text === source.text ? undefined : source.text) });
    } catch (failure) { if (current() && !abort.signal.aborted) setError((failure as Error).message || copy.error); }
    finally { release(); busyRef.current = false; if (mounted.current) setBusy(null); }
  };
  const restoreLegacy = async (legacy: CollaborationDraft) => {
    if (!current() || draftRef.current.text || draftRef.current.files.length || busyRef.current) return;
    const request = legacy.saveRequest;
    await commit({ ...draftRef.current, id: request?.id || draftRef.current.id,
      text: request?.content || legacy.output || legacy.input,
      title: request?.title || legacy.title || undefined,
      notebookId: request?.notebookId,
      originalText: !request && legacy.output ? legacy.input : undefined,
      preferences: { method: "tidy", notebookId: request?.notebookId || legacy.targetId || undefined, referenceNotebookId: legacy.projectId || undefined }, legacyImported: true });
  };
  const activeRecording = recording === "recording" || recording === "requesting-permission";
  const toolClass = "home-capture-tool flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-tx-secondary transition-colors hover:bg-app-hover disabled:opacity-40";
  return <section className="home-page flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-app-surface" aria-label={zh ? "首页" : "Home"} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }} onDrop={event => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}>
    <div className="mx-auto my-auto w-full max-w-[70rem] px-5 pb-10 pt-16 sm:pt-10 md:px-8">
      <header className="mb-7">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-primary font-serif text-[25px] sm:h-12 sm:w-12 sm:text-[28px] font-semibold leading-none text-white shadow-[0_4px_10px_-3px_var(--color-accent-primary)]">{brandMark}</span>
          <span className="min-w-0 truncate text-[20px] font-semibold tracking-[-0.3px] text-tx-primary sm:text-[23px]">{siteConfig.title}</span>
          <span className="ml-auto shrink-0 pl-2 text-[15px] font-medium tabular-nums tracking-[0.03em] text-tx-secondary sm:text-[17px]">{dateLabel}</span>
        </div>
        <div className="mt-6">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.7px] text-tx-primary sm:text-[32px]">{zh ? "让想法，有迹可循" : "Give your ideas a place to grow"}</h1>
          <p className="mt-2 text-[15px] leading-6 text-tx-secondary sm:text-[16px]">{zh ? "记下灵感，也找回每一次思考。" : "Capture inspiration. Rediscover every thought."}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        {/* 随手收集 */}
        <section className={`flex flex-col rounded-2xl border bg-app-elevated p-5 sm:p-6 lg:col-span-7 ${dragging ? "border-accent-primary ring-2 ring-accent-primary/15" : "border-app-border"}`} aria-label={copy.collect} onDragLeave={event => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDragging(false); }}>
          <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold text-tx-primary">{copy.collect}</h2>
            <span className="ml-auto text-xs text-tx-tertiary">{copy.hint}</span>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col" data-home-capture-editor>
          <textarea ref={areaRef} onSelect={event=>{caret.current={start:event.currentTarget.selectionStart,end:event.currentTarget.selectionEnd};}} aria-label={copy.collect} value={draft.text} disabled={!ready || busy === "save" || busy === "organize"} onChange={event => { void commit({ ...draftRef.current, text: event.target.value }).catch(() => {}); }} onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); addFiles(event.clipboardData.files); } }} placeholder={copy.placeholder} className="no-focus-ring min-h-[190px] w-full flex-1 resize-y rounded-xl border border-app-border/70 bg-app-surface px-4 py-3.5 pr-12 text-base leading-7 text-tx-primary outline-none disabled:opacity-60 sm:text-sm" />
            {draft.originalText !== undefined && busy !== "organize" && <button type="button" disabled={!!busy} aria-label={zh ? "还原原文" : "Restore original"} title={zh ? "还原原文" : "Restore original"} className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-app-border bg-app-surface/95 text-tx-secondary shadow-sm transition-colors hover:bg-app-hover hover:text-accent-primary disabled:opacity-40" onClick={() => { void commit({ ...draftRef.current, text: draftRef.current.originalText!, originalText: undefined }).catch(() => {}); }}><Undo2 size={15} /></button>}
          </div>
          {draft.files.length > 0 && <ul className="mt-3 space-y-2">{draft.files.map(file => <li key={file.id} className="flex min-w-0 items-center gap-2 text-xs text-tx-secondary"><Paperclip size={14} /><span className="min-w-0 flex-1 truncate">{file.name}</span><button type="button" disabled={busy === "save" || busy === "organize"} aria-label={`${t("common.delete")} ${file.name}`} onClick={() => { void commit({ ...draftRef.current, files: draftRef.current.files.filter(item => item.id !== file.id) }).catch(() => {}); }} className="rounded p-1 hover:bg-app-hover"><X size={14} /></button></li>)}</ul>}
          {(draft.voice || !!draft.voiceSegments?.length) && !activeRecording && <div className="mt-3 flex items-center gap-2 text-xs text-tx-secondary"><span role="status">{busy === "voice" ? copy.transcribing : (zh ? "语音待识别" : "Audio pending")}</span>{!busy && <button type="button" onClick={()=>{setError("");void (draft.voice ? transcribe(draft.voice) : pumpSegments());}} className="rounded p-1 hover:bg-app-hover"><RotateCcw size={13} className="inline" />{copy.retry}</button>}{!busy && <button type="button" aria-label={zh ? "清除待识别语音" : "Discard pending audio"} onClick={()=>{void commit({...draftRef.current,voice:undefined,voiceSegments:[]}).then(()=>setError("")).catch(()=>{});}} className="rounded p-1 hover:bg-app-hover"><X size={13}/></button>}</div>}

          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-3 border-t border-app-border/70 pt-4">
            <button type="button" disabled={!ready || !!busy || activeRecording} onClick={() => fileRef.current?.click()} className={toolClass}><Paperclip size={15} />{copy.file}</button>
            <button type="button" disabled={!ready || busy === "save" || busy === "organize"} onClick={async () => { try { const text = await navigator.clipboard.readText(); if (current() && !busyRef.current && text) await commit({ ...draftRef.current, text: [draftRef.current.text, text].filter(Boolean).join("\n") }); } catch { setError(copy.pasteHint); } areaRef.current?.focus(); }} className={toolClass}><Clipboard size={15} />{copy.paste}</button>
            <button type="button" disabled={!ready || busy === "save" || (!activeRecording && (!!busy || !!draft.voice || !!draft.voiceSegments?.length))} onClick={()=>void(activeRecording?finishVoice():startVoice())} title={`${zh ? "按住说话：" : "Hold to speak: "}${formatShortcutForCommand("home-dictation")}`} aria-pressed={activeRecording} className={`${toolClass} ${activeRecording ? "text-red-500" : ""}`}>{activeRecording ? <Square size={15}/> : <Mic size={15}/>}{activeRecording ? copy.release : copy.mic}</button>
            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
              {busy === "organize" ? <button type="button" className={toolClass} onClick={() => organizeAbort.current?.abort()}><Loader2 size={15} className="animate-spin" />{zh ? "停止整理" : "Stop"}</button> : <button type="button" disabled={!ready || !!busy || activeRecording || !!draft.voice || !!draft.voiceSegments?.length || !draft.text.trim()} onClick={() => void organize()} className={toolClass}><Sparkles size={15} />{zh ? "AI 整理" : "AI cleanup"}</button>}
            <button type="button" disabled={!ready || !!busy || activeRecording || (!!draft.voice || !!draft.voiceSegments?.length) || (!draft.text.trim() && !draft.files.length)} onClick={() => void save()} className="flex items-center gap-2 rounded-[10px] bg-accent-primary px-5 py-2.5 text-[13px] font-medium text-white shadow-[0_6px_14px_-6px_var(--color-accent-primary)] hover:opacity-90 disabled:opacity-40 disabled:shadow-none">{busy && <Loader2 size={15} className="animate-spin" />}{copy.save}</button>
              <button type="button" disabled={!ready || !!busy || activeRecording} aria-label={zh ? "收集设置" : "Capture settings"} title={zh ? "收集设置" : "Capture settings"} onClick={() => setSettingsOpen(true)} className={toolClass}><Settings2 size={17} /></button>
            </div>
          </div>
          {(error || storageError) && <p role="alert" className="mt-3 text-xs leading-6 text-red-500">{storageError || error}</p>}
          {savedNote && <button type="button" onClick={() => onOpenNote(savedNote)} className="mt-3 self-start text-xs text-accent-primary hover:underline">{copy.saved} · {copy.open}</button>}
        </section>

        {/* 搜索 + 数据 */}
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
          <div className="rounded-2xl border border-app-border bg-app-elevated p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[13.5px] font-semibold text-tx-primary">{zh ? "搜索" : "Search"}</h2>
              <div className="flex items-center gap-1" role="group" aria-label={zh ? "搜索方式" : "Search mode"}>
                {(["search", "ask"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => switchMode(value)} className={`rounded-lg px-2.5 py-1 text-[12px] transition-colors ${mode === value ? "bg-accent-primary/10 font-medium text-accent-primary" : "text-tx-secondary hover:bg-app-hover"}`}>{copy[value]}</button>)}
              </div>
            </div>
            <form onSubmit={find} className="home-search flex h-11 items-center gap-2 rounded-full border border-app-border bg-app-surface pl-3.5 pr-1 focus-within:border-tx-tertiary">
              <Search size={15} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-tx-tertiary" />
              <input aria-label={copy[mode]} value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === "search" ? copy.searchPlaceholder : copy.askPlaceholder} className="no-focus-ring min-w-0 flex-1 border-0 bg-transparent py-1 text-[13px] text-tx-primary outline-none" />
              <button type="submit" aria-label={copy[mode]} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-primary text-white hover:opacity-90"><ArrowRight size={16} /></button>
            </form>
          </div>

          {stats && <div className="relative flex flex-1 flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-[#2f5bea] via-[#4b7bf5] to-[#6f9bff] p-5 text-white">
            <span aria-hidden="true" className="pointer-events-none absolute -right-14 -bottom-20 h-52 w-52 rounded-full border-[26px] border-white/10" />
            <div className="relative">
              <div className="text-[11.5px] tracking-wide text-white/70">{zh ? "本月新增" : "This month"}</div>
              <div className="mt-1.5 text-[34px] font-semibold leading-none tracking-[-1.2px]">{stats.monthNew}<span className="ml-1.5 text-xs font-normal text-white/80">{zh ? "条笔记" : "notes"}</span></div>
            </div>
            <div className="relative mt-4 flex h-9 items-end gap-1.5" aria-hidden="true">
              {stats.days.map((value, index) => <i key={index} className="flex-1 rounded-t-[3px]" style={{ height: `${Math.max(14, (value / stats.peak) * 100)}%`, background: index === 6 ? "rgba(255,255,255,.72)" : "rgba(255,255,255,.26)" }} />)}
            </div>
            <div className="relative mt-4 flex items-center justify-between border-t border-white/20 pt-3 text-[11.5px] text-white/80">
              <span>{zh ? `全部 ${stats.total} 条` : `${stats.total} notes`}</span>
              {stats.lastUpdated && <span>{stats.lastUpdated}</span>}
            </div>
          </div>}
        </div>

        {/* 最近编辑 */}
        {recentNotes.length > 0 && <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-12">
          {recentNotes.map(note => <button key={note.id} type="button" onClick={() => onOpenNote(note.id)} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-app-border bg-app-elevated p-4 text-left transition-colors hover:border-tx-tertiary/40 hover:bg-app-hover">
            <span className="mb-2 flex items-center gap-2 text-[10.5px] text-tx-tertiary">
              <i aria-hidden="true" className="h-[6px] w-[6px] rounded-[2px] bg-accent-primary/70" />
              {relativeTime(note.updatedAt, zh)}
            </span>
            <span className="line-clamp-1 text-[13px] font-medium text-tx-primary">{note.title || (zh ? "无标题笔记" : "Untitled")}</span>
            <span className="mt-1.5 line-clamp-2 text-[11.5px] leading-[1.7] text-tx-secondary">{note.contentText?.replace(/\s+/g, " ").trim() || (zh ? "没有更多内容" : "No preview")}</span>
          </button>)}
        </div>}
      </div>

      {summaryError && <p role="alert" className="mt-4 text-sm text-tx-secondary">{zh ? "无法加载笔记概览，请刷新重试。" : "Could not load the note overview. Refresh to retry."}</p>}

      {settingsOpen && <React.Suspense fallback={null}><CaptureSettings preferences={draft.preferences || defaultCapturePreferences} destinationLocked={!!draft.notebookId} allowRestore={!draft.legacyImported && !draft.text && !draft.files.length && !draft.voice && !draft.voiceSegments?.length} onSave={async preferences => { if (current()) await commit({ ...draftRef.current, preferences }); }} onRestore={restoreLegacy} onClose={() => setSettingsOpen(false)} /></React.Suspense>}
      <input ref={fileRef} aria-label={copy.file} type="file" multiple hidden onChange={event => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
    </div>
  </section>;
}
