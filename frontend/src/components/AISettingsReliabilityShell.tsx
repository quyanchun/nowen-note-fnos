import { useCallback, useEffect, useState } from "react";
import { Database, Loader2, Power, RefreshCw, ShieldCheck } from "lucide-react";
import OriginalAISettingsPanel from "./AISettingsPanel";
import EmbeddingSettingsPanel from "./EmbeddingSettingsPanel";
import AIModelSettingsPanel from "./AIModelSettingsPanel";
import SpeechSettingsPanel from "./SpeechSettingsPanel";
import PluginPromptPackSettingsSection from "./settings/PluginPromptPackSettingsSection";
import { getReliableAIStatus, setReliableAIEnabled, type ReliableStatus } from "@/lib/aiReliable";
import { cn } from "@/lib/utils";

type ModelTab = "chat" | "embedding" | "speech" | "multimodal";
export default function AISettingsReliabilityShell() {
  const zh = (localStorage.getItem("i18nextLng") || navigator.language).toLowerCase().startsWith("zh");
  const [activeTab, setActiveTab] = useState<ModelTab>("chat");
  const [status, setStatus] = useState<ReliableStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const tabs: { id: ModelTab; label: string }[] = [
    { id: "chat", label: zh ? "对话" : "Chat" },
    { id: "embedding", label: "Embedding" },
    { id: "speech", label: zh ? "声音" : "Speech" },
    { id: "multimodal", label: zh ? "多模态" : "Multimodal" },
  ];
  const refresh = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(""); }
    try { setStatus(await getReliableAIStatus()); }
    catch (reason) { if (!silent) setError((reason as Error).message); }
    finally { if (!silent) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    window.addEventListener("nowen:ai-settings-changed", changed);
    window.addEventListener("nowen:ai-profiles-changed", changed);
    return () => { window.removeEventListener("nowen:ai-settings-changed", changed); window.removeEventListener("nowen:ai-profiles-changed", changed); };
  }, [refresh]);
  const queued = (status?.index.pending || 0) + (status?.index.processing || 0);
  useEffect(() => {
    if (!queued) return;
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [queued, refresh]);
  const vectorState = status?.index.vectorState || (status?.index.vectorAvailable ? "ready" : "unavailable");
  const vectorText = !status?.index.configured ? (zh ? "未配置" : "Not configured")
    : vectorState === "ready" ? `${zh ? "可用" : "Ready"}${status.index.vectorDimension ? ` · ${status.index.vectorDimension} ${zh ? "维" : "dimensions"}` : ""}`
    : vectorState === "initializing" ? `${zh ? "等待首次索引" : "Waiting for first index"}${queued ? ` · ${zh ? "待处理" : "Queued"} ${queued}` : ""}`
    : (zh ? "sqlite-vec 扩展加载失败" : "sqlite-vec failed to load");
  const summaries = [
    { label: zh ? "当前对话模型" : "Current chat model", value: `${status?.provider || (zh ? "未配置" : "Not configured")} / ${status?.model || (zh ? "未选择" : "Not selected")}`, icon: ShieldCheck, tone: "text-tx-primary" },
    { label: "Embedding 模型", value: status?.embeddingModel || (zh ? "未配置 · 关键词检索" : "Not configured · Keyword search"), icon: Database, tone: "text-tx-primary" },
    { label: zh ? "知识库索引" : "Knowledge index", value: status?.index.stale ? `${zh ? "待处理" : "Queued"} ${queued} · ${zh ? "失败" : "Failed"} ${status.index.failed}` : `${status?.index.indexedNotes || 0}/${status?.index.totalNotes || 0} ${zh ? "篇已索引" : "notes indexed"}`, icon: RefreshCw, tone: status?.index.stale ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400" },
    { label: zh ? "向量引擎" : "Vector engine", value: vectorText, icon: Database, tone: !status?.index.configured ? "text-tx-secondary" : vectorState === "ready" ? "text-emerald-600 dark:text-emerald-400" : vectorState === "initializing" ? "text-blue-600 dark:text-blue-400" : "text-red-500" },
  ];
  const toggle = async () => {
    if (!status || saving) return;
    setSaving(true); setError("");
    try {
      const next = await setReliableAIEnabled(!status.enabled); setStatus(next);
      window.dispatchEvent(new CustomEvent("nowen:ai-manual-enabled-changed", { detail: { enabled: next.enabled } }));
    } catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  };
  return <div className="space-y-4">
    <section aria-label={zh ? "AI 助手状态" : "AI assistant status"} className="rounded-xl border border-app-border bg-app-elevated p-4">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", status?.enabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-app-surface text-tx-tertiary")}><Power size={19} /></div>
        <h2 className="flex-1 text-sm font-semibold text-tx-primary">{zh ? "AI 助手" : "AI assistant"}</h2>
        <span className="text-xs text-tx-secondary">{loading ? <Loader2 size={13} className="animate-spin" /> : status?.enabled ? (zh ? "已启用" : "Enabled") : (zh ? "已关闭" : "Disabled")}</span>
        <button type="button" role="switch" aria-checked={!!status?.enabled} aria-label={zh ? "启用 AI 助手" : "Enable AI assistant"} disabled={loading || saving || !status} onClick={() => void toggle()} className={cn("relative h-6 w-10 shrink-0 rounded-full transition disabled:opacity-50", status?.enabled ? "bg-accent-primary" : "bg-zinc-300 dark:bg-zinc-700")}>
          <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", status?.enabled ? "left-[18px]" : "left-0.5")} />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
        {summaries.map(item => <div key={item.label} className="min-w-0 rounded-lg bg-app-surface p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-tx-tertiary"><item.icon size={12} />{item.label}</div>
          <div title={item.value} className={cn("mt-1 truncate text-xs font-medium", item.tone)}>{loading ? (zh ? "读取中…" : "Loading…") : item.value}</div>
        </div>)}
      </div>
      {(saving || error) && <p role={error ? "alert" : "status"} className={cn("mt-3 flex items-center gap-2 text-xs", error ? "text-red-500" : "text-blue-600")}>
        {saving && <Loader2 size={13} className="animate-spin" />}{error || (zh ? "正在切换配置状态…" : "Updating configuration…")}
      </p>}
    </section>
    <div className="min-w-0 space-y-4" aria-label={zh ? "助手配置" : "Assistant settings"}>
      <OriginalAISettingsPanel />
      <div className="min-w-0 overflow-hidden rounded-xl border border-app-border bg-app-elevated">
        <div role="tablist" aria-label={zh ? "模型用途" : "Model purpose"} className="grid min-h-14 grid-cols-4 border-b border-app-border px-2">
          {tabs.map((tab, index) => <button key={tab.id} type="button" id={`ai-model-tab-${tab.id}`} role="tab" aria-selected={activeTab === tab.id} aria-controls={`ai-model-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)} onKeyDown={event => {
            const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault(); setActiveTab(tabs[next].id); document.getElementById(`ai-model-tab-${tabs[next].id}`)?.focus();
          }} className={cn("-mb-px border-b-2 px-1 py-3 text-xs font-medium transition-colors", activeTab === tab.id ? "border-accent-primary text-accent-primary" : "border-transparent text-tx-secondary hover:text-tx-primary")}>{tab.label}</button>)}
        </div>
        {tabs.map(tab => <div key={tab.id} role="tabpanel" id={`ai-model-panel-${tab.id}`} aria-labelledby={`ai-model-tab-${tab.id}`} hidden={activeTab !== tab.id}>
          {tab.id === "chat" && <AIModelSettingsPanel purpose="chat" />}
          {tab.id === "embedding" && <EmbeddingSettingsPanel />}
          {tab.id === "speech" && <SpeechSettingsPanel />}
          {tab.id === "multimodal" && <AIModelSettingsPanel purpose="multimodal" />}
        </div>)}
      </div>
    </div>
    <PluginPromptPackSettingsSection />
  </div>;
}
