import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  render: vi.fn(),
  documentDestroy: vi.fn(),
  loadingDestroy: vi.fn(),
  workerOptions: { workerSrc: "" },
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: pdfMocks.workerOptions,
  getDocument: pdfMocks.getDocument,
}));

vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs?url", () => ({
  default: "/assets/pdf.worker.mjs",
}));

import AttachmentPdfPreview from "@/components/attachmentPreview/AttachmentPdfPreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AttachmentPdfPreview", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.spyOn(console, "error").mockImplementation(() => {});

    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as CanvasRenderingContext2D);

    const renderTask = { promise: Promise.resolve(), cancel: vi.fn() };
    pdfMocks.render.mockReturnValue(renderTask);
    const page = {
      getViewport: vi.fn(({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
      })),
      render: pdfMocks.render,
    };
    const pdf = {
      numPages: 2,
      getPage: vi.fn().mockResolvedValue(page),
      destroy: pdfMocks.documentDestroy.mockResolvedValue(undefined),
    };
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve(pdf),
      destroy: pdfMocks.loadingDestroy.mockResolvedValue(undefined),
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    pdfMocks.workerOptions.workerSrc = "";
  });

  it("使用 pdf.js 画布渲染桌面端 PDF，而不是依赖 Electron 内置 iframe Viewer", async () => {
    await act(async () => {
      root.render(
        <AttachmentPdfPreview
          url="http://127.0.0.1:3001/api/attachments/test-id?sig=signed#page=2"
          filename="测试.pdf"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/api/attachments/test-id?sig=signed&inline=1#page=2",
    );
    expect(pdfMocks.getDocument).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.any(Uint8Array),
      isEvalSupported: false,
      useSystemFonts: true,
    }));
    expect(pdfMocks.render).toHaveBeenCalledOnce();
    expect(host.querySelector("canvas")?.style.height).toBe("");
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).toContain("1 / 2");
  });

  it("PDF 解析失败时立即释放 loading task", async () => {
    pdfMocks.getDocument.mockImplementation(() => ({
      promise: Promise.reject(new Error("invalid pdf")),
      destroy: pdfMocks.loadingDestroy,
    }));

    await act(async () => {
      root.render(<AttachmentPdfPreview url="/api/attachments/test-id" filename="损坏.pdf" />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pdfMocks.loadingDestroy).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("PDF 预览加载失败");
  });

  it("PDF 页面渲染失败时立即释放已加载文档", async () => {
    pdfMocks.render.mockImplementation(() => ({
      promise: Promise.reject(new Error("render failed")),
      cancel: vi.fn(),
    }));

    await act(async () => {
      root.render(<AttachmentPdfPreview url="/api/attachments/test-id" filename="异常.pdf" />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pdfMocks.documentDestroy).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("PDF 页面渲染失败");
  });
});
