/**
 * 图床直链格式化工具
 * ---------------------------------------------------------------------------
 * 把附件 URL 和文件名格式化为不同生态常用的引用片段。
 * 纯函数，便于在 FileManager / DetailDrawer / 编辑器右键菜单 等多处复用。
 *
 * 设计要点：
 *   - filename 里可能包含 `] [ ( ) " ' & < >` 等特殊字符，必须做最小转义，
 *     否则贴进 Markdown / HTML 会破坏语法或引发 XSS（虽然只是自己引用自己的内容，
 *     但 HTML 走外部网站时仍可能触发渲染异常）。
 *   - URL 里不应再做 encode：调用方传进来的就是浏览器真实可访问的完整 URL。
 *   - 不做 i18n：这些是开发者面向的代码片段。
 */

export type ImageHostFormat = "url" | "markdown" | "html";

/** Markdown alt 文本里 `[ ]` 会破坏语法，做最小替换。 */
function escapeMdAlt(s: string): string {
  return s.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

/** HTML 属性里需要转义 `& " < >`。 */
function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 把附件信息格式化为指定类型的代码片段。 */
export function formatImageHostSnippet(
  format: ImageHostFormat,
  url: string,
  filename: string,
): string {
  const safeFilename = (filename || "image").trim() || "image";
  switch (format) {
    case "url":
      return url;
    case "markdown":
      return `![${escapeMdAlt(safeFilename)}](${url})`;
    case "html":
      return `<img src="${escapeHtmlAttr(url)}" alt="${escapeHtmlAttr(safeFilename)}" />`;
    default:
      return url;
  }
}

/** 给 UI 提示用的简短标签。 */
export function imageHostFormatLabel(f: ImageHostFormat): string {
  return f === "url" ? "URL" : f === "markdown" ? "Markdown" : "HTML";
}
