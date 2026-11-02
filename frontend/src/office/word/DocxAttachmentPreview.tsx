// office/word/DocxAttachmentPreview.tsx —— 把 /api/attachments/<id> 链接拉下来 → IR → 渲染
//
// 为什么单独抽一个组件而不是塞进 FileManager：
//   1. FileManager 已 2300+ 行，再塞解析/blob 释放逻辑会把它再拉宽 ~80 行，难维护
//   2. 解析失败、加载中、空态 这三种 UI 分支只跟 docx 自身相关，跟附件抽屉无关
//   3. 将来如果别处（比如 MarkdownEditor 链接拦截）也想嵌 docx 预览，可直接复用本组件
//
// 不做的事（避免过度设计）：
//   - 不做错误重试按钮（解析失败=docx 兼容性问题，重试也无济于事；给"原文下载"链接兜底）
//   - 不做 IR JSON 调试侧栏（只负责渲染，不做解析验证）
//
// 已做：
//   - 右下角浮动缩放条（- / 百分比 / +），状态持久化到 localStorage
//   - 桌面端 Ctrl/Cmd + 滚轮缩放
//   - 移动端 touch-action: pinch-zoom 启用原生双指缩放
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, Download, Upload, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { parseDocx, type DocxIR } from "@/office";
import WordViewer from "./WordViewer";

// 缩放档位：覆盖移动端"看不清"和桌面端"想看大图"两端需求，避免无级缩放带来的状态抖动。
// 0.5 给小屏看全局，3 给老花眼看细节，已足够。
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const ZOOM_LS_KEY = "docx-preview-zoom";

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], z));
}
function nextZoom(cur: number, dir: 1 | -1): number {
  // 找到当前最接近的档位再走一格；用户上次自由缩放出来的非档位值也能优雅过渡。
  const idx = ZOOM_STEPS.findIndex((v) => v >= cur - 1e-6);
  const base = idx < 0 ? ZOOM_STEPS.length - 1 : idx;
  const target = dir > 0 ? Math.min(base + 1, ZOOM_STEPS.length - 1) : Math.max(base - 1, 0);
  // 如果当前值正好等于档位且方向相同，再前进一格
  if (Math.abs(ZOOM_STEPS[base] - cur) < 1e-6 && dir > 0 && base < ZOOM_STEPS.length - 1) {
    return ZOOM_STEPS[base + 1];
  }
  if (Math.abs(ZOOM_STEPS[base] - cur) < 1e-6 && dir < 0 && base > 0) {
    return ZOOM_STEPS[base - 1];
  }
  return ZOOM_STEPS[target];
}

interface Props {
  /** 完整的附件 URL（已经过 resolveAttachmentUrl 处理） */
  url: string;
  /** 用于错误提示展示文件名 */
  filename: string;
  /** 文档区域高度（抽屉里建议给个 min 值，让 WordViewer 的 absolute inset:0 有得撑） */
  heightClass?: string;
  /**
   * 上传新版本回调。给"用 Word/WPS 编辑后回传"的场景用。
   * 提供时组件右上角会出现一个"上传新版本"按钮：用户选 .docx → 触发回调，
   * 组件本身不做任何 API 调用——由调用方决定怎么删旧 / 写新 / 更新笔记 content。
   * 回调返回成功后组件会自动重新拉 url 解析（如果 url 同时变了走 useEffect；
   * 没变就靠调用方手动 setKey 强刷）。
   */
  onReplace?: (file: File) => Promise<void>;
}

export default function DocxAttachmentPreview({ url, filename, heightClass, onReplace }: Props) {
  const [ir, setIr] = useState<DocxIR | null>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string>("");

  // parseDocx 内部会为内联图片 createObjectURL，
  // 切文档/卸载时必须 revoke，否则 SPA 久了会泄露内存。
  const ownedBlobUrls = useRef<string[]>([]);
  const releaseBlobUrls = useCallback(() => {
    for (const u of ownedBlobUrls.current) URL.revokeObjectURL(u);
    ownedBlobUrls.current = [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrMsg("");
    setIr(null);
    releaseBlobUrls();

    (async () => {
      try {
        // /api/attachments/<id> 是公开端点，但浏览器同源 fetch 会自动带 cookie；
        // 服务端走 Content-Disposition: attachment，对 fetch 接收 ArrayBuffer 没影响。
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const result = await parseDocx(buf);
        if (cancelled) {
          // 解析过程中组件已卸载/切走 → 直接释放，避免泄露
          for (const u of result.resources?.blobUrls ?? []) URL.revokeObjectURL(u);
          return;
        }
        ownedBlobUrls.current = result.resources?.blobUrls ?? [];
        setIr(result);
      } catch (e: any) {
        if (!cancelled) setErrMsg(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // url 变了就重新拉、重新解析
  }, [url, releaseBlobUrls]);

  // 组件卸载时释放
  useEffect(() => releaseBlobUrls, [releaseBlobUrls]);

  // 缩放：默认 1（100%），从 localStorage 恢复用户上次的偏好。
  // 用 lazy initializer 读 LS：避免 SSR/首次渲染抖动。
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(ZOOM_LS_KEY);
      const v = raw ? Number(raw) : NaN;
      return Number.isFinite(v) ? clampZoom(v) : 1;
    } catch {
      return 1;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(ZOOM_LS_KEY, String(zoom)); } catch { /* 隐私模式可能抛错，忽略 */ }
  }, [zoom]);

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(nextZoom(z, 1))), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(nextZoom(z, -1))), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  // Ctrl/Cmd + 滚轮：桌面端常见交互（PDF/图片预览都这么用）。
  // 不挂全局 wheel：只在 viewer 容器上挂，避免污染外层抽屉的滚动。
  const viewerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => clampZoom(nextZoom(z, e.deltaY < 0 ? 1 : -1)));
    };
    // 必须 passive:false 才能 preventDefault
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ir]); // ir 切换后 viewer DOM 重建，要重新挂

  // "上传新版本"流程：选文件 → 走 onReplace 回调 → 由外层决定如何删旧+上新。
  // 这里只负责 UI 状态（uploading）和最基础的 mime 校验，避免把附件 API 耦合进来。
  const [uploading, setUploading] = useState(false);
  const handlePickReplace = useCallback(() => {
    if (!onReplace) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        setUploading(true);
        await onReplace(file);
      } catch (err) {
        // 失败由 onReplace 内部 toast，组件这里只复位 state
        // eslint-disable-next-line no-console
        console.error("Replace docx failed:", err);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }, [onReplace]);

  const minH = heightClass ?? "min-h-[500px]";

  if (loading) {
    return (
      <div
        className={`relative w-full ${minH} flex items-center justify-center text-tx-tertiary`}
      >
        <Loader2 size={16} className="animate-spin mr-2" />
        正在解析 {filename}…
      </div>
    );
  }

  if (errMsg || !ir) {
    return (
      <div
        className={`relative w-full ${minH} flex flex-col items-center justify-center gap-2 text-tx-tertiary px-6 text-center`}
      >
        <AlertTriangle size={20} className="text-amber-500" />
        <div className="text-xs">无法预览此文档</div>
        {errMsg && (
          <div className="text-[10px] text-tx-tertiary/70 max-w-full break-all">
            {errMsg}
          </div>
        )}
        <a
          href={url}
          download={filename}
          className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] bg-app-surface border border-app-border hover:bg-app-hover text-tx-primary"
        >
          <Download size={11} />
          下载原文件
        </a>
      </div>
    );
  }

  return (
    // WordViewer 用 position:absolute / inset:0 撑满父级，所以这里必须 relative + 显式高度
    // touch-action: pinch-zoom 让移动端原生双指缩放可用（叠加在 zoom 之上做"细看"）
    <div
      ref={viewerRef}
      className={`relative w-full ${minH}`}
      style={{ touchAction: "pinch-zoom" }}
    >
      <WordViewer ir={ir} zoom={zoom} />
      {/* 右下角浮动缩放条：放右下避免和右上角"上传新版本"按钮抢位 */}
      <div
        className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 px-1 py-1 rounded-lg bg-app-elevated/95 backdrop-blur border border-app-border shadow-md"
        // 工具条本身不参与缩放手势
        style={{ touchAction: "manipulation" }}
      >
        <button
          type="button"
          onClick={zoomOut}
          disabled={zoom <= ZOOM_STEPS[0] + 1e-6}
          className="p-1.5 rounded-md text-tx-secondary hover:text-tx-primary hover:bg-app-hover disabled:opacity-40 disabled:cursor-not-allowed"
          title="缩小（Ctrl+滚轮）"
          aria-label="缩小"
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          onClick={zoomReset}
          className="px-2 py-1 rounded-md text-[11px] text-tx-secondary hover:text-tx-primary hover:bg-app-hover min-w-[44px] tabular-nums"
          title="重置为 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={zoomIn}
          disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 1e-6}
          className="p-1.5 rounded-md text-tx-secondary hover:text-tx-primary hover:bg-app-hover disabled:opacity-40 disabled:cursor-not-allowed"
          title="放大（Ctrl+滚轮）"
          aria-label="放大"
        >
          <ZoomIn size={14} />
        </button>
        {Math.abs(zoom - 1) > 1e-6 && (
          <button
            type="button"
            onClick={zoomReset}
            className="p-1.5 rounded-md text-tx-tertiary hover:text-tx-primary hover:bg-app-hover"
            title="重置缩放"
            aria-label="重置缩放"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
      {onReplace && (
        // 浮在右上角：让"用 Word 改完上传覆盖"成为一个明显入口。
        // 不放工具栏正中央：避免和未来真正的"内联编辑"按钮抢位。
        <button
          type="button"
          onClick={handlePickReplace}
          disabled={uploading}
          className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] bg-app-elevated/95 backdrop-blur border border-app-border shadow-sm hover:bg-app-hover text-tx-primary disabled:opacity-60 disabled:cursor-not-allowed"
          title="上传修改后的 .docx 覆盖原附件"
        >
          {uploading ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Upload size={11} />
          )}
          {uploading ? "上传中…" : "上传新版本"}
        </button>
      )}
    </div>
  );
}
