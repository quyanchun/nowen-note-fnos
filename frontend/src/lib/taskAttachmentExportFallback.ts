import { toast } from "@/lib/toast";

const INSTALL_MARKER = "__nowenTaskAttachmentExportFallbackInstalled";
const TASK_ATTACHMENT_PATH_RE = /^\/api\/task-attachments\/([A-Za-z0-9_-]+)$/;

// Static PNG rather than SVG: task attachment downloads force high-risk SVG MIME types to
// Content-Disposition: attachment, which would make an imported placeholder fail to render in <img>.
const MISSING_TASK_IMAGE_PNG_BASE64 = "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";

let pendingMissingCount = 0;
let warningTimer: number | null = null;

function decodeBase64(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function matchTaskAttachment(url: string): { id: string } | null {
  try {
    const parsed = new URL(url, window.location.href);
    const match = parsed.pathname.match(TASK_ATTACHMENT_PATH_RE);
    return match ? { id: match[1] } : null;
  } catch {
    return null;
  }
}

function scheduleMissingWarning(): void {
  pendingMissingCount += 1;
  if (warningTimer !== null) return;

  warningTimer = window.setTimeout(() => {
    const count = pendingMissingCount;
    pendingMissingCount = 0;
    warningTimer = null;
    toast.warning(
      `检测到 ${count} 张历史任务图片已失效，完整备份已使用“图片已丢失”占位图继续生成。`,
      6000,
    );
  }, 120);
}

/**
 * 待办完整备份会通过 fetch 读取 `/api/task-attachments/:id`。
 * 历史数据中可能存在“任务 Markdown 引用仍在，但附件行或物理文件已被删除”的坏引用。
 *
 * 仅对明确的 404 / 410 做降级：返回一张可见的 PNG 占位图，使整包导出继续完成，
 * 并在重新导入后把旧 404 地址替换成目标实例的新附件地址。
 * 401 / 403 / 5xx / 网络错误仍原样抛出，避免把权限或临时故障误判为永久丢失。
 *
 * 当前仓库中 JS fetch 读取 task-attachments 仅用于待办完整备份；普通任务图片渲染由
 * `<img src>` 发起，不经过此拦截器。
 */
export function installTaskAttachmentExportFallback(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;

  const target = window as unknown as Record<string, unknown>;
  if (target[INSTALL_MARKER]) return;
  target[INSTALL_MARKER] = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = getRequestMethod(input, init);
    const matched = method === "GET" ? matchTaskAttachment(getRequestUrl(input)) : null;
    const response = await originalFetch(input, init);

    if (!matched || (response.status !== 404 && response.status !== 410)) return response;

    console.warn(
      `[task-backup] attachment ${matched.id} returned HTTP ${response.status}; using a visible placeholder`,
    );
    scheduleMissingWarning();

    return new Response(decodeBase64(MISSING_TASK_IMAGE_PNG_BASE64), {
      status: 200,
      statusText: "Missing task attachment replaced for backup",
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Nowen-Task-Attachment-Placeholder": "missing",
        "X-Nowen-Original-Status": String(response.status),
      },
    });
  };
}
