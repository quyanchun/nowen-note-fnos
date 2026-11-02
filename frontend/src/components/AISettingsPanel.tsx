import AppSelect from "@/components/ui/AppSelect";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Eye, EyeOff, Loader2, Plus, Server, Trash2, X } from "lucide-react";
import { aiProfiles, emitAIProfilesChanged, type AIProfile, type AIProfileDraft } from "@/lib/aiProfiles";

interface ProviderPreset {
  id: string;
  name: string;
  desc: string;
  url: string;
  needsKey: boolean;
  color: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "qwen", name: "通义千问", desc: "DashScope OpenAI 兼容接口", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", needsKey: true, color: "from-violet-500 to-blue-500" },
  { id: "openai", name: "OpenAI", desc: "OpenAI 官方接口", url: "https://api.openai.com/v1", needsKey: true, color: "from-emerald-500 to-teal-500" },
  { id: "gemini", name: "Google Gemini", desc: "Gemini OpenAI 兼容接口", url: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true, color: "from-blue-500 to-cyan-500" },
  { id: "deepseek", name: "DeepSeek", desc: "DeepSeek 官方接口", url: "https://api.deepseek.com/v1", needsKey: true, color: "from-sky-500 to-indigo-500" },
  { id: "doubao", name: "豆包（火山引擎）", desc: "火山方舟 OpenAI 兼容接口", url: "https://ark.cn-beijing.volces.com/api/v3", needsKey: true, color: "from-orange-500 to-pink-500" },
  { id: "lmstudio", name: "LM Studio", desc: "本地或局域网 OpenAI 兼容服务", url: "http://127.0.0.1:1234/v1", needsKey: false, color: "from-cyan-500 to-blue-600" },
  { id: "ollama", name: "Ollama", desc: "本地或局域网模型", url: "http://localhost:11434/v1", needsKey: false, color: "from-zinc-500 to-zinc-700" },
  { id: "custom", name: "自定义 API", desc: "任意 OpenAI 兼容服务", url: "", needsKey: true, color: "from-purple-500 to-indigo-500" },
];

const EMPTY_DRAFT: AIProfileDraft = { name: "", provider: "openai", apiUrl: "https://api.openai.com/v1", apiKey: "", customHeaders: "{}" };
const fieldClass = "mt-1.5 w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-tx-primary outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/15";

function profileToDraft(profile: AIProfile): AIProfileDraft {
  return { name: profile.name, provider: profile.provider, apiUrl: profile.apiUrl, apiKey: profile.apiKey,
    customHeaders: typeof profile.customHeaders === "string" ? profile.customHeaders : JSON.stringify(profile.customHeaders || {}, null, 2) };
}

export default function AISettingsPanel() {
  const zh = (localStorage.getItem("i18nextLng") || navigator.language).toLowerCase().startsWith("zh");
  const [profiles, setProfiles] = useState<AIProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AIProfileDraft>(EMPTY_DRAFT);
  const [dialog, setDialog] = useState<"details" | "edit" | "new" | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const selected = profiles.find(profile => profile.id === selectedId);
  const preset = PROVIDER_PRESETS.find(item => item.id === draft.provider) || PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
  const headers = typeof draft.customHeaders === "string" ? draft.customHeaders : JSON.stringify(draft.customHeaders || {}, null, 2);

  const loadProfiles = useCallback(async () => { const result = await aiProfiles.list(); setProfiles(result.profiles); }, []);
  useEffect(() => {
    let alive = true;
    void aiProfiles.list().then(result => { if (alive) setProfiles(result.profiles); })
      .catch((error: Error) => { if (alive) setMessage({ error: true, text: error.message }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(dialog === "details" ? "button" : "input")?.focus();
    return () => { previous?.focus(); };
  }, [dialog]);

  const open = (mode: "details" | "edit", profile: AIProfile) => {
    setSelectedId(profile.id); setDraft(profileToDraft(profile)); setDialog(mode); setShowKey(false); setMessage(null);
  };
  const startNew = () => {
    setSelectedId(null); setDraft({ ...EMPTY_DRAFT, name: zh ? `渠道 ${profiles.length + 1}` : `Channel ${profiles.length + 1}` });
    setDialog("new"); setShowKey(false); setMessage(null);
  };
  const close = () => { if (!saving) { setDialog(null); setMessage(null); } };
  const changeProvider = (id: string) => {
    const next = PROVIDER_PRESETS.find(item => item.id === id);
    if (next) setDraft(current => ({ ...current, provider: id, apiUrl: next.url, apiKey: "", customHeaders: "{}" }));
  };
  const save = async () => {
    if (!draft.name.trim()) { setMessage({ error: true, text: zh ? "请输入渠道名称" : "Enter a channel name" }); return; }
    setSaving(true); setMessage(null);
    try {
      const result = selectedId ? await aiProfiles.update(selectedId, draft) : await aiProfiles.create(draft, false);
      await loadProfiles(); emitAIProfilesChanged(result.activeProfileId); setDialog(null);
      setMessage({ error: false, text: zh ? "渠道已保存" : "Channel saved" });
    } catch (error) { setMessage({ error: true, text: (error as Error).message }); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!selectedId) return;
    if (profiles.length <= 1) { setMessage({ error: true, text: zh ? "至少保留一个渠道" : "Keep at least one channel" }); return; }
    if (!window.confirm(zh ? "确定删除这个渠道？" : "Delete this channel?")) return;
    setSaving(true); setMessage(null);
    try { const result = await aiProfiles.remove(selectedId); await loadProfiles(); emitAIProfilesChanged(result.activeProfileId); setDialog(null); }
    catch (error) { setMessage({ error: true, text: (error as Error).message }); }
    finally { setSaving(false); }
  };
  const title = dialog === "details" ? (zh ? "渠道详情" : "Channel details") : dialog === "new" ? (zh ? "添加渠道" : "Add channel") : (zh ? "编辑渠道" : "Edit channel");

  return <section aria-label={zh ? "厂商渠道管理" : "Provider channels"} className="min-w-0 overflow-hidden rounded-xl border border-app-border bg-app-elevated">
    <div className="flex min-h-14 items-center justify-between gap-2 border-b border-app-border px-4 py-3">
      <h3 className="text-sm font-semibold text-tx-primary">{zh ? "厂商渠道管理" : "Provider channels"}</h3>
      <button type="button" onClick={startNew} aria-label={zh ? "添加渠道" : "Add channel"} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-accent-primary hover:bg-accent-primary/10"><Plus size={13} />{zh ? "添加" : "Add"}</button>
    </div>
    {loading ? <div className="flex justify-center p-8"><Loader2 size={18} className="animate-spin text-tx-tertiary" /></div> : <ul className="max-h-[28rem] divide-y divide-app-border overflow-y-auto">
      {profiles.map(profile => <li key={profile.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5"><span className="rounded-lg bg-app-surface p-2 text-tx-secondary"><Server size={15} /></span>
          <div className="min-w-0"><p className="truncate text-sm font-medium text-tx-primary">{profile.name}</p><p className="mt-0.5 truncate text-[11px] text-tx-tertiary">{PROVIDER_PRESETS.find(item => item.id === profile.provider)?.name || profile.provider}</p></div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => open("details", profile)} className="rounded-md border border-app-border px-3 py-1.5 text-xs text-tx-secondary hover:bg-app-hover">{zh ? "详情" : "Details"}</button>
          <button type="button" onClick={() => open("edit", profile)} className="rounded-md border border-app-border px-3 py-1.5 text-xs text-tx-primary hover:bg-app-hover">{zh ? "编辑" : "Edit"}</button>
        </div>
      </li>)}
      {!profiles.length && <li className="px-4 py-6 text-center text-xs text-tx-tertiary">{zh ? "暂无渠道" : "No channels"}</li>}
    </ul>}
    {!dialog && message && <p role="status" className={`px-4 pb-3 text-xs ${message.error ? "text-red-500" : "text-emerald-600"}`}>{message.text}</p>}
    {dialog && createPortal(<div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm" onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ai-channel-dialog-title" onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
        if (event.key === "Tab") {
          const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary') || []).filter(item => item.getClientRects().length);
          if (!items.length) return;
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }} className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-app-border bg-app-elevated text-tx-primary shadow-2xl">
        <header className="flex items-center justify-between border-b border-app-border px-5 py-4"><h2 id="ai-channel-dialog-title" className="text-base font-semibold">{title}</h2><button type="button" onClick={close} disabled={saving} aria-label={zh ? "关闭渠道弹窗" : "Close channel dialog"} className="rounded-md p-1 text-tx-tertiary hover:bg-app-hover"><X size={17} /></button></header>
        {dialog === "details" ? <dl className="space-y-4 overflow-y-auto px-5 py-5 text-sm">
          {[[zh ? "渠道名称" : "Channel name", draft.name], [zh ? "服务商" : "Provider", preset.name], [zh ? "API 地址" : "API URL", draft.apiUrl], ["API Key", selected?.apiKeySet ? draft.apiKey : (zh ? "未配置" : "Not configured")]].map(([label,value]) => <div key={label}><dt className="mb-1 text-xs text-tx-tertiary">{label}</dt><dd className="break-all">{value || "—"}</dd></div>)}
          <div><dt className="mb-1 text-xs text-tx-tertiary">Headers</dt><dd><pre className="whitespace-pre-wrap break-all rounded-lg bg-app-surface p-3 text-xs">{headers}</pre></dd></div>
        </dl> : <form id="ai-channel-form" className="space-y-4 overflow-y-auto px-5 py-5" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset disabled={saving} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-tx-secondary">{zh ? "渠道名称" : "Channel name"}<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} className={fieldClass} /></label>
              <label className="block text-xs text-tx-secondary">{zh ? "服务商" : "Provider"}<AppSelect value={draft.provider} onChange={event => changeProvider(event.target.value)} className={fieldClass}>{PROVIDER_PRESETS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</AppSelect></label>
            </div>
            <label className="block text-xs text-tx-secondary">{zh ? "API 地址" : "API URL"}<input value={draft.apiUrl} onChange={event => setDraft({ ...draft, apiUrl: event.target.value })} placeholder="https://api.example.com/v1" className={fieldClass} /></label>
            {preset.needsKey && <label className="block text-xs text-tx-secondary">API Key<div className="relative"><input type={showKey ? "text" : "password"} value={draft.apiKey} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} autoComplete="off" className={`${fieldClass} pr-10`} /><button type="button" onClick={() => setShowKey(!showKey)} aria-label={zh ? "显示或隐藏密钥" : "Show or hide key"} className="absolute right-3 top-1/2 -translate-y-1/2 text-tx-tertiary">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></label>}
            <details className="rounded-lg border border-app-border px-3 py-2.5"><summary className="cursor-pointer text-xs text-tx-secondary">{zh ? "自定义 Headers" : "Custom Headers"}</summary><textarea aria-label="Headers JSON" rows={4} value={headers} onChange={event => setDraft({ ...draft, customHeaders: event.target.value })} spellCheck={false} title={zh ? "保留 **** 沿用原值；填 {} 清空。" : "Keep **** to preserve saved values; use {} to clear."} className={`${fieldClass} font-mono text-xs`} /></details>
          </fieldset>
        </form>}
        {message && <p role="alert" className={`px-5 pb-3 text-xs ${message.error ? "text-red-500" : "text-emerald-600"}`}>{message.text}</p>}
        <footer className="flex items-center justify-end gap-2 border-t border-app-border px-5 py-3">
          {dialog === "edit" && <button type="button" onClick={() => void remove()} disabled={saving} className="mr-auto inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs text-red-500 hover:bg-red-500/5"><Trash2 size={13} />{zh ? "删除渠道" : "Delete channel"}</button>}
          <button type="button" onClick={close} disabled={saving} className="rounded-lg border border-app-border px-3 py-2 text-xs text-tx-secondary">{zh ? "关闭" : "Close"}</button>
          {dialog === "details" ? <button key="edit-action" type="button" onClick={() => { setDialog("edit"); setMessage(null); }} className="rounded-lg bg-accent-primary px-4 py-2 text-xs font-medium text-white">{zh ? "编辑渠道" : "Edit channel"}</button> : <button key="save-action" type="submit" form="ai-channel-form" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-4 py-2 text-xs font-medium text-white">{saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}{zh ? "保存渠道" : "Save channel"}</button>}
        </footer>
      </div>
    </div>, document.body)}
  </section>;
}
