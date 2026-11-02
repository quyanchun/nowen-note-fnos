const IMAGE_ICON_MIME_SOURCE = String.raw`(?:svg\+xml|png|jpeg|gif|webp|bmp|x-icon|vnd\.microsoft\.icon|avif)`;
const IMAGE_ICON_DATA_URL_SOURCE = String.raw`data:image\/${IMAGE_ICON_MIME_SOURCE};base64,[A-Za-z0-9+/]+={0,2}`;
const IMAGE_ICON_DATA_URL_RE = new RegExp(`^${IMAGE_ICON_DATA_URL_SOURCE}$`, "i");
const IMAGE_ICON_DATA_URL_GLOBAL_RE = new RegExp(IMAGE_ICON_DATA_URL_SOURCE, "gi");

export type IconTextPart = {
  type: "text" | "image";
  value: string;
};

export function isImageIcon(value: unknown): value is string {
  return typeof value === "string" && IMAGE_ICON_DATA_URL_RE.test(value.trim());
}

export function splitImageIconText(value: string): IconTextPart[] {
  if (!value || !value.includes("data:image/")) return [{ type: "text", value }];

  const parts: IconTextPart[] = [];
  let cursor = 0;
  IMAGE_ICON_DATA_URL_GLOBAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMAGE_ICON_DATA_URL_GLOBAL_RE.exec(value)) !== null) {
    if (match.index > cursor) parts.push({ type: "text", value: value.slice(cursor, match.index) });
    parts.push({ type: "image", value: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) parts.push({ type: "text", value: value.slice(cursor) });
  return parts.length > 0 ? parts : [{ type: "text", value }];
}
