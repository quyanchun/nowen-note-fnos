/// <reference lib="webworker" />
//
// rtfImage.worker.ts — 把 Word/WPS 粘贴 RTF 里的图片解码搬离主线程。
//
// ─ 为什么单独做成 Worker ───────────────────────────────────────
// Word 全选复制出的 text/rtf 动辄上百 MB（Base16 编码，体积 ×2），
// 在主线程做 hex→Uint8Array→base64 会连续阻塞几千毫秒，导致粘贴
// 瞬间整个编辑器/loading toast/菜单都不响应，用户体感就是"卡死"。
//
// 把这段纯计算放进 Worker 后：
//   - 主线程粘贴触发 → 立刻 postMessage 给 worker → 马上返回
//   - React 正常渲染 loading overlay & 动画
//   - worker 算完把 data URL 数组 postMessage 回来，主线程再做
//     parseSlice + replaceSelection（这步通常是毫秒级）
//
// 协议（字符串字面量保持稳定，避免主线程/worker 版本漂移）：
//   入站 req:  { type: "extract", id: number, rtf: string }
//   出站 resp: { type: "result",  id: number, images: string[] }
//   失败 resp: { type: "error",   id: number, message: string }
// ──────────────────────────────────────────────────────────────

// 与主线程 TiptapEditor.tsx 中的 hexToBase64 / extractImagesFromRtf
// 保持**行为一致**的实现——这两个函数 100% 纯计算、无 DOM 依赖，
// 完全可以在 Worker 里安全跑。
function hexToBase64(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const len = Math.floor(clean.length / 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK))
    );
  }
  // btoa 在 Worker 作用域里同样可用（WindowOrWorkerGlobalScope）
  return btoa(binary);
}

function extractImagesFromRtf(rtf: string): string[] {
  const result: string[] = [];
  if (!rtf || rtf.length === 0) return result;
  const re = /\\(pngblip|jpegblip)[^}]*?([0-9a-fA-F\s]{32,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rtf)) !== null) {
    const format = m[1] === "pngblip" ? "png" : "jpeg";
    const hex = m[2];
    try {
      const b64 = hexToBase64(hex);
      if (b64.length > 0) {
        result.push(`data:image/${format};base64,${b64}`);
      }
    } catch {
      /* 单张损坏不影响其他 */
    }
  }
  return result;
}

type ExtractRequest = { type: "extract"; id: number; rtf: string };
type WorkerRequest = ExtractRequest;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (!msg || msg.type !== "extract") return;
  const id = msg.id;
  try {
    const images = extractImagesFromRtf(msg.rtf);
    (self as unknown as Worker).postMessage({
      type: "result",
      id,
      images,
    });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "error",
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

// 让 TS 把此文件视为模块（避免全局作用域冲突）
export {};
