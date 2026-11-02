import { api } from "./api";

const SUPPORTED_EXPORT_NAME = /\.(?:md|markdown|zip|pdf|docx)$/i;
const LEGACY_TOKEN_PREFIX = "legacy-export-";
const OBJECT_URL_CLEANUP_DELAY_MS = 60_000;
const legacyDownloads = new Map<string, { blob: Blob; filename: string }>();
const bypassAnchors = new WeakSet<HTMLAnchorElement>();
let installed = false;

function randomToken(): string {
  try {
    return `${LEGACY_TOKEN_PREFIX}${crypto.randomUUID()}`;
  } catch {
    return `${LEGACY_TOKEN_PREFIX}${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof Request) return new URL(input.url, window.location.href);
    return new URL(String(input), window.location.href);
  } catch {
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function decodeExportFilename(headers: Headers): string {
  const encoded = headers.get("X-Export-Filename") || "export.bin";
  try {
    return decodeURIComponent(encoded);
  } catch {
    return "export.bin";
  }
}

export function extractLegacyDownloadToken(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    const match = url.pathname.match(/\/export\/download\/([^/]+)$/);
    if (!match) return null;
    const token = decodeURIComponent(match[1]);
    return token.startsWith(LEGACY_TOKEN_PREFIX) ? token : null;
  } catch {
    return null;
  }
}

export function isReliableExportFilename(filename: string): boolean {
  return SUPPORTED_EXPORT_NAME.test(String(filename || "").trim());
}

export function scheduleObjectUrlRevocation(
  url: string,
  delayMs = OBJECT_URL_CLEANUP_DELAY_MS,
): void {
  window.setTimeout(() => URL.revokeObjectURL(url), delayMs);
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  bypassAnchors.add(anchor);
  anchor.href = url;
  anchor.download = filename || "export.bin";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  scheduleObjectUrlRevocation(url);
}

async function handleBlobAnchor(anchor: HTMLAnchorElement, nativeFetch: typeof window.fetch): Promise<void> {
  let blob: Blob | null = null;
  try {
    const response = await nativeFetch(anchor.href);
    blob = await response.blob();
    const filename = anchor.download || "export.bin";
    // PR #235 的旧路由只允许 PDF/DOCX MIME。对 Markdown/ZIP 使用兼容传输 MIME，
    // 新后端会按文件扩展名恢复真实 Content-Type；旧后端则由 fetch 包装器回退 Blob。
    const transportBlob = /\.(?:md|markdown|zip)$/i.test(filename)
      ? new Blob([blob], { type: "application/pdf" })
      : blob;
    const staged = await api.stageGeneratedExport(transportBlob, filename);
    api.downloadMarkdownExport(staged.downloadToken, staged.filename);
  } catch (error) {
    console.warn("[reliable-export] HTTP staging unavailable; falling back to Blob download", error);
    if (blob) triggerBlobDownload(blob, anchor.download || "export.bin");
    else {
      bypassAnchors.add(anchor);
      anchor.click();
    }
  }
}

export function installReliableExportDownloadBridge(): void {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await nativeFetch(input, init);
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const isStageRequest = method === "POST" && url?.pathname.endsWith("/export/download-jobs");
    const body = init?.body;

    if (isStageRequest && body instanceof Blob && [404, 405, 501].includes(response.status)) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      const filename = decodeExportFilename(headers);
      const token = randomToken();
      legacyDownloads.set(token, { blob: body, filename });
      console.warn("[reliable-export] old NAS backend detected; using local Blob fallback");
      return new Response(JSON.stringify({
        downloadToken: token,
        filename,
        size: body.size,
        legacyFallback: true,
      }), {
        status: 201,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    return response;
  }) as typeof window.fetch;

  document.addEventListener("click", (event) => {
    const target = event.target;
    const anchor = target instanceof Element ? target.closest("a") : null;
    if (!(anchor instanceof HTMLAnchorElement) || bypassAnchors.has(anchor)) return;

    const legacyToken = extractLegacyDownloadToken(anchor.href);
    if (legacyToken) {
      const pending = legacyDownloads.get(legacyToken);
      if (!pending) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      legacyDownloads.delete(legacyToken);
      triggerBlobDownload(pending.blob, pending.filename);
      return;
    }

    if (!anchor.href.startsWith("blob:") || !isReliableExportFilename(anchor.download)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void handleBlobAnchor(anchor, nativeFetch);
  }, true);
}

export const reliableExportDownloadBridgeTestUtils = {
  legacyDownloads,
};
