/**
 * KaTeX 渲染工具：懒加载 + 错误兜底 + CSS 按需注入。
 *
 * 为什么独立成一个 lib 文件？
 *   - 编辑器内的 `MathView`、分享页 MD 路径（react-markdown 拦截）、分享页 PM
 *     路径（dangerouslySetInnerHTML 异步注入），三处都要渲染 LaTeX，行为
 *     （懒加载、CSS 注入、错误兜底）必须一致。
 *   - katex 主包约 270KB（含 CSS），字体文件按需懒拉，必须保证只在确实需要
 *     渲染公式时才动态 import，避免拖慢首屏。
 *
 * 关键设计：
 *   - 单例懒加载：第一次调用时 `import("katex")` 拉模块，同时把 `katex.min.css`
 *     注入到 `<head>` 一次（不重复注入）。
 *   - 渲染走 `renderToString`：直接返回 HTML 字符串，调用方自行决定挂哪。
 *   - 错误以 `{ html, error }` 形式返回；strict: 'ignore' 让一些非致命的语法
 *     问题（如不识别的命令）以红色错误样式显示，而不是直接 throw。
 *   - SSR 安全：所有 DOM 操作都先检查 `typeof document`。
 */

type KatexModule = typeof import("katex").default;

let katexPromise: Promise<KatexModule> | null = null;
let cssInjected = false;

/** 把 katex 自带的 CSS 注入到文档 <head>（只注入一次） */
async function ensureCss(): Promise<void> {
  if (cssInjected || typeof document === "undefined") return;
  cssInjected = true;
  try {
    // Vite 支持以 `?inline` 后缀拿到 CSS 字符串，但为了通用性这里走 import 副作用，
    // 让打包器把 css 抽出来注入页面（dev/build 行为一致）。
    await import("katex/dist/katex.min.css");
  } catch (e) {
    // 即便 CSS 注入失败也不阻塞渲染，只是字体/排版会退化为浏览器默认。
    if (typeof console !== "undefined") {
      console.warn("[katex] failed to inject css:", e);
    }
    cssInjected = false; // 允许下次重试
  }
}

/**
 * 懒加载 katex 模块。多次调用复用同一 Promise。
 * 首次失败会清掉 promise 以允许重试。
 */
async function loadKatex(): Promise<KatexModule> {
  if (!katexPromise) {
    katexPromise = (async () => {
      try {
        const [mod] = await Promise.all([
          import("katex"),
          ensureCss(),
        ]);
        return mod.default;
      } catch (e) {
        katexPromise = null;
        throw e;
      }
    })();
  }
  return katexPromise;
}

export interface KatexRenderResult {
  /** 渲染成功的 HTML 字符串；失败时为空 */
  html: string;
  /** 失败的人类可读消息；成功时为空 */
  error: string;
}

/**
 * 把一段 LaTeX 源码渲染为 KaTeX HTML 字符串。
 *
 * - `displayMode=true` 渲染为块级（居中、大尺寸），对应 `$$...$$`
 * - `displayMode=false` 渲染为行内，对应 `$...$`
 * - `throwOnError: false` + 自定义 errorColor：让 KaTeX 在语法错时返回带红色
 *   错误标记的 HTML，调用方能直观看到哪里写错了，而不需要自己再加错误条。
 *   但我们仍然在异常路径里返回 error，给调用方加一条"完整错误信息"的浮层。
 */
export async function renderKatex(
  source: string,
  opts: { displayMode?: boolean } = {}
): Promise<KatexRenderResult> {
  const code = (source || "").trim();
  if (!code) return { html: "", error: "" };
  try {
    const katex = await loadKatex();
    const html = katex.renderToString(code, {
      displayMode: !!opts.displayMode,
      throwOnError: false,
      // 'ignore' = 不阻塞渲染，让能渲染的部分照样出来
      strict: "ignore",
      output: "html",
      errorColor: "#dc2626",
      // 安全：trust:false（默认）禁止 \href / \includegraphics 等可能注入 URL 的命令
      trust: false,
    });
    return { html, error: "" };
  } catch (e: any) {
    const msg =
      (e && (e.message || e.toString?.())) || "KaTeX 渲染失败";
    return { html: "", error: String(msg) };
  }
}

/** 同步版本：仅当 katex 已加载完成时才能调用，否则返回空 + error */
export function renderKatexSync(
  source: string,
  opts: { displayMode?: boolean } = {}
): KatexRenderResult {
  const code = (source || "").trim();
  if (!code) return { html: "", error: "" };
  // 这个 sync 版用于"已知 katex 已加载"的紧凑路径（例如同一组件里前后两次渲染）。
  // 通过 require 同步取已加载模块：webpack/vite 在 import() 缓存命中后这一行不会
  // 再去网络拉东西。但若从未异步加载过，仍要走 async 路径——这里直接退化报错。
  try {
    // 这一段假设外部已经至少 await 过一次 loadKatex，否则只能走 async 入口
    const m = (window as any).__nowen_katex__;
    if (!m) return { html: "", error: "katex 未就绪" };
    const html = m.renderToString(code, {
      displayMode: !!opts.displayMode,
      throwOnError: false,
      strict: "ignore",
      output: "html",
      errorColor: "#dc2626",
      trust: false,
    });
    return { html, error: "" };
  } catch (e: any) {
    const msg = (e && (e.message || e.toString?.())) || "KaTeX 渲染失败";
    return { html: "", error: String(msg) };
  }
}

/**
 * 预热 katex（可选）。在确认页面里有数学公式时调用，能让首次渲染更快。
 * 同时把模块缓存到 window 供同步版本使用。
 */
export async function preloadKatex(): Promise<void> {
  try {
    const m = await loadKatex();
    if (typeof window !== "undefined") {
      (window as any).__nowen_katex__ = m;
    }
  } catch {
    // 预热失败静默，不影响后续按需加载
  }
}
