import React from "react";
import DOMPurify from "dompurify";

export function splitSearchTerms(query: string): string[] {
  return Array.from(new Set((query || "").match(/[\p{Script=Han}]+|[^\s\p{Script=Han}]+/gu) || []));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(text: string): string {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Wrap search terms in <mark> tags. */
export function highlightText(text: string, query: string): string {
  const terms = splitSearchTerms(query).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!text || terms.length === 0) return escapeHtml(text || "");

  const pattern = terms.map(escapeRegExp).join("|");
  const splitRe = new RegExp(`(${pattern})`, "gi");
  const matchRe = new RegExp(`^(${pattern})$`, "i");

  return text.split(splitRe).map((part) =>
    matchRe.test(part)
      ? `<mark class="search-result-highlight">${escapeHtml(part)}</mark>`
      : escapeHtml(part),
  ).join("");
}

export function stripSearchMarks(html: string): string {
  return DOMPurify.sanitize(html || "", { ALLOWED_TAGS: [] });
}

export function sanitizeSearchHtml(html: string): string {
  return DOMPurify.sanitize(html || "", {
    ALLOWED_TAGS: ["mark"],
    ALLOWED_ATTR: [],
  });
}

export function highlightTextNode(text: string, query: string): React.ReactNode {
  const terms = splitSearchTerms(query).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!text || terms.length === 0) return text || "";

  const pattern = terms.map(escapeRegExp).join("|");
  const splitRe = new RegExp(`(${pattern})`, "gi");
  const matchRe = new RegExp(`^(${pattern})$`, "i");

  return text.split(splitRe).map((part, index) =>
    matchRe.test(part)
      ? React.createElement("mark", { key: index, className: "search-result-highlight" }, part)
      : part,
  );
}
