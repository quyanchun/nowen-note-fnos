import AppSelect from "@/components/ui/AppSelect";
import ClipboardCaptureLogs from "./ClipboardCaptureLogs";
import { useEffect, useState } from "react";
import { ClipboardCopy, Copy, CircleHelp, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { Portal as TooltipPortal } from "@radix-ui/react-tooltip";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { clipboardIntegrationApi, clipboardSubmissionUrl, standaloneClipboardEndpoint, type ClipboardIntegrationSettings, type ClipboardDelivery } from "@/lib/clipboardIntegration";

function Help({ title, hint }: { title: string; hint: string }) {
  return <Tooltip><TooltipTrigger asChild><button type="button" aria-label={`${title}说明`} className="inline-flex shrink-0 items-center text-tx-tertiary hover:text-tx-primary"><CircleHelp size={13} /></button></TooltipTrigger><TooltipPortal><TooltipContent className="z-[120] max-w-72 leading-relaxed">{hint}</TooltipContent></TooltipPortal></Tooltip>;
}
export default function ClipboardIntegrationPanel() {
  const { i18n } = useTranslation();
  const label = (cn: string, en: string) => i18n.language.startsWith("zh") ? cn : en;
  const [settings, setSettings] = useState<ClipboardIntegrationSettings | null>(null);
  const [tokenSet, setTokenSet] = useState(false);
  const [endpoint, setEndpoint] = useState(clipboardSubmissionUrl);
  const [delivery, setDelivery] = useState<ClipboardDelivery>("direct");
  const [folders, setFolders] = useState<Array<{id:string;name:string}>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tab,setTab]=useState<"configuration"|"logs">("configuration");
  useEffect(() => {
    let disposed = false;
    clipboardIntegrationApi.get().then(async state => {
      const notebooks = state.folders || await api.getNotebooks();
      if (disposed) return;
      setSettings({ ...state.settings, integrationMode: state.settings.integrationMode || "nas",
        standaloneUrl: state.settings.standaloneUrl || (state.delivery !== "desktop" && !new URL(clipboardSubmissionUrl()).pathname.startsWith("/app/") ? clipboardSubmissionUrl().replace(/\/api\/clipboard\/captures$/, "") : "") }); setTokenSet(state.tokenSet);
      setEndpoint(state.delivery === "desktop"
        ? state.serverEndpoint || (state.serverUrl ? state.serverUrl.replace(/\/+$/, "") + "/api/clipboard/captures" : clipboardSubmissionUrl())
        : state.endpoint || clipboardSubmissionUrl());
      setDelivery(state.delivery || "direct");
      setFolders(notebooks.filter(folder => !("workspaceId" in folder) || !folder.workspaceId));
    }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, []);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : label("操作失败", "Operation failed")); }
    finally { setBusy(false); }
  };
  const copy = async (text: string) => {
    if (!await copyText(text)) throw new Error(label("复制失败，请检查剪贴板权限", "Copy failed. Check clipboard permission."));
  };
  if (!settings) return <div role="status" className="p-3 text-sm text-tx-secondary">{error || label("正在加载剪贴板设置…", "Loading clipboard settings…")}</div>;
  const patch = <K extends keyof ClipboardIntegrationSettings>(key: K, value: ClipboardIntegrationSettings[K]) => setSettings({ ...settings, [key]: value });
  const fieldClass = "mt-1 w-full rounded-md border border-app-border bg-app-surface px-2.5 py-1.5 text-sm text-tx-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/40";
  const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-md border border-app-border px-2.5 py-1.5 text-xs hover:bg-app-hover disabled:opacity-50";
  const heading = (title: string, hint: string) => <div className="mb-2 flex items-center gap-1.5"><h3 className="text-sm font-semibold text-tx-primary">{title}</h3><Help title={title} hint={hint} /></div>;
  const toggle = (key: "enabled" | "organize" | "filterFiles" | "filterImages" | "aiFilterEnabled", title: string, hint: string) => <div className="flex items-center gap-1.5">
    <label className="inline-flex items-center gap-2 text-sm text-tx-primary"><input type="checkbox" checked={settings[key]} onChange={e => patch(key, e.target.checked)} className="h-4 w-4 shrink-0 accent-accent-primary" />{title}</label><Help title={title} hint={hint} />
  </div>;
  const field = (key: "includeKeywords" | "excludeKeywords" | "excludeApps" | "excludeExtensions", title: string, hint: string) => <div>
    <div className="flex items-center gap-1.5"><label htmlFor={`clipboard-${key}`} className="text-xs text-tx-secondary">{title}</label><Help title={title} hint={hint} /></div>
    <textarea id={`clipboard-${key}`} aria-label={title} rows={2} value={settings[key].join("\n")} onChange={e => patch(key, e.target.value.split("\n"))} className={fieldClass} />
  </div>;
  const standalone = settings.integrationMode === "standalone";
  let standaloneEndpoint = "";
  try { if (settings.standaloneUrl) standaloneEndpoint = standaloneClipboardEndpoint(settings.standaloneUrl); } catch { /* Invalid draft is reported on save/copy. */ }
  const copyEndpoint = () => standalone ? standaloneClipboardEndpoint(settings.standaloneUrl || "") : endpoint;
  const normalized = () => ({ ...settings, ...Object.fromEntries((["includeKeywords", "excludeKeywords", "excludeApps", "excludeExtensions"] as const).map(key => [key, settings[key].map(item => item.trim()).filter(Boolean)])) });
  return <TooltipProvider delayDuration={200}><div className="space-y-3" data-testid="clipboard-settings-compact">
    <div className="flex items-center gap-2"><ClipboardCopy size={19} className="text-accent-primary" /><h2 className="text-base font-semibold text-tx-primary">{label("剪贴板集成", "Clipboard integration")}</h2><Help title={label("剪贴板集成", "Clipboard integration")} hint={label("智能收集文本，按规则和 AI 判断筛选，整理后自动归档到合适的目录或笔记，并保留原文。", "Collect text, filter it with rules and AI, organize it into suitable folders or notes, and preserve the original.")} /></div>
    <div role="tablist" aria-label={label("剪贴板集成页面","Clipboard integration pages")} className="flex gap-5 border-b border-app-border text-sm">
      {(["configuration","logs"] as const).map(value=><button key={value} type="button" role="tab" aria-selected={tab===value} onClick={()=>setTab(value)} className={`border-b-2 px-1 py-2 ${tab===value?"border-accent-primary text-accent-primary":"border-transparent text-tx-secondary"}`}>{value==="logs"?label("日志","Logs"):label("配置","Configuration")}</button>)}
    </div>
    {tab==="logs"&&<ClipboardCaptureLogs/>}
    <div hidden={tab!=="configuration"} className="space-y-3">
    <section className="space-y-2.5 rounded-lg border border-app-border p-3">
      <div className="flex items-center justify-between gap-3">{toggle("enabled",label("启用剪贴板集成","Enable clipboard integration"),label("修改后保存。关闭时立即拒绝新的专用Token请求。","Save to apply. Disabling rejects new token requests."))}<span className="text-xs text-tx-tertiary">{label(tokenSet?"Token 已生成":"尚未生成 Token",tokenSet?"Token ready":"No token yet")}</span></div>
      <label className="flex items-center gap-3 text-xs text-tx-secondary">{label("集成方式","Connection method")}<AppSelect aria-label={label("集成方式","Connection method")} value={settings.integrationMode || "nas"} onChange={e=>patch("integrationMode",e.target.value as "nas" | "standalone")} className="rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm text-tx-primary"><option value="nas">{label("NAS 网关","NAS gateway")}</option><option value="standalone">{label("独立服务","Standalone service")}</option></AppSelect><Help title={label("集成方式","Connection method")} hint={label("NAS 网关由剪贴板软件登录飞牛；独立服务通过专用 Token 直接调用笔记服务。两种方式共用当前账号的过滤和归档规则。","NAS gateway uses its existing sign-in session. Standalone connects directly with a dedicated token. Both use this account’s filtering and filing rules.")} /></label>
      {standalone && <label className="block text-xs text-tx-secondary">{label("独立服务地址","Standalone service address")}<input aria-label={label("独立服务地址","Standalone service address")} value={settings.standaloneUrl || ""} onChange={e=>patch("standaloneUrl",e.target.value)} placeholder="https://notes.example.com" className={fieldClass} /></label>}
      <label className="block text-xs text-tx-secondary">{label(standalone ? "提交接口地址" : delivery === "direct" ? "提交接口" : "NAS 服务地址",standalone ? "Submission endpoint" : delivery === "direct" ? "Submission endpoint" : "NAS service address")}<input aria-label={label(standalone ? "提交接口地址" : delivery === "direct" ? "提交接口" : "NAS 服务地址",standalone ? "Submission endpoint" : delivery === "direct" ? "Submission endpoint" : "NAS service address")} readOnly value={standalone ? standaloneEndpoint : endpoint} className={fieldClass} /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async()=>{await copy(copyEndpoint());setMessage(label("服务地址已复制","Service address copied"));})}><Copy size={14}/>{label(standalone || delivery === "direct" ? "复制接口地址" : "复制 NAS 地址",standalone || delivery === "direct" ? "Copy endpoint" : "Copy NAS address")}</button>
        <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async()=>{const value=await clipboardIntegrationApi.token();setTokenSet(true);await copy(value.token);setMessage(label("Token 已复制","Token copied"));})}><ClipboardCopy size={14}/>{label("复制 Token","Copy token")}</button>
        <button type="button" disabled={busy||!tokenSet} className={buttonClass} onClick={() => void run(async()=>{const value=await clipboardIntegrationApi.token(true);setTokenSet(true);await copy(value.token);setMessage(label("新 Token 已复制，旧 Token 已失效，请更新剪贴板软件配置。","New token copied. The old token is revoked; update your clipboard app."));})}><RefreshCw size={14}/>{label("重置并复制","Reset and copy")}</button>
        <button type="button" disabled={busy||!tokenSet} className={buttonClass} onClick={() => void run(async()=>{await clipboardIntegrationApi.revoke();setTokenSet(false);setMessage(label("Token 已撤销","Token revoked"));})}><Trash2 size={14}/>{label("撤销 Token","Revoke token")}</button>
        <Help title="Token" hint={label("首次复制时生成，之后可重复复制。请求头为Authorization: Bearer <Token>，仅允许智能收集。重置后旧Token立即失效。","Created on first copy and reusable. Header: Authorization: Bearer <Token>. Capture access only; resetting revokes the old token.")} />
      </div>

    </section>
    <section className="rounded-lg border border-app-border p-3">
      {heading(label("规则过滤","Rule filters"),label("每行一项，关键词忽略大小写，包含任意一项即可；排除任意一项则忽略。规则先于AI执行。","One entry per line, case-insensitive. Any required keyword can match; any excluded keyword skips. Runs before AI."))}
      <div className="mb-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="inline-flex items-center gap-2 text-xs text-tx-secondary">{label("最少字符","Minimum length")}<input aria-label={label("最少文本字符数","Minimum text length")} type="number" min={1} max={32000} value={settings.minChars} onChange={e=>patch("minChars",Number(e.target.value))} className="w-20 rounded-md border border-app-border bg-app-surface px-2 py-1 text-sm text-tx-primary" /></label>
        {toggle("filterFiles",label("忽略文件","Ignore files"),label("忽略kind=file的来源。取消后客户端也必须提供提取文本，不支持二进制上传。","Skip kind=file sources. Otherwise the client must provide extracted text; binary upload is unsupported."))}
        {toggle("filterImages",label("忽略图片","Ignore images"),label("忽略图片来源。取消后支持客户端上传PNG、JPEG、WebP、GIF；已配置多模态模型时生成200字以内说明。","Skip image sources. Otherwise accept uploaded PNG, JPEG, WebP and GIF; a configured multimodal model describes them in up to 200 characters."))}
      </div>
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
        {field("includeKeywords",label("包含关键词","Required keywords"),label("留空表示不限。每行一项，文本命中任意一项即可。","Empty means unrestricted. One per line; any keyword can match."))}
        {field("excludeKeywords",label("排除关键词","Excluded keywords"),label("每行一项，文本包含任意一项则忽略。","One per line; skip if any matches."))}
        {field("excludeApps",label("排除来源应用","Excluded source apps"),label("每行一项，与客户端sourceApp完整名称匹配。","One per line; matches the complete sourceApp value."))}
        {field("excludeExtensions",label("排除扩展名","Excluded extensions"),label("例如exe、zip，每行一项；客户端需提供fileName。","For example exe or zip, one per line; requires fileName metadata."))}
      </div>
      <div className="mt-2.5 border-t border-app-border pt-2.5">
        {toggle("aiFilterEnabled",label("启用 AI 过滤","Enable AI filtering"),label("规则通过后，AI按提示词判断是否收集。关闭时不执行额外AI过滤；归档时仍会跳过用途不明内容。AI异常保留原文，可重试。","After rules pass, AI decides whether to collect. Disabling skips the extra AI filter; filing still skips unclear content. AI errors retain the original and allow retry."))}
        {settings.aiFilterEnabled && <label className="mt-2 block text-xs text-tx-secondary">{label("AI 过滤提示词","AI filter instructions")}<textarea aria-label={label("AI 过滤提示词","AI filter instructions")} rows={2} maxLength={4000} value={settings.aiFilterPrompt} onChange={e=>patch("aiFilterPrompt",e.target.value)} placeholder={label("例如：只收集技术方案、学习资料和工作知识，忽略验证码、广告和闲聊。","For example: collect technical, learning and work knowledge; skip codes, ads and casual chat.")} className={fieldClass} /></label>}
      </div>
    </section>
    <section className="rounded-lg border border-app-border p-3">
      {heading(label("整理与归档","Organization and filing"),label("模型沿用当前账号AI配置；提示词不改变授权范围。","Uses this account’s AI configuration. Instructions cannot change permissions."))}
      <div className="mb-2.5 flex flex-wrap items-center gap-3"><label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-tx-secondary">{label("归档范围","Filing scope")}<AppSelect aria-label={label("归档范围","Filing scope")} value={settings.notebookId} onChange={e=>patch("notebookId",e.target.value)} className="min-w-0 flex-1 rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm text-tx-primary"><option value="">{label("个人空间：自动选择目录","Personal space: automatic")}</option>{folders.map(folder=><option key={folder.id} value={folder.id}>{folder.name}</option>)}</AppSelect></label><Help title={label("归档范围","Filing scope")} hint={label("选定目录后，只允许在该目录及子目录保存。","Restricts writes to the selected folder and descendants.")} />{toggle("organize",label("自动整理正文","Organize text"),label("关闭时新增正文使用原文，仍自动判断新建或追加。","When disabled, preserve the original added text while still choosing create or append."))}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-tx-secondary">{label("整理提示词","Organization instructions")}<textarea aria-label={label("整理提示词","Organization instructions")} rows={3} maxLength={2000} value={settings.instruction} onChange={e=>patch("instruction",e.target.value)} className={fieldClass} /></label>
        <div><div className="flex items-center gap-1.5"><label htmlFor="clipboard-system-prompt" className="text-xs text-tx-secondary">{label("系统 AI 提示词","System AI instructions")}</label><Help title={label("系统 AI 提示词","System AI instructions")} hint={label("补充知识分类、标题和写作习惯，仅用于剪贴板整理。是否收集由上方AI过滤提示词决定。","Add categorization, title and writing preferences. Collection decisions use the separate AI filter instructions above.")} /></div><textarea id="clipboard-system-prompt" aria-label={label("系统 AI 提示词","System AI instructions")} rows={3} maxLength={6000} value={settings.systemPrompt} onChange={e=>patch("systemPrompt",e.target.value)} className={fieldClass} /></div>
      </div>
    </section>
    <div className="sticky bottom-0 flex items-center gap-3 border-t border-app-border bg-app-surface py-2">
      <button type="button" disabled={busy} onClick={() => void run(async()=>{if(standalone){if(!settings.standaloneUrl?.trim())throw new Error(label("请填写独立服务地址","Enter the standalone service address"));standaloneClipboardEndpoint(settings.standaloneUrl);}if(settings.aiFilterEnabled&&!settings.aiFilterPrompt.trim())throw new Error(label("请填写 AI 过滤提示词","Enter AI filter instructions"));const result=await clipboardIntegrationApi.save(normalized());setSettings(result.settings);setTokenSet(result.tokenSet);setMessage(label("剪贴板设置已保存","Clipboard settings saved"));})} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{busy?<Loader2 size={15} className="animate-spin"/>:<Save size={15}/>} {label("保存设置","Save settings")}</button>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}{message && <p role="status" className="text-xs text-accent-primary">{message}</p>}
    </div>
    </div>
  </div></TooltipProvider>;
}
