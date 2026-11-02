import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import AppSelect from "@/components/ui/AppSelect";
import { api } from "@/lib/api";
import { collaborationScope, readCollaborationDraft, type CollaborationDraft } from "@/lib/aiCollaboration";
import type { CapturePreferences } from "@/lib/homeCaptureAI";
import type { Notebook } from "@/types";

export default function HomeCaptureSettings({ preferences, destinationLocked, allowRestore, onSave, onRestore, onClose }: {
  preferences: CapturePreferences; destinationLocked: boolean; allowRestore: boolean;
  onSave: (preferences: CapturePreferences) => Promise<void>;
  onRestore: (draft: CollaborationDraft) => Promise<void>;
  onClose: () => void;
}) {
  const { i18n } = useTranslation(); const zh = i18n.language.startsWith("zh");
  const [value, setValue] = useState(preferences); const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const [legacy] = useState(() => { try { return readCollaborationDraft(collaborationScope()); } catch { return null; } });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLButtonElement>("button")?.focus();
    let active = true;
    void api.getNotebooks().then(rows => { if (active) setNotebooks(rows); }).catch(() => { if (active) setError(zh ? "无法加载文件夹，请重试。" : "Could not load folders. Please retry."); });
    return () => { active = false; if (before?.isConnected) before.focus(); };
  }, [zh]);
  const options = (writable = false) => notebooks.filter(row => !writable || !row.permission || ["write", "manage"].includes(row.permission)).map(row => {
    const names = [row.name]; const seen = new Set([row.id]); let parent = row.parentId;
    while (parent && !seen.has(parent)) { seen.add(parent); const item = notebooks.find(n => n.id === parent); if (!item) break; names.unshift(item.name); parent = item.parentId; }
    return <option key={row.id} value={row.id}>{names.join(" / ")}</option>;
  });
  const field = "w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm disabled:opacity-50";
  const run = async (action: () => Promise<void>) => { setSaving(true); setError(""); try { await action(); onClose(); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } };
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4" onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); if (!saving) onClose(); }
    if (event.key === "Tab") {
      const items = box.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[role="combobox"]');
      const first = items?.[0], last = items?.[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><div ref={box} role="dialog" aria-modal="true" aria-labelledby="home-capture-settings-title" className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-app-surface text-tx-primary shadow-xl">
    <header className="flex items-center justify-between border-b border-app-border px-5 py-4"><h2 id="home-capture-settings-title" className="font-semibold">{zh ? "随手收集设置" : "Capture settings"}</h2><button aria-label={zh ? "关闭设置" : "Close settings"} disabled={saving} onClick={onClose}><X size={18} /></button></header>
    <div className="space-y-4 p-5">
      <label className="block space-y-2 text-sm"><span>{zh ? "保存位置" : "Save to"}</span><AppSelect aria-label={zh ? "保存位置" : "Save to"} className={field} disabled={saving || destinationLocked} value={value.notebookId || ""} onChange={e => setValue({ ...value, notebookId: e.target.value || undefined })}><option value="">{zh ? "收集箱（默认）" : "Inbox (default)"}</option>{value.notebookId && !notebooks.some(row => row.id === value.notebookId) && <option value={value.notebookId}>{zh ? "已选择的文件夹" : "Selected folder"}</option>}{options(true)}</AppSelect></label>
      <label className="block space-y-2 text-sm"><span>{zh ? "AI 整理方式" : "AI organization"}</span><AppSelect aria-label={zh ? "AI 整理方式" : "AI organization"} className={field} disabled={saving} value={value.method} onChange={e => setValue({ ...value, method: e.target.value as CapturePreferences["method"] })}><option value="tidy">{zh ? "轻度整理（默认）" : "Light cleanup (default)"}</option><option value="summary">{zh ? "提炼要点" : "Key points"}</option><option value="tasks">{zh ? "待办清单" : "Task list"}</option></AppSelect></label>
      <p className="text-xs leading-5 text-tx-tertiary">{zh ? "默认直接保存；点击“AI 整理”才会处理文字，整理后可编辑，保存时保留原文。" : "Save directly, or choose AI cleanup first. Edit the result before saving; the original is preserved."}</p>
      <details><summary className="cursor-pointer text-sm text-tx-secondary">{zh ? "更多选项（可不填）" : "More options (optional)"}</summary><div className="mt-4 space-y-4">
        <label className="block space-y-2 text-sm"><span>{zh ? "参考资料" : "Reference folder"}</span><AppSelect aria-label={zh ? "参考资料" : "Reference folder"} className={field} disabled={saving} value={value.referenceNotebookId || ""} onChange={e => setValue({ ...value, referenceNotebookId: e.target.value || undefined })}><option value="">{zh ? "不引用其他笔记" : "No other notes"}</option>{options()}</AppSelect></label>
        <label className="block space-y-2 text-sm"><span>{zh ? "补充要求" : "Additional instructions"}</span><textarea className={field} disabled={saving} rows={3} maxLength={2000} value={value.instruction || ""} placeholder={zh ? "例如：按事项分段，保留所有链接，不扩写。留空即可。" : "For example: group by topic and keep all links. Optional."} onChange={e => setValue({ ...value, instruction: e.target.value })} /></label>
        {legacy?.input && allowRestore && <button className="text-sm text-accent-primary" disabled={saving} onClick={() => void run(() => onRestore(legacy))}>{zh ? "恢复旧快记草稿" : "Restore previous capture"}</button>}
      </div></details>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    </div><footer className="flex justify-end border-t border-app-border px-5 py-3"><button disabled={saving} onClick={() => void run(() => onSave(value))} className="rounded-lg bg-accent-primary px-4 py-2 text-sm text-white disabled:opacity-50">{zh ? "完成" : "Done"}</button></footer>
  </div></div>, document.body);
}
