import DOMPurify from "dompurify";
import { Marked, Renderer } from "marked";
import { isProtectedNotePayload } from "./encryptedNotes/blockDocument";
import { projectMarkdownForUser } from "./markdownUserContent";
import type { Note } from "@/types";

const markdown = new Marked({ gfm: true, renderer: {
  html: () => "",
  image: () => "",
  table(token) { return "<div>" + Renderer.prototype.table.call(this, token) + "</div>"; },
  checkbox({ checked }) { return checked ? "☑ " : "☐ "; },
  link(token) { return this.parser.parseInline(token.tokens); },
} });
const allowedTags = ["p", "br", "strong", "em", "del", "blockquote", "ul", "ol", "li", "pre", "code", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6", "div", "table", "thead", "tbody", "tr", "th", "td"];
export function quickPanelMarkdown(text: string): string {
  return DOMPurify.sanitize(markdown.parse(text, { async: false }), {
    ALLOWED_TAGS: allowedTags, ALLOWED_ATTR: ["start"], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  });
}
export async function quickPanelNote(note: Note) {
  if (isProtectedNotePayload(note)) return { title: note.title, html: "", notice: "这篇笔记含有加密内容，请在 App 中查看。" };
  let text: string;
  if (note.contentFormat === "markdown") text = projectMarkdownForUser(note.content || note.contentText || "");
  else {
    const { normalizeToMarkdown } = await import("./contentFormat");
    text = normalizeToMarkdown(note.content, note.contentText) || note.contentText || "";
  }
  const limit = 60000;
  const html = quickPanelMarkdown(text.slice(0, limit));
  const notice = text.length > limit ? "已预览前 6 万字，可在 App 中阅读全文。" : !html.replace(/<[^>]+>/g, "").trim() ? "暂无可预览的文字" : "";
  return { title: note.title, html, notice };
}
