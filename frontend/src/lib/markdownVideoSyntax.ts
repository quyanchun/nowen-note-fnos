import { toInlineAttachmentUrl } from "@/lib/mediaUploadService";

export interface MarkdownVideoToken {
  src: string;
  title?: string;
}

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "ogv", "m4v", "mov"]);
const FORBIDDEN_PROTOCOLS = /^(?:javascript|data|vbscript|file|blob):/i;

function getPathExtension(pathname: string): string {
  const idx = pathname.lastIndexOf(".");
  if (idx < 0) return "";
  return pathname.slice(idx + 1).toLowerCase();
}

function unescapeMarkdownTitle(title: string): string {
  return title.replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

function escapeMarkdownAlt(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\n/g, " ");
}

function filenameFromUrl(url: string): string {
  try {
    const parsed = url.startsWith("/")
      ? new URL(url, "http://nowen.local")
      : new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "video";
  } catch {
    return "video";
  }
}

export function isSafeVideoPreviewUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || FORBIDDEN_PROTOCOLS.test(trimmed)) return false;

  if (trimmed.startsWith("/api/attachments/")) return true;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return VIDEO_EXTENSIONS.has(getPathExtension(parsed.pathname));
}

export function parseMarkdownVideoLine(line: string): MarkdownVideoToken | null {
  const match = line.match(/^\s*@\[video\]\(\s*(\S+?)(?:\s+"((?:\\.|[^"\\])*)")?\s*\)\s*$/);
  if (!match) return null;

  const src = match[1];
  if (!isSafeVideoPreviewUrl(src)) return null;

  const title = match[2] ? unescapeMarkdownTitle(match[2]) : undefined;
  return {
    src: toInlineAttachmentUrl(src),
    title,
  };
}

function isFenceLine(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

export function preprocessMarkdownVideos(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;

  return lines
    .map((line) => {
      if (isFenceLine(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;

      const token = parseMarkdownVideoLine(line);
      if (!token) return line;

      const title = token.title || filenameFromUrl(token.src);
      return `![nowen-video:${escapeMarkdownAlt(title)}](${token.src})`;
    })
    .join("\n");
}
