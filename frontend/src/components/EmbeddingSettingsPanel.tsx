import AppSelect from "@/components/ui/AppSelect";
import ModelNameInput from "./ModelNameInput";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";
import { api, getBaseUrl, getCurrentWorkspace } from "@/lib/api";
import { aiProfiles, type AIProfile } from "@/lib/aiProfiles";
import { getReliableAIStatus, type ReliableStatus } from "@/lib/aiReliable";
import {
  discoverEmbeddingModels,
  mergeEmbeddingModelOptions,
  testEmbeddingModel,
  type EmbeddingModelOption,
  type EmbeddingTestResult,
} from "@/lib/embeddingModelDiscovery";
import {
  buildEmbeddingSettingsPayload,
  inferEmbeddingCredentialSource,
  type EmbeddingCredentialSource,
} from "@/lib/embeddingProfileSelection";
import { cn } from "@/lib/utils";
import EmbeddingIndexFailureDetails from "@/components/EmbeddingIndexFailureDetails";

interface AISettingsResponse {
  ai_provider: string;
  ai_api_url: string;
  ai_api_key: string;
  ai_api_key_set: boolean;
  ai_model: string;
  ai_embedding_profile_id?: string;
  ai_embedding_url?: string;
  ai_embedding_key?: string;
  ai_embedding_key_set?: boolean;
  ai_embedding_model?: string;
}

interface EmbeddingDraft {
  source: EmbeddingCredentialSource;
  profileId: string;
  url: string;
  key: string;
  keySet: boolean;
  model: string;
}

type EmbeddingMessage = {
  type: "success" | "warning" | "error";
  text: string;
};

const EMPTY_DRAFT: EmbeddingDraft = {
  source: "chat",
  profileId: "",
  url: "",
  key: "",
  keySet: false,
  model: "",
};

const MODEL_SUGGESTIONS = ["text-embedding-3-small", "text-embedding-v3", "bge-m3"];

function getCopy() {
  const language = (localStorage.getItem("i18nextLng") || navigator.language || "").toLowerCase();
  if (!language.startsWith("zh")) {
    return {
      title: "Embedding model",
      description: "Choose a channel and an independent model for vector search.",
      enabled: "Configured",
      disabled: "Keyword fallback",
      sourceLabel: "Embedding channel",
      chatTitle: "Follow chat channel",
      chatDescription: "Use the active chat profile URL and key.",
      profileTitle: "Saved provider channel",
      profileDescription: "Fix embedding to one saved profile. Chat profile switches will not affect it.",
      customTitle: "Custom credentials",
      customDescription: "Use a dedicated URL and key that are separate from saved profiles.",
      selectProfile: "Select a provider channel",
      noProfiles: "No saved provider channels",
      missingProfile: "Deleted channel",
      profileRequired: "Select a provider channel before saving.",
      profileMissingWarning: "The saved AI profile used by Embedding no longer exists. Select another profile or credential source.",
      profileSummary: "Embedding reads this profile's provider, URL and key dynamically. Its chat model is not used.",
      embeddingUrl: "Embedding API URL",
      embeddingKey: "Embedding API key",
      embeddingModel: "Embedding model",
      urlPlaceholder: "For example: https://api.openai.com/v1",
      keyPlaceholder: "Enter a dedicated embedding API key",
      savedKey: "Dedicated key saved (leave empty to keep it)",
      modelPlaceholder: "For example: text-embedding-3-small",
      examples: "Common examples; use a model supported by your provider:",
      discoverModels: "Refresh models",
      discoveringModels: "Refreshing…",
      testModel: "Test connection",
      testingModel: "Testing…",
      discoveredModels: "Discovered models",
      recommended: "recommended",
      noEmbeddingModels: "No likely embedding models were found. You can still enter a model name manually.",
      modelsFound: (count: number, recommended: number) => `Found ${count} candidate models (${recommended} recommended).`,
      testSucceeded: (dimension: number, durationMs: number) => `Embedding test passed: ${dimension} dimensions · ${durationMs} ms.`,
      modelRequired: "Enter an embedding model before testing.",
      discoverFailed: "Failed to refresh embedding models",
      testFailed: "Embedding model test failed",
      save: "Save settings",
      rebuild: "Rebuild vector index",
      refresh: "Refresh status",
      saving: "Saving…",
      rebuilding: "Rebuilding…",
      saved: "Embedding settings saved.",
      disabledSaved: "Embedding model cleared. Knowledge-base search will use keyword fallback.",
      configurationChanged: "Settings saved. The embedding service or model changed; rebuild the vector index.",
      rebuildConfirm: "Rebuild all note and attachment vectors now? This may consume API quota.",
      rebuildQueued: "Vector rebuild queued. Indexing continues in the background.",
      loadFailed: "Failed to load embedding settings",
      saveFailed: "Failed to save embedding settings",
      rebuildFailed: "Failed to rebuild the vector index",
      notes: "Notes",
      attachments: "Attachments",
      queue: "Queue",
      vectorEngine: "Vector engine",
      ready: "Ready",
      unavailable: "Unavailable",
      pending: "pending",
      processing: "processing",
      failed: "failed",
      dimension: "dimensions",
      notConfigured: "Configure a valid embedding service and model before rebuilding the index.",
      statusLoading: "Loading index status…",
      backgroundHint: "Search indexing runs in the background and does not modify note contents.",
      initializing: "Awaiting first index",
      extensionFailure: "Extension load failed",
      initializingHint: "The extension is loaded. The first successful index initializes the vector table; pending jobs may run now.",
      extensionFailureHint: "The sqlite-vec extension failed to load. Check the server logs or native module installation.",
      retried: (count: number) => `Queued ${count} failed jobs without clearing existing vectors.`,
    };
  }
  return {
    title: "Embedding 模型（向量检索）",
    description: "为向量检索独立选择渠道和 Embedding 模型。",
    enabled: "已配置",
    disabled: "关键词降级",
    sourceLabel: "Embedding 渠道",
    chatTitle: "跟随对话渠道",
    chatDescription: "复用当前对话渠道的地址与密钥。",
    profileTitle: "厂商渠道",
    profileDescription: "固定引用一个渠道，切换对话渠道不会影响 Embedding。",
    customTitle: "独立配置",
    customDescription: "单独填写 Embedding 地址与密钥。",
    selectProfile: "请选择厂商渠道",
    noProfiles: "暂无已保存厂商渠道",
    missingProfile: "渠道已删除",
    profileRequired: "请先选择一个厂商渠道再保存。",
    profileMissingWarning: "Embedding 绑定的厂商渠道已删除，请重新选择渠道或切换凭据来源。",
    profileSummary: "复用该渠道的地址、API Key 和 Headers，Embedding 模型独立选择。",
    embeddingUrl: "Embedding API 地址",
    embeddingKey: "Embedding API Key",
    embeddingModel: "Embedding 模型",
    urlPlaceholder: "例如：https://api.openai.com/v1",
    keyPlaceholder: "请输入独立 Embedding API Key",
    savedKey: "已保存独立密钥（留空不修改）",
    modelPlaceholder: "例如：text-embedding-3-small",
    examples: "常用示例，请以服务商实际支持的模型为准：",
    discoverModels: "刷新模型",
    discoveringModels: "正在刷新…",
    testModel: "测试连接",
    testingModel: "正在测试…",
    discoveredModels: "发现的模型",
    recommended: "推荐",
    noEmbeddingModels: "未发现疑似 Embedding 模型，仍可手动填写模型名称。",
    modelsFound: (count: number, recommended: number) => `发现 ${count} 个候选模型，其中 ${recommended} 个推荐。`,
    testSucceeded: (dimension: number, durationMs: number) => `Embedding 测试成功：${dimension} 维 · ${durationMs} 毫秒。`,
    modelRequired: "请先填写要测试的 Embedding 模型。",
    discoverFailed: "刷新 Embedding 模型失败",
    testFailed: "Embedding 模型测试失败",
    save: "保存配置",
    rebuild: "重建向量索引",
    refresh: "刷新状态",
    saving: "正在保存…",
    rebuilding: "正在重建…",
    saved: "Embedding 配置已保存。",
    disabledSaved: "已清空 Embedding 模型，知识库将自动降级为关键词检索。",
    configurationChanged: "配置已保存。Embedding 服务或模型发生变化，请重建向量索引。",
    rebuildConfirm: "确定重建全部笔记和附件的向量索引吗？此操作可能消耗 API 配额。",
    rebuildQueued: "已提交向量重建任务，后台将持续处理。",
    loadFailed: "Embedding 配置加载失败",
    saveFailed: "Embedding 配置保存失败",
    rebuildFailed: "向量索引重建失败",
    notes: "笔记",
    attachments: "附件",
    queue: "任务队列",
    vectorEngine: "向量引擎",
    ready: "可用",
    unavailable: "不可用",
    pending: "待处理",
    processing: "处理中",
    failed: "失败",
    dimension: "维",
    notConfigured: "请先保存有效的 Embedding 服务和模型，再重建索引。",
    statusLoading: "正在读取索引状态…",
    backgroundHint: "后台异步建立搜索索引，不会修改原笔记内容。",
    initializing: "等待首次向量索引",
    extensionFailure: "扩展加载失败",
    initializingHint: "向量扩展已加载，首个索引成功后会自动建立向量表；后台任务可以继续处理。",
    extensionFailureHint: "sqlite-vec 扩展加载失败，请检查服务端日志或原生模块安装，不是 Embedding API 的问题。",
    retried: (count: number) => `已重新入队 ${count} 个失败任务，已有向量索引保持不变。`,
  };
}

async function rebuildEmbeddingIndex(): Promise<void> {
  const token = localStorage.getItem("nowen-token") || "";
  const workspace = getCurrentWorkspace();
  const query = workspace && workspace !== "personal"
    ? `?workspaceId=${encodeURIComponent(workspace)}`
    : "";
  const response = await fetch(`${getBaseUrl()}/ai/embeddings/rebuild${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ clearExisting: true }),
  });
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  throw new Error(body?.error || `Request failed: ${response.status}`);
}

export default function EmbeddingSettingsPanel() {
  const copy = useMemo(getCopy, []);
  const [draft, setDraft] = useState<EmbeddingDraft>(EMPTY_DRAFT);
  const [profiles, setProfiles] = useState<AIProfile[]>([]);
  const [status, setStatus] = useState<ReliableStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<EmbeddingModelOption[]>([]);
  const [testResult, setTestResult] = useState<EmbeddingTestResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState<EmbeddingMessage | null>(null);

  const refreshStatus = useCallback(async (silent = false) => {
    if (!silent) setStatusLoading(true);
    try {
      setStatus(await getReliableAIStatus());
    } catch (error) {
      if (!silent) setMessage({ type: "error", text: (error as Error)?.message || copy.loadFailed });
    } finally {
      if (!silent) setStatusLoading(false);
    }
  }, [copy.loadFailed]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [settings, profileState] = await Promise.all([
        api.getAISettings() as Promise<AISettingsResponse>,
        aiProfiles.list(),
      ]);
      const source = inferEmbeddingCredentialSource(settings);
      const profileId = settings.ai_embedding_profile_id || "";
      const nextProfiles = profileState.profiles || [];
      setProfiles(nextProfiles);
      setDraft({
        source,
        profileId,
        url: settings.ai_embedding_url || "",
        key: "",
        keySet: !!settings.ai_embedding_key_set,
        model: settings.ai_embedding_model || "",
      });
      setDiscoveredModels([]);
      setTestResult(null);
      if (source === "profile" && profileId && !nextProfiles.some((profile) => profile.id === profileId)) {
        setMessage({ type: "warning", text: copy.profileMissingWarning });
      }
      await refreshStatus(true);
    } catch (error) {
      setMessage({ type: "error", text: (error as Error)?.message || copy.loadFailed });
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailed, copy.profileMissingWarning, refreshStatus]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => {
    let alive = true;
    const handleProfilesChanged = () => void aiProfiles.list().then(state => {
      if (alive) { setProfiles(state.profiles); void refreshStatus(true); }
    }).catch((error: Error) => { if (alive) setMessage({ type: "error", text: error.message }); });
    window.addEventListener("nowen:ai-profiles-changed", handleProfilesChanged);
    return () => { alive = false; window.removeEventListener("nowen:ai-profiles-changed", handleProfilesChanged); };
  }, [refreshStatus]);

  const queuedJobs = (status?.index.pending || 0) + (status?.index.processing || 0);
  useEffect(() => {
    if (queuedJobs <= 0) return;
    const timer = window.setInterval(() => void refreshStatus(true), 5_000);
    return () => window.clearInterval(timer);
  }, [queuedJobs, refreshStatus]);

  const selectedProfile = profiles.find((profile) => profile.id === draft.profileId) || null;
  const profileMissing = draft.source === "profile" && !!draft.profileId && !selectedProfile;
  const modelOptions = useMemo(
    () => mergeEmbeddingModelOptions(MODEL_SUGGESTIONS, discoveredModels),
    [discoveredModels],
  );

  useEffect(() => {
    if (loading || (draft.source === "profile" ? !selectedProfile : !draft.url)) return;
    let alive = true;
    void discoverEmbeddingModels(draft).then(result=>{if(alive)setDiscoveredModels(result.models);}).catch(()=>{if(alive)setDiscoveredModels([]);});
    return ()=>{alive=false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, draft.source, draft.profileId, selectedProfile?.updatedAt, draft.url]);

  const clearProbeState = () => {
    setDiscoveredModels([]);
    setTestResult(null);
  };

  const chooseSource = (source: EmbeddingCredentialSource) => {
    setDraft((current) => ({
      ...current,
      source,
      profileId: source === "profile" ? current.profileId || profiles[0]?.id || "" : current.profileId,
    }));
    clearProbeState();
    setMessage(null);
  };

  const refreshModels = async () => {
    if (draft.source === "profile" && !draft.profileId) {
      setMessage({ type: "warning", text: copy.profileRequired });
      return;
    }
    setDiscovering(true);
    setMessage(null);
    setTestResult(null);
    try {
      const result = await discoverEmbeddingModels(draft);
      setDiscoveredModels(result.models);
      const recommendedCount = result.models.filter((model) => model.recommended).length;
      setMessage({
        type: result.models.length > 0 ? "success" : "warning",
        text: result.models.length > 0
          ? copy.modelsFound(result.models.length, recommendedCount)
          : copy.noEmbeddingModels,
      });
    } catch (error) {
      setDiscoveredModels([]);
      setMessage({ type: "error", text: (error as Error)?.message || copy.discoverFailed });
    } finally {
      setDiscovering(false);
    }
  };

  const runEmbeddingTest = async () => {
    if (draft.source === "profile" && !draft.profileId) {
      setMessage({ type: "warning", text: copy.profileRequired });
      return;
    }
    if (!draft.model.trim()) {
      setMessage({ type: "warning", text: copy.modelRequired });
      return;
    }
    setTesting(true);
    setMessage(null);
    setTestResult(null);
    try {
      const result = await testEmbeddingModel(draft);
      setTestResult(result);
      setMessage({ type: "success", text: copy.testSucceeded(result.dimension, result.durationMs) });
    } catch (error) {
      setMessage({ type: "error", text: (error as Error)?.message || copy.testFailed });
    } finally {
      setTesting(false);
    }
  };

  const saveSettings = async () => {
    if (draft.source === "profile" && !draft.profileId) {
      setMessage({ type: "warning", text: copy.profileRequired });
      return;
    }
    setSaving(true);
    setMessage(null);
    const previousModel = status?.embeddingModel || "";
    const previousSource = status?.embedding?.source || "chat";
    const previousProfileId = status?.embedding?.profileId || "";
    try {
      const payload = buildEmbeddingSettingsPayload(draft);
      const updateAISettings = api.updateAISettings as unknown as (
        data: typeof payload,
      ) => Promise<AISettingsResponse>;
      const result = await updateAISettings(payload);
      const nextSource = inferEmbeddingCredentialSource(result);
      const nextProfileId = result.ai_embedding_profile_id || "";
      const nextModel = result.ai_embedding_model || "";
      setDraft((current) => ({
        ...current,
        source: nextSource,
        profileId: nextProfileId,
        url: result.ai_embedding_url || "",
        key: "",
        keySet: !!result.ai_embedding_key_set,
        model: nextModel,
      }));
      await refreshStatus(true);
      window.dispatchEvent(new CustomEvent("nowen:ai-settings-changed"));
      const changed = previousModel !== nextModel
        || previousSource !== nextSource
        || previousProfileId !== nextProfileId;
      setMessage({
        type: !nextModel || changed ? "warning" : "success",
        text: !nextModel ? copy.disabledSaved : changed ? copy.configurationChanged : copy.saved,
      });
    } catch (error) {
      setMessage({ type: "error", text: (error as Error)?.message || copy.saveFailed });
    } finally {
      setSaving(false);
    }
  };

  const rebuildIndex = async () => {
    if (!status?.index.configured) {
      setMessage({ type: "warning", text: status?.embedding?.error || copy.notConfigured });
      return;
    }
    if (!window.confirm(copy.rebuildConfirm)) return;
    setRebuilding(true);
    setMessage(null);
    try {
      await rebuildEmbeddingIndex();
      await refreshStatus(true);
      window.dispatchEvent(new CustomEvent("nowen:ai-settings-changed"));
      setMessage({ type: "success", text: copy.rebuildQueued });
    } catch (error) {
      setMessage({ type: "error", text: (error as Error)?.message || copy.rebuildFailed });
    } finally {
      setRebuilding(false);
    }
  };

  const index = status?.index;
  const busy = loading || saving || rebuilding;
  const vectorState = index?.vectorState || (index?.vectorAvailable ? "ready" : "unavailable");
  const fieldClass = "mt-1.5 w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-tx-primary outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/15";
  return <section className="space-y-5 p-5" aria-label={copy.title}>
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-tx-primary">{copy.title}</h3><span className="text-[11px] text-tx-tertiary">{index?.configured ? copy.enabled : copy.disabled}</span></div>
    {loading ? <div className="flex min-h-32 items-center justify-center"><Loader2 size={18} className="animate-spin text-tx-tertiary" /></div> : <>
      <label className="block text-xs text-tx-secondary">{copy.profileTitle}
        <AppSelect aria-label={copy.sourceLabel} disabled={busy} value={draft.source === "profile" ? `profile:${draft.profileId}` : draft.source} onChange={event => {
          const value = event.target.value;
          if (value.startsWith("profile:")) { setDraft(current => ({ ...current, source: "profile", profileId: value.slice(8) })); clearProbeState(); setMessage(null); }
          else chooseSource(value as EmbeddingCredentialSource);
        }} className={fieldClass}>
          <option value="chat">{copy.chatTitle}</option>
          <optgroup label={copy.profileTitle}>{profileMissing && <option value={`profile:${draft.profileId}`}>{copy.missingProfile}</option>}{profiles.map(profile => <option key={profile.id} value={`profile:${profile.id}`}>{profile.name}</option>)}</optgroup>
          <option value="custom">{copy.customTitle}</option>
        </AppSelect>
      </label>
      {draft.source === "custom" && <div className="space-y-4">
        <label className="block text-xs text-tx-secondary">{copy.embeddingUrl}<input value={draft.url} onChange={event => { setDraft({ ...draft, url: event.target.value }); clearProbeState(); }} placeholder={copy.urlPlaceholder} className={fieldClass} /></label>
        <label className="block text-xs text-tx-secondary">{copy.embeddingKey}<div className="relative"><input type={showKey ? "text" : "password"} value={draft.key} onChange={event => { setDraft({ ...draft, key: event.target.value }); clearProbeState(); }} placeholder={draft.keySet ? copy.savedKey : copy.keyPlaceholder} className={`${fieldClass} pr-10`} /><button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-tx-tertiary">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></label>
      </div>}
      <label className="block text-xs text-tx-secondary">{copy.embeddingModel}<ModelNameInput value={draft.model} onChange={model=>{setDraft({...draft,model});setTestResult(null);}} placeholder={copy.modelPlaceholder} models={modelOptions} label={copy.embeddingModel} className={fieldClass} /></label>
      <div className="flex flex-wrap gap-2 border-t border-app-border pt-4">
        <button type="button" onClick={() => void saveSettings()} disabled={busy || profileMissing || (draft.source === "profile" && !draft.profileId)} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-4 py-2 text-xs font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}{copy.save}</button>
        <button type="button" onClick={() => void refreshModels()} disabled={discovering || testing || busy || profileMissing} className="inline-flex items-center gap-1.5 rounded-lg border border-app-border px-3 py-2 text-xs text-tx-secondary disabled:opacity-50"><RefreshCw size={13} className={discovering ? "animate-spin" : ""} />{copy.discoverModels}</button>
        <button type="button" onClick={() => void runEmbeddingTest()} disabled={discovering || testing || busy || profileMissing || !draft.model.trim()} className="rounded-lg border border-app-border px-3 py-2 text-xs text-tx-secondary disabled:opacity-50">{testing ? copy.testingModel : copy.testModel}</button>
      </div>
      {discoveredModels.length > 0 && <AppSelect aria-label={copy.discoveredModels} value="" onChange={event => { if (event.target.value) { setDraft({ ...draft, model: event.target.value }); setTestResult(null); } }} className={fieldClass}><option value="">{copy.discoveredModels}</option>{discoveredModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</AppSelect>}
      {testResult && <p role="status" className="inline-flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 size={13} />{testResult.dimension} {copy.dimension} · {testResult.durationMs} ms</p>}
      {(status?.embedding?.error || profileMissing) && <p role="alert" className="text-xs text-amber-600">{status?.embedding?.error || copy.profileMissingWarning}</p>}
      {message && <p role="status" className={`text-xs ${message.type === "success" ? "text-emerald-600" : message.type === "warning" ? "text-amber-600" : "text-red-500"}`}>{message.text}</p>}
      <details className="border-t border-app-border pt-3"><summary className="cursor-pointer text-xs text-tx-tertiary">{copy.notes} {index ? `${index.indexedNotes}/${index.totalNotes}` : "—"} · {copy.pending} {index?.pending || 0}</summary>
        <div className="mt-3 space-y-3 text-xs text-tx-secondary">
          <p>{copy.attachments} {index ? `${index.indexedAttachments}/${index.totalAttachments}` : "—"} · {copy.failed} {index?.failed || 0}</p>
          <p>{copy.vectorEngine} · {vectorState === "ready" ? copy.ready : vectorState === "initializing" ? copy.initializing : copy.extensionFailure}{index?.vectorDimension ? ` · ${index.vectorDimension} ${copy.dimension}` : ""}</p>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void refreshStatus()} disabled={statusLoading || busy} className="rounded-lg border border-app-border px-3 py-2 disabled:opacity-50">{copy.refresh}</button><button type="button" onClick={() => void rebuildIndex()} disabled={busy || !index?.configured} className="rounded-lg border border-app-border px-3 py-2 disabled:opacity-50">{rebuilding ? copy.rebuilding : copy.rebuild}</button></div>
          <EmbeddingIndexFailureDetails failed={index?.failed || 0} onRetried={async count => { await refreshStatus(true); setMessage({ type: "success", text: copy.retried(count) }); }} />
        </div>
      </details>
    </>}
  </section>;
}
