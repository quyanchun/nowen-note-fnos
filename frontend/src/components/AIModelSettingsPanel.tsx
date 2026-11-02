import AppSelect from "@/components/ui/AppSelect";
import ModelNameInput from "./ModelNameInput";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Save } from "lucide-react";
import { aiProfiles, emitAIProfilesChanged, type AIModelOption, type AIModelPurpose, type AIModelSelection, type AIProfile } from "@/lib/aiProfiles";
import { getNonChatModelKind } from "@/lib/chatModelType";

export default function AIModelSettingsPanel({ purpose }: { purpose: AIModelPurpose }) {
  const zh = (localStorage.getItem("i18nextLng") || navigator.language).toLowerCase().startsWith("zh");
  const chat = purpose === "chat";
  const title = chat ? (zh ? "对话模型" : "Chat model") : (zh ? "多模态处理模型" : "Multimodal model");
  const [profiles, setProfiles] = useState<AIProfile[]>([]);
  const [selection, setSelection] = useState<AIModelSelection>({ profileId: "", model: "" });
  const [models, setModels] = useState<AIModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const discovery = useRef(0);
  const selected = profiles.find(profile => profile.id === selection.profileId);
  const missing = !!selection.profileId && !selected;
  const invalidModel = !!getNonChatModelKind(selection.model);

  useEffect(() => {
    let alive = true;
    void Promise.all([aiProfiles.list(), aiProfiles.modelSettings(purpose)]).then(([state, value]) => {
      if (alive) { setProfiles(state.profiles); setSelection(value); setLoaded(true); }
    }).catch((error: Error) => { if (alive) setMessage({ error: true, text: error.message }); })
      .finally(() => { if (alive) setLoading(false); });
    // A channel edit refreshes metadata without discarding an unsaved model choice.
    const refresh = () => void aiProfiles.list().then(state => {
      if (alive) setProfiles(state.profiles);
    }).catch((error: Error) => { if (alive) setMessage({ error: true, text: error.message }); });
    window.addEventListener("nowen:ai-profiles-changed", refresh);
    return () => { alive = false; discovery.current++; window.removeEventListener("nowen:ai-profiles-changed", refresh); };
  }, [purpose]);

  useEffect(() => {
    setModels([]);
    setDiscovering(false);
    discovery.current++;
  }, [selected?.id, selected?.updatedAt]);

  const refreshModels = async () => {
    if (!selected) return;
    const seq = ++discovery.current;
    setDiscovering(true); setMessage(null);
    try {
      const result = await aiProfiles.discoverModels(selected, selected.id, chat ? "chat" : "all");
      if (seq !== discovery.current) return;
      setModels(result.models.filter(model => !getNonChatModelKind(model.id)));
      if (!result.models.length) setMessage({ error: false, text: zh ? "未返回模型列表，可以手动填写模型名称。" : "No models returned. Enter a model name manually." });
    } catch (error) {
      if (seq === discovery.current) setMessage({ error: true, text: (error as Error).message });
    } finally { if (seq === discovery.current) setDiscovering(false); }
  };

  useEffect(() => {
    void refreshModels();
    return () => { discovery.current++; };
    // Discovery follows the channel, never overwrites a manually entered name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.updatedAt, purpose]);

  const save = async (test = false) => {
    setBusy(true); setMessage(null);
    try {
      if (test && selected) {
        const result = chat
          ? await aiProfiles.testDraft({ ...selected, model: selection.model }, selected.id)
          : await aiProfiles.testMultimodal({ profileId: selected.id, model: selection.model });
        if (!result.success) throw new Error(result.error || result.message || (zh ? "连接失败" : "Connection failed"));
      } else {
        setSelection(await aiProfiles.saveModelSettings(purpose, selection));
        if (chat) emitAIProfilesChanged(selection.profileId);
        window.dispatchEvent(new Event("nowen:ai-settings-changed"));
      }
      setMessage({ error: false, text: test ? (chat ? (zh ? "连接成功" : "Connection succeeded") : (zh ? "图片测试通过" : "Image test passed")) : (zh ? "模型配置已保存" : "Model settings saved") });
    } catch (error) { setMessage({ error: true, text: (error as Error).message }); }
    finally { setBusy(false); }
  };

  return <section aria-label={title} className="space-y-5 p-5">
    <h3 className="text-sm font-semibold text-tx-primary">{title}</h3>
    <fieldset disabled={loading || busy || !loaded} className="space-y-3 disabled:opacity-60">
      <div className="grid gap-4">
        <label className="block space-y-1.5 text-xs text-tx-secondary">{zh ? "厂商渠道" : "Provider channel"}
          <AppSelect value={selection.profileId} onChange={event => { discovery.current++; setDiscovering(false); setModels([]); setSelection({ profileId: event.target.value, model: "" }); setMessage(null); }} className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-tx-primary">
            <option value="">{zh ? "请选择渠道" : "Select a channel"}</option>
            {missing && <option value={selection.profileId}>{zh ? "渠道已删除" : "Deleted channel"}</option>}
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </AppSelect>
        </label>
        <label className="block space-y-1.5 text-xs text-tx-secondary">{zh ? "模型" : "Model"}
          <ModelNameInput value={selection.model} onChange={model => { setSelection({ ...selection, model }); setMessage(null); }} models={models} placeholder={zh ? "选择或输入模型名称" : "Select or enter a model name"} label={zh ? "模型" : "Model"} className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-tx-primary" />
        </label>
      </div>
      {(missing || invalidModel) && <p role="alert" className="text-xs text-amber-600">{missing ? (zh ? "渠道不存在或已删除，请重新选择。" : "This channel was deleted. Choose another.") : (zh ? "这是向量或重排序模型，请在对应分项中配置。" : "This is an embedding or reranking model. Use the appropriate section.")}</p>}
      <div className="flex flex-wrap gap-2 border-t border-app-border pt-3">
        <button type="button" disabled={missing || invalidModel || (chat ? !selected || !selection.model.trim() : !!selection.profileId !== !!selection.model.trim())} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-4 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}{zh ? "保存配置" : "Save settings"}</button>
        <button type="button" onClick={() => void refreshModels()} disabled={!selected || discovering} className="inline-flex items-center gap-1.5 rounded-lg border border-app-border px-3 py-2 text-xs text-tx-secondary disabled:opacity-50"><RefreshCw size={13} className={discovering ? "animate-spin" : ""} />{zh ? "刷新模型" : "Refresh models"}</button>
        <button type="button" onClick={() => void save(true)} disabled={!selected || !selection.model.trim() || invalidModel} className="rounded-lg border border-app-border px-3 py-2 text-xs text-tx-secondary disabled:opacity-50">{zh ? "测试连接" : "Test connection"}</button>
      </div>
    </fieldset>
    {message && <p role="status" className={`flex items-center gap-1.5 text-xs ${message.error ? "text-red-500" : "text-emerald-600"}`}>{message.error ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}{message.text}</p>}
  </section>;
}
