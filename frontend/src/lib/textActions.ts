export type TextAction =
  | { type: "phone"; value: string; href: string }
  | { type: "url"; value: string; href: string };

const PHONE_RE = /(?:^|[^\d])(1[3-9]\d{9})(?!\d)/;
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"'`，。！？；：（）【】]+)/i;
const TOKEN_BOUNDARY_RE = /[\s<>"'`，。！？；：（）【】\[\]{}]/;

export function isMobileRuntime(): boolean {
  if (typeof document !== "undefined") {
    const native = document.documentElement.getAttribute("data-native");
    if (native === "android" || native === "ios" || native === "harmony") return true;
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    if (window.matchMedia("(pointer: coarse)").matches) return true;
  }
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent);
}

export function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

export function findTextAction(text: string, mobile = isMobileRuntime()): TextAction | null {
  const source = text.trim();
  if (!source) return null;

  if (mobile) {
    const phone = source.match(PHONE_RE)?.[1];
    if (phone) return { type: "phone", value: phone, href: `tel:${phone}` };
  }

  const url = source.match(URL_RE)?.[1]?.replace(/[.,!?;:，。！？；：）】]+$/, "");
  if (url) return { type: "url", value: url, href: normalizeUrl(url) };

  return null;
}

export function getTokenAtOffset(text: string, offset: number): string {
  if (!text) return "";
  const index = Math.max(0, Math.min(offset, text.length - 1));
  if (TOKEN_BOUNDARY_RE.test(text[index])) return "";

  let start = index;
  while (start > 0 && !TOKEN_BOUNDARY_RE.test(text[start - 1])) start -= 1;

  let end = index + 1;
  while (end < text.length && !TOKEN_BOUNDARY_RE.test(text[end])) end += 1;

  return text.slice(start, end).replace(/[.,!?;:，。！？；：）】]+$/, "");
}
