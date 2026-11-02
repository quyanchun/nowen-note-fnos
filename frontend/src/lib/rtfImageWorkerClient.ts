// rtfImageWorkerClient.ts — 主线程侧的 Web Worker 客户端封装。
//
// 目标：给调用方一个简单的 `extractRtfImagesAsync(rtf)` Promise API，
// 内部负责：
//   1. 懒创建 Worker（Vite 推荐用 new URL + import.meta.url）
//   2. 用递增的 requestId 多路复用同一个 Worker
//   3. Worker 抛错 / 不支持时自动降级成主线程同步实现
//
// Worker 失败的常见原因：
//   - 浏览器 CSP 禁止 Worker（企业内网常见）
//   - 某些打包环境（例如早期 electron-builder）生成不了正确的 import.meta.url
//   - 旧 Android WebView 不支持 module Worker
// 出现这些情况时，我们依然保持功能正确（只是卡顿）。

import { extractImagesFromRtfSync } from "./rtfImageFallback";

type WorkerInMessage =
  | { type: "result"; id: number; images: string[] }
  | { type: "error"; id: number; message: string };

let workerInstance: Worker | null = null;
let workerBroken = false;
let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (imgs: string[]) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (workerInstance) return workerInstance;
  try {
    // Vite/webpack 都识别这个特殊写法，会把 worker 文件作为独立 chunk 产出。
    workerInstance = new Worker(
      new URL("../workers/rtfImage.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerInstance.onmessage = (e: MessageEvent<WorkerInMessage>) => {
      const msg = e.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.type === "result") entry.resolve(msg.images);
      else entry.reject(new Error(msg.message));
    };
    workerInstance.onerror = (err) => {
      // 整个 worker 挂了：把所有 pending 置失败，并禁用 worker 后续调用。
      console.warn("[rtfImageWorkerClient] worker error, falling back:", err);
      workerBroken = true;
      for (const [, entry] of pending) {
        entry.reject(new Error("RTF worker crashed"));
      }
      pending.clear();
      try {
        workerInstance?.terminate();
      } catch {
        /* ignore */
      }
      workerInstance = null;
    };
    return workerInstance;
  } catch (err) {
    console.warn("[rtfImageWorkerClient] worker unavailable, falling back:", err);
    workerBroken = true;
    return null;
  }
}

/**
 * 异步版本：在 Web Worker 里解码 RTF 图片。
 * 返回 data URL 字符串数组；顺序与 RTF 内 \pngblip / \jpegblip 出现顺序一致。
 *
 * 如果当前环境不支持 Worker（或 Worker 启动失败），会自动降级到主线程同步
 * 实现，此时**调用线程仍会被阻塞**——但至少保证功能可用。
 */
export async function extractRtfImagesAsync(rtf: string): Promise<string[]> {
  const worker = getWorker();
  if (!worker) {
    return extractImagesFromRtfSync(rtf);
  }
  const id = nextRequestId++;
  return new Promise<string[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      worker.postMessage({ type: "extract", id, rtf });
    } catch (err) {
      pending.delete(id);
      // postMessage 本身失败（例如超大字符串克隆异常），直接降级
      console.warn(
        "[rtfImageWorkerClient] postMessage failed, falling back:",
        err
      );
      resolve(extractImagesFromRtfSync(rtf));
    }
  });
}
