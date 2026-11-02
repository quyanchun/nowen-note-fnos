import AppSelect from "@/components/ui/AppSelect";
import React, { useState, useCallback } from "react";
import {
  Link2, Loader2, CheckCircle, AlertCircle, Download, ExternalLink,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions } from "@/store/AppContext";
import { api } from "@/lib/api";

type Phase = "idle" | "importing" | "done" | "error";

/**
 * 通过 URL 导入文章。
 * v1：仅支持微信公众号链接（mp.weixin.qq.com/s/...）。
 *   - 后端抓取 HTML、提取正文、把内嵌图片下载到附件库（同 user 内按 hash 去重）
 *   - 笔记 content 直接存 HTML 字符串（与 micloud/icloud 导入路径一致）
 *   - 工作区上下文随当前 sidebar 选择自动带入
 */
export default function UrlImport() {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();

  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [selectedNotebookId, setSelectedNotebookId] = useState("");
  const [lastResult, setLastResult] = useState<{
    title: string;
    noteId: string;
    images: { downloaded: number; failed: number };
  } | null>(null);

  const isWeixin = /^https:\/\/mp\.weixin\.qq\.com\/s[\/?]/.test(url.trim());

  const handleImport = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setPhase("error");
      setMessage(t("urlImport.urlRequired"));
      return;
    }
    if (!isWeixin) {
      setPhase("error");
      setMessage(t("urlImport.unsupportedUrl"));
      return;
    }

    setPhase("importing");
    setMessage(t("urlImport.importing"));

    try {
      const result = await api.urlImport(trimmed, selectedNotebookId || undefined);
      setLastResult({
        title: result.title,
        noteId: result.noteId,
        images: result.images,
      });
      setPhase("done");
      const failedTip =
        result.images.failed > 0
          ? `（${t("urlImport.imagesFailed", { count: result.images.failed })}）`
          : "";
      setMessage(t("urlImport.importSuccess", { title: result.title }) + failedTip);
      // 刷新 notebooks 列表，确保新创建的"导入的文章"出现在侧栏
      api.getNotebooks().then(actions.setNotebooks).catch(console.error);
    } catch (err: any) {
      setPhase("error");
      setMessage(err?.message || t("urlImport.importFailed"));
    }
  }, [url, isWeixin, selectedNotebookId, t, actions]);

  return (
    <section className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <Link2 size={18} className="text-purple-500" />
        <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {t("urlImport.title")}
        </h4>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 p-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
          {t("urlImport.description")}
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">
              {t("urlImport.urlLabel")}
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (phase === "error" || phase === "done") {
                    setPhase("idle");
                    setMessage("");
                  }
                }}
                placeholder="https://mp.weixin.qq.com/s/..."
                disabled={phase === "importing"}
                className="flex-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 disabled:opacity-60"
              />
            </div>
            {url.trim() && !isWeixin && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {t("urlImport.unsupportedUrl")}
              </p>
            )}
          </div>

          <div>
            <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">
              {t("dataManager.importToNotebook")}
            </label>
            <AppSelect
              value={selectedNotebookId}
              onChange={(e) => setSelectedNotebookId(e.target.value)}
              disabled={phase === "importing"}
              className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-3 py-1.5 outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 disabled:opacity-60"
            >
              <option value="">{t("urlImport.autoCreateNotebook")}</option>
              {state.notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.icon} {nb.name}
                </option>
              ))}
            </AppSelect>
          </div>

          {message && (
            <div
              className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
                phase === "error"
                  ? "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400"
                  : phase === "done"
                  ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
              }`}
            >
              {phase === "error" ? (
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              ) : phase === "done" ? (
                <CheckCircle size={14} className="flex-shrink-0 mt-0.5" />
              ) : (
                <Loader2 size={14} className="flex-shrink-0 mt-0.5 animate-spin" />
              )}
              <span className="leading-relaxed">{message}</span>
            </div>
          )}

          {phase === "done" && lastResult && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                {t("urlImport.imagesDownloaded", { count: lastResult.images.downloaded })}
              </span>
              <button
                onClick={async () => {
                  try {
                    const note = await api.getNote(lastResult.noteId);
                    actions.setActiveNote(note);
                  } catch (e) {
                    console.warn("打开笔记失败", e);
                  }
                }}
                className="ml-auto inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:underline"
              >
                <ExternalLink size={12} />
                {t("urlImport.openNote")}
              </button>
            </div>
          )}

          <button
            onClick={handleImport}
            disabled={phase === "importing" || !url.trim() || !isWeixin}
            className={`flex items-center justify-center w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-all ${
              phase === "importing" || !url.trim() || !isWeixin
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed"
                : phase === "done"
                ? "bg-green-500 hover:bg-green-600 text-white shadow-md"
                : "bg-purple-500 hover:bg-purple-600 text-white shadow-md hover:shadow-lg"
            }`}
          >
            {phase === "importing" ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t("urlImport.importing")}
              </>
            ) : phase === "done" ? (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                {t("urlImport.importedAgain")}
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                {t("urlImport.importButton")}
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
