import AppSelect from "@/components/ui/AppSelect";
import ModelNameInput from "./ModelNameInput";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { voiceApi, type SpeechCredentialSource, type SpeechSettings, type SpeechSettingsInput } from "@/lib/api";
import { aiProfiles, type AIModelOption, type AIProfile } from "@/lib/aiProfiles";

export default function SpeechSettingsPanel() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SpeechSettings>({ apiUrl: "", model: "whisper-1", language: null, apiKeySet: false, configured: false, source: "custom", profileId: "" });
  const [profiles, setProfiles] = useState<AIProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [headers, setHeaders] = useState("{}");
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [models, setModels] = useState<AIModelOption[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const discovery = useRef(0);
  useEffect(() => {
    let cancelled = false;
    void voiceApi.settings().then(value => {
      if (cancelled) return;
      setSettings({ ...value, source: value.source || "custom" });
      setHeaders(JSON.stringify(value.customHeaders || {}, null, 2));
    }).catch((error: Error) => { if (!cancelled) setMessage(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => void aiProfiles.list().then(value => {
      if (!cancelled) { setProfiles(value.profiles); setActiveProfileId(value.activeProfileId); }
    }).catch((error: Error) => { if (!cancelled) setMessage(error.message); });
    refresh();
    window.addEventListener("nowen:ai-profiles-changed", refresh);
    return () => { cancelled = true; window.removeEventListener("nowen:ai-profiles-changed", refresh); };
  }, []);
  const source = settings.source || "custom";
  const selected = profiles.find(profile => profile.id === (source === "chat" ? activeProfileId : settings.profileId));
  useEffect(() => { discovery.current++; setModels([]); setDiscovering(false); return () => { discovery.current++; }; }, [source, selected?.id, selected?.updatedAt]);
  const missingProfile = source === "profile" && !!settings.profileId && !selected;
  const chooseSource = (next: SpeechCredentialSource) => {
    setSettings(current => ({ ...current, source: next, error: null, profileId: next === "profile" ? current.profileId || profiles[0]?.id || "" : current.profileId }));
    setMessage("");
  };
  const refreshModels = async () => {
    const seq = ++discovery.current;
    setDiscovering(true); setMessage("");
    try {
      const candidate = source === "custom" ? { name: "Speech", provider: "custom", apiUrl: settings.apiUrl, apiKey: key, customHeaders: headers } : selected;
      if (!candidate?.apiUrl) return;
      const result = await aiProfiles.discoverModels(candidate, source === "custom" ? undefined : selected?.id, "all");
      if (seq === discovery.current) setModels(result.models);
    } catch (error) { if (seq === discovery.current) setMessage((error as Error).message); }
    finally { if (seq === discovery.current) setDiscovering(false); }
  };
  useEffect(() => {
    if (source !== "custom") { if(selected)void refreshModels();return ()=>{discovery.current++;}; }
    const timer = window.setTimeout(()=>{if(settings.apiUrl)void refreshModels();},600);
    return () => { window.clearTimeout(timer);discovery.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, selected?.id, selected?.updatedAt, source === "custom" ? settings.apiUrl : ""]);
  const save = async (test: boolean) => {
    setBusy(true); setMessage("");
    const payload: SpeechSettingsInput = {
      source, profileId: source === "profile" ? settings.profileId || "" : "", model: settings.model.trim(), language: settings.language || null,
      ...(source === "custom" ? { apiUrl: settings.apiUrl.trim(), customHeaders: headers, ...(clearKey ? { apiKey: "" } : key ? { apiKey: key } : {}) } : {}),
    };
    try {
      if (test) await voiceApi.test(payload);
      else {
        const updated = await voiceApi.saveSettings(payload);
        setSettings(updated); setHeaders(JSON.stringify(updated.customHeaders || {}, null, 2)); setKey(""); setClearKey(false);
        window.dispatchEvent(new Event("nowen:speech-settings-changed"));
      }
      setMessage(t(test ? "voice.testSuccess" : "voice.configSaved"));
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };
  const fieldClass = "mt-1.5 w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-tx-primary outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/15";
  return <section className="space-y-5 p-5" aria-label={t("voice.settings")}>
    <h3 className="text-sm font-semibold text-tx-primary">{t("voice.settings")}</h3>
    <fieldset disabled={busy || loading} className="space-y-4 disabled:opacity-60">
      <label className="block text-xs text-tx-secondary">{t("voice.channel")}
        <AppSelect value={source === "profile" ? `profile:${settings.profileId || ""}` : source} onChange={event => {
          const value = event.target.value;
          if (value.startsWith("profile:")) { setSettings({ ...settings, source: "profile", profileId: value.slice(8), error: null }); setMessage(""); }
          else chooseSource(value as SpeechCredentialSource);
        }} className={fieldClass}>
          <option value="chat">{t("voice.source_chat")}</option>
          <optgroup label={t("voice.source_profile")}>{missingProfile && <option value={`profile:${settings.profileId}`}>{t("voice.deletedChannel")}</option>}{profiles.map(profile => <option key={profile.id} value={`profile:${profile.id}`}>{profile.name}</option>)}</optgroup>
          <option value="custom">{t("voice.source_custom")}</option>
        </AppSelect>
      </label>
      {source === "custom" && <>
        <label className="block text-xs text-tx-secondary">{t("voice.apiUrl")}<input value={settings.apiUrl} placeholder="https://api.openai.com/v1" onChange={event => setSettings({ ...settings, apiUrl: event.target.value })} className={fieldClass} /></label>
        <label className="block text-xs text-tx-secondary">{t("voice.apiKey")}<input type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)} placeholder={settings.apiKeySet ? t("voice.keySet") : ""} className={fieldClass} /></label>
        {settings.apiKeySet && <label className="flex items-center gap-2 text-xs text-tx-secondary"><input type="checkbox" checked={clearKey} onChange={event => setClearKey(event.target.checked)} />{t("voice.clearKey")}</label>}
        <details className="rounded-lg border border-app-border px-3 py-2.5"><summary className="cursor-pointer text-xs text-tx-secondary">{t("voice.customHeaders")}</summary><textarea rows={3} value={headers} onChange={event => setHeaders(event.target.value)} spellCheck={false} autoComplete="off" className={`${fieldClass} font-mono text-xs`} /></details>
      </>}
      <label className="block text-xs text-tx-secondary">{t("voice.model")}<ModelNameInput value={settings.model} onChange={model=>setSettings({...settings,model})} models={models} label={t("voice.model")} placeholder="whisper-1" className={fieldClass} /></label>
      <label className="block text-xs text-tx-secondary">{t("voice.language")}<input value={settings.language || ""} placeholder="auto" onChange={event=>setSettings({...settings,language:event.target.value})} className={fieldClass} /></label>
      {missingProfile && <p role="alert" className="text-xs text-amber-600">{t("voice.deletedChannel")}</p>}
      <div className="flex flex-wrap gap-2 border-t border-app-border pt-4">
        <button type="button" disabled={source === "profile" && (!settings.profileId || missingProfile)} onClick={() => void save(false)} className="rounded-lg bg-accent-primary px-4 py-2 text-xs font-medium text-white disabled:opacity-50">{t("voice.save")}</button>
        {<button type="button" onClick={() => void refreshModels()} disabled={discovering || (source === "custom" ? !settings.apiUrl : !selected)} className="rounded-lg border border-app-border px-3 py-2 text-xs text-tx-secondary disabled:opacity-50">{discovering ? t("common.loading") : "刷新模型"}</button>}
        <button type="button" disabled={!settings.model.trim() || (source === "custom" ? !settings.apiUrl.trim() : !selected?.apiUrl)} onClick={() => void save(true)} className="rounded-lg border border-app-border px-3 py-2 text-xs text-tx-secondary disabled:opacity-50">{t("voice.test")}</button>
      </div>
    </fieldset>
    {message && <p role="status" className="text-xs text-tx-secondary">{message}</p>}
  </section>;
}
