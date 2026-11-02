const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
  mov: "video/quicktime",
  qt: "video/quicktime",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

export function inferVideoMime(filename: string): string | null {
  const normalized = String(filename || "").trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  if (dot < 0 || dot === normalized.length - 1) return null;
  return VIDEO_MIME_BY_EXTENSION[normalized.slice(dot + 1)] || null;
}
