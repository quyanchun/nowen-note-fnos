import type { Note } from "@/types";
import type { AndroidSharePayload } from "@/lib/androidShareImport";

export interface SharedUploadedAttachment {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  category: "image" | "file";
}

export interface SharedNotePatch {
  content: string;
  contentText: string;
  contentFormat: "markdown" | "html" | "tiptap-json";
}

function compactText(value: string | null | undefined): string {
  return String(value || "").replace(/\u0000/g, "").trim();
}

function withoutDuplicatedUrl(text: string, url: string): string {
  if (!url) return text;
  return text.replace(url, "").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\\[\]])/g, "\\$1");
}

function escapeMarkdownText(value: string): string {
  // Shared text is untrusted. Neutralize raw HTML before it reaches Markdown renderers;
  // ordinary Markdown syntax remains available and attachment URLs are built separately.
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripExtension(filename: string): string {
  const normalized = compactText(filename);
  const dot = normalized.lastIndexOf(".");
  return dot > 0 ? normalized.slice(0, dot) : normalized;
}

function truncateTitle(value: string): string {
  const title = compactText(value).replace(/\s+/g, " ");
  return (title || "来自 Android 的分享").slice(0, 120);
}

function resolveNoteFormat(
  note: Pick<Note, "content" | "contentFormat">,
): "markdown" | "html" | "tiptap-json" {
  if (note.contentFormat === "html" || note.contentFormat === "tiptap-json" || note.contentFormat === "markdown") {
    return note.contentFormat;
  }

  // Older rows may not have contentFormat populated. Detect only strong signatures so a
  // Markdown document beginning with ordinary braces or angle brackets is not reclassified.
  const trimmed = String(note.content || "")
    .replace(/^[\s\uFEFF\u200B\u200C\u200D]+|[\s\uFEFF\u200B\u200C\u200D]+$/g, "");
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
        && (parsed.type === "doc" || (typeof parsed.type === "string" && Array.isArray(parsed.content)))) {
        return "tiptap-json";
      }
    } catch {
      // Invalid JSON is ordinary Markdown here; the existing content is never replaced.
    }
  }

  const withoutLeadingComments = trimmed.replace(/^(\s*<!--[\s\S]*?-->\s*)+/, "");
  const lower = withoutLeadingComments.slice(0, 20).toLowerCase();
  if (lower.startsWith("<!doctype") || lower.startsWith("<html")) return "html";
  if (trimmed.startsWith("<")
    && /^<[A-Za-z][A-Za-z0-9-]*(\s|\/|>)/.test(trimmed)
    && /<[A-Za-z][^<>]*>|<\/[A-Za-z][^<>]*>/.test(trimmed)) {
    return "html";
  }
  return "markdown";
}

export function buildAndroidShareNoteTitle(payload: AndroidSharePayload): string {
  if (compactText(payload.subject)) return truncateTitle(payload.subject);

  const firstLine = compactText(payload.text).split(/\r?\n/).find((line) => line.trim());
  if (firstLine && !/^https?:\/\//i.test(firstLine.trim())) return truncateTitle(firstLine);

  const firstReady = payload.items.find((item) => item.status === "ready");
  if (firstReady?.name) return truncateTitle(stripExtension(firstReady.name));

  if (payload.url) {
    try {
      const parsed = new URL(payload.url);
      return truncateTitle(parsed.hostname.replace(/^www\./i, ""));
    } catch {
      return truncateTitle(payload.url);
    }
  }
  return "来自 Android 的分享";
}

function sharedTextParts(payload: AndroidSharePayload): string[] {
  const subject = compactText(payload.subject);
  const url = compactText(payload.url);
  const text = withoutDuplicatedUrl(compactText(payload.text), url);
  const parts: string[] = [];
  if (subject) parts.push(subject);
  if (text && text !== subject) parts.push(text);
  if (url) parts.push(url);
  return parts;
}

function attachmentPlainText(attachment: SharedUploadedAttachment): string {
  return attachment.category === "image"
    ? `[图片] ${attachment.filename}`
    : `[附件] ${attachment.filename}`;
}

function buildMarkdownBlock(
  payload: AndroidSharePayload,
  attachments: SharedUploadedAttachment[],
): string {
  const lines = sharedTextParts(payload).map((part) => escapeMarkdownText(part));
  for (const attachment of attachments) {
    const label = escapeMarkdownLabel(attachment.filename || "附件");
    lines.push(
      attachment.category === "image"
        ? `![${label}](${attachment.url})`
        : `[📎 ${label}](${attachment.url})`,
    );
  }
  return lines.join("\n\n").trim();
}

function buildHtmlBlock(
  payload: AndroidSharePayload,
  attachments: SharedUploadedAttachment[],
): string {
  const blocks: string[] = [];
  for (const part of sharedTextParts(payload)) {
    if (/^https?:\/\//i.test(part)) {
      blocks.push(`<p><a href="${escapeHtml(part)}">${escapeHtml(part)}</a></p>`);
    } else {
      blocks.push(`<p>${escapeHtml(part).replace(/\r?\n/g, "<br>")}</p>`);
    }
  }
  for (const attachment of attachments) {
    const url = escapeHtml(attachment.url);
    const filename = escapeHtml(attachment.filename || "附件");
    blocks.push(
      attachment.category === "image"
        ? `<p><img src="${url}" alt="${filename}"></p>`
        : `<p><a href="${url}" download="${filename}">📎 ${filename}</a></p>`,
    );
  }
  return blocks.join("\n");
}

function textNode(text: string, marks?: Array<Record<string, unknown>>): Record<string, unknown> {
  return marks?.length ? { type: "text", text, marks } : { type: "text", text };
}

function paragraphNode(content: Array<Record<string, unknown>>): Record<string, unknown> {
  return { type: "paragraph", content };
}

function buildTiptapNodes(
  payload: AndroidSharePayload,
  attachments: SharedUploadedAttachment[],
): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  for (const part of sharedTextParts(payload)) {
    if (/^https?:\/\//i.test(part)) {
      nodes.push(paragraphNode([
        textNode(part, [{ type: "link", attrs: { href: part, target: "_blank", rel: "noopener noreferrer" } }]),
      ]));
    } else {
      const lines = part.split(/\r?\n/);
      lines.forEach((line) => nodes.push(paragraphNode(line ? [textNode(line)] : [])));
    }
  }
  for (const attachment of attachments) {
    if (attachment.category === "image") {
      nodes.push({
        type: "image",
        attrs: {
          src: attachment.url,
          alt: attachment.filename || "图片",
          title: attachment.filename || null,
        },
      });
    } else {
      nodes.push(paragraphNode([
        textNode(`📎 ${attachment.filename || "附件"}`, [
          {
            type: "link",
            attrs: {
              href: attachment.url,
              target: "_blank",
              rel: "noopener noreferrer",
            },
          },
        ]),
      ]));
    }
  }
  return nodes;
}

function appendSeparated(current: string, block: string, separator: string): string {
  const existing = current.trimEnd();
  if (!block) return existing;
  return existing ? `${existing}${separator}${block}` : block;
}

/**
 * Append Android share text/files without changing the note's existing editor format.
 * Attachment URLs remain relative so Electron/Capacitor can resolve the active server at render time.
 */
export function appendAndroidShareToNote(
  note: Pick<Note, "content" | "contentText" | "contentFormat">,
  payload: AndroidSharePayload,
  attachments: SharedUploadedAttachment[],
): SharedNotePatch {
  const format = resolveNoteFormat(note);
  const plainBlock = [
    ...sharedTextParts(payload),
    ...attachments.map(attachmentPlainText),
  ].join("\n\n").trim();

  if (format === "html") {
    return {
      content: appendSeparated(note.content || "", buildHtmlBlock(payload, attachments), "\n"),
      contentText: appendSeparated(note.contentText || "", plainBlock, "\n\n"),
      contentFormat: "html",
    };
  }

  if (format === "tiptap-json") {
    let document: { type?: string; content?: Array<Record<string, unknown>> };
    try {
      document = note.content ? JSON.parse(note.content) : { type: "doc", content: [] };
    } catch {
      throw new Error("目标笔记的富文本数据无法解析，为避免覆盖原内容已停止导入");
    }
    if (!document || document.type !== "doc" || (document.content !== undefined && !Array.isArray(document.content))) {
      throw new Error("目标笔记的富文本结构无效，为避免覆盖原内容已停止导入");
    }
    const nodes = buildTiptapNodes(payload, attachments);
    document.content = [...(document.content || []), ...nodes];
    return {
      content: JSON.stringify(document),
      contentText: appendSeparated(note.contentText || "", plainBlock, "\n\n"),
      contentFormat: "tiptap-json",
    };
  }

  return {
    content: appendSeparated(note.content || "", buildMarkdownBlock(payload, attachments), "\n\n"),
    contentText: appendSeparated(note.contentText || "", plainBlock, "\n\n"),
    contentFormat: "markdown",
  };
}
