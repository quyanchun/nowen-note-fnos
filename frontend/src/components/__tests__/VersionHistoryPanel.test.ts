import { describe, expect, it } from "vitest";
import type { NoteVersion } from "@/types";
import { versionContentFormatLabel, versionToPreviewMarkdown } from "../VersionHistoryPanel";

function version(overrides: Partial<NoteVersion>): NoteVersion {
  return {
    id: "v-1",
    noteId: "note-1",
    userId: "user-1",
    title: "Version",
    version: 1,
    changeType: "edit",
    changeSummary: null,
    createdAt: "2026-01-01 00:00:00",
    ...overrides,
  };
}

describe("VersionHistoryPanel preview", () => {
  it("uses markdown content instead of flattened contentText for markdown versions", () => {
    const preview = versionToPreviewMarkdown(
      version({
        content: "# 标题\n\n- 第一条",
        contentText: "标题 第一条",
        contentFormat: "markdown",
      }),
    );

    expect(preview).toBe("# 标题\n\n- 第一条");
  });

  it("converts tiptap json versions to readable markdown instead of showing json source", () => {
    const content = JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "标题" }] },
        { type: "paragraph", content: [{ type: "text", text: "正文" }] },
      ],
    });

    const preview = versionToPreviewMarkdown(
      version({
        content,
        contentText: "标题\n正文",
        contentFormat: "tiptap-json",
      }),
    );

    expect(preview).toContain("标题");
    expect(preview).toContain("正文");
    expect(preview).not.toContain('"type":"doc"');
  });

  it("falls back to contentText when old tiptap json cannot be converted", () => {
    const preview = versionToPreviewMarkdown(
      version({
        content: "{bad json",
        contentText: "可读正文",
        contentFormat: "tiptap-json",
      }),
    );

    expect(preview).toBe("可读正文");
  });

  it("maps contentFormat to user-visible labels", () => {
    expect(versionContentFormatLabel("markdown")).toBe("Markdown");
    expect(versionContentFormatLabel("tiptap-json")).toBe("Rich Text");
    expect(versionContentFormatLabel("html")).toBe("HTML");
    expect(versionContentFormatLabel("legacy")).toBe("Unknown");
  });
});
