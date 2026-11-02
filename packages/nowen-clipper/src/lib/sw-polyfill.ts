/**
 * Service Worker DOM polyfill。
 *
 * MV3 的 background 运行在 Service Worker 中，没有 `window` 和 `document`。
 * 但某些库（如 turndown）在模块初始化时会检查 `window.DOMParser` 或
 * `document.implementation.createHTMLDocument`，导致运行时报错。
 *
 * 这个文件必须在所有其他 import 之前被导入（利用 ESM 的顺序求值机制），
 * 确保在 turndown 等库加载时全局对象已经就绪。
 *
 * polyfill 策略：
 *   - 使用 @mixmark-io/domino（纯 JS DOM 实现）来提供完整的 document 和
 *     DOMImplementation，不依赖浏览器原生的 DOMParser（因为某些浏览器的
 *     Service Worker 不支持 DOMParser，如 Edge）。
 *   - 把 `self`（Service Worker 全局对象）赋给 `globalThis.window`。
 *   - 在 window 上挂载 domino 实现的 DOMParser（如果原生不存在）。
 */

import domino from "@mixmark-io/domino";

if (typeof window === "undefined" && typeof self !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;

  // 1. 让 `window` 指向 `self`（Service Worker global scope）
  g.window = self;

  // 2. 用 domino 创建一个完整的 document 实现
  if (typeof document === "undefined") {
    g.document = domino.createDocument("");
  }

  // 3. 如果 Service Worker 没有原生 DOMParser，用 domino 提供一个
  if (typeof DOMParser === "undefined") {
    g.DOMParser = class DominoDOMParser {
      parseFromString(markup: string, type: string): Document {
        if (type === "text/html" || type === "text/xml" || type === "application/xml") {
          return domino.createDocument(markup) as unknown as Document;
        }
        return domino.createDocument(markup) as unknown as Document;
      }
    };
    // 确保 self（= window）上也能找到 DOMParser
    (self as any).DOMParser = g.DOMParser;
  }
}
