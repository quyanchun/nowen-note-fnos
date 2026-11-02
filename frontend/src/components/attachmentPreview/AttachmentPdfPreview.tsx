// AttachmentPdfPreview.tsx —— PDF 附件预览
//
// Electron 默认关闭内置 PDF Viewer，且 Chromium 会阻止 sandbox iframe 加载 PDF 插件。
// 因此前端统一使用项目已有的 pdfjs-dist 绘制，避免网页端与桌面端行为不一致。
import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { cn } from "@/lib/utils";

interface Props {
  url: string;
  filename: string;
  /** 容器高度类，与其他子组件 API 保持一致 */
  heightClass?: string;
}

/** 给 url 加 inline=1，告诉后端走 inline 渲染而不是 attachment 下载 */
function toInlineUrl(url: string): string {
  if (!url) return url;
  // 已经带了 inline 参数就别重复加
  if (/[?&]inline=1\b/.test(url)) return url;
  const hashIndex = url.indexOf("#");
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  return base + (base.includes("?") ? "&" : "?") + "inline=1" + hash;
}

export default function AttachmentPdfPreview({ url, filename, heightClass }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let loadedDocument: PDFDocumentProxy | null = null;

    setDocument(null);
    setPageNumber(1);
    setLoading(true);
    setError("");

    void (async () => {
      try {
        const response = await fetch(toInlineUrl(url));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const [pdfjs, workerModule] = await Promise.all([
          import("pdfjs-dist/legacy/build/pdf.mjs"),
          import("pdfjs-dist/legacy/build/pdf.worker.mjs?url"),
        ]);
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
        }

        const nextLoadingTask = pdfjs.getDocument({
          data: new Uint8Array(await response.arrayBuffer()),
          isEvalSupported: false,
          useSystemFonts: true,
        });
        loadingTask = nextLoadingTask;
        const nextDocument = await nextLoadingTask.promise;
        loadedDocument = nextDocument;
        if (cancelled) {
          await nextDocument.destroy();
          return;
        }
        documentRef.current = nextDocument;
        setDocument(nextDocument);
      } catch (reason) {
        if (loadingTask && !loadedDocument) {
          const failedTask = loadingTask;
          loadingTask = null;
          void failedTask.destroy().catch(() => {});
        }
        if (!cancelled) {
          console.error("[AttachmentPdfPreview] load failed:", reason);
          setError("PDF 预览加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (loadedDocument) {
        if (documentRef.current === loadedDocument) {
          documentRef.current = null;
          void loadedDocument.destroy().catch(() => {});
        }
      } else if (loadingTask) {
        void loadingTask.destroy().catch(() => {});
      }
    };
  }, [url]);

  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    setRendering(true);
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas 2D context unavailable");

        const viewport = page.getViewport({ scale: 1.25 });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        canvas.style.width = `${Math.ceil(viewport.width)}px`;
        canvas.style.height = "";

        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        return renderTask.promise;
      })
      .catch((reason) => {
        if (!cancelled && reason?.name !== "RenderingCancelledException") {
          console.error("[AttachmentPdfPreview] render failed:", reason);
          setError("PDF 页面渲染失败");
          setDocument(null);
          if (documentRef.current === document) {
            documentRef.current = null;
            void document.destroy().catch(() => {});
          }
        }
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber]);

  const minHeight = heightClass ?? "min-h-[60vh]";

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center text-tx-tertiary", minHeight)}>
        <Loader2 size={16} className="mr-2 animate-spin" />
        正在加载 PDF…
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 px-6 text-center text-tx-tertiary", minHeight)}>
        <AlertCircle size={20} />
        <span className="text-xs">{error || "PDF 预览不可用"}</span>
        <a className="text-xs text-accent-primary hover:underline" href={url} download={filename}>
          下载原文件
        </a>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col bg-zinc-950/5" aria-label={filename || "PDF 预览"}>
      <div className="flex h-10 shrink-0 items-center justify-center gap-3 border-b border-app-border bg-app-surface">
        <button
          type="button"
          aria-label="上一页"
          disabled={pageNumber <= 1 || rendering}
          onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
          className="rounded p-1 text-tx-secondary hover:bg-app-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-16 text-center text-xs text-tx-secondary">
          {pageNumber} / {document.numPages}
        </span>
        <button
          type="button"
          aria-label="下一页"
          disabled={pageNumber >= document.numPages || rendering}
          onClick={() => setPageNumber((value) => Math.min(document.numPages, value + 1))}
          className="rounded p-1 text-tx-secondary hover:bg-app-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className={cn("relative flex items-start justify-center overflow-auto p-3", minHeight)}>
        {rendering && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-app-bg/60 text-tx-tertiary">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        <canvas ref={canvasRef} className="h-auto max-w-full bg-white shadow-sm" />
      </div>
    </div>
  );
}
