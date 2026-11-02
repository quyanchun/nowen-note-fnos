// rtfImageFallback.ts — 主线程同步 fallback。
//
// Worker 不可用时使用；逻辑必须与 rtfImage.worker.ts 里的 extractImagesFromRtf
// 保持一致。保留一份独立实现避免 worker 文件和主线程互相依赖 import 循环。

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
  return btoa(binary);
}

export function extractImagesFromRtfSync(rtf: string): string[] {
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
