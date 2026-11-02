import { describe, expect, it } from "vitest";
import { normalizeFormatHeadingLevel } from "../MarkdownEditor";
import {
  extractDeepMarkdownHeadings,
  mergeMarkdownEditorHeadings,
} from "@/lib/markdownEditorOutline";

describe("normalizeFormatHeadingLevel", () => {
  it("preserves heading levels 4-6 for desktop format menu events", () => {
    expect(normalizeFormatHeadingLevel(4)).toBe(4);
    expect(normalizeFormatHeadingLevel(5)).toBe(5);
    expect(normalizeFormatHeadingLevel(6)).toBe(6);
  });

  it("clamps out-of-range levels into the supported 1-6 range", () => {
    expect(normalizeFormatHeadingLevel(0)).toBe(1);
    expect(normalizeFormatHeadingLevel(9)).toBe(6);
  });
});

describe("Markdown editor outline", () => {
  it("extracts H4-H6 with source positions", () => {
    const markdown = "# H1\n\n#### H4\n\n##### H5\n\n###### H6";
    expect(extractDeepMarkdownHeadings(markdown).map(({ level, text, pos }) => ({ level, text, pos }))).toEqual([
      { level: 4, text: "H4", pos: 6 },
      { level: 5, text: "H5", pos: 15 },
      { level: 6, text: "H6", pos: 25 },
    ]);
  });

  it("ignores heading-looking content inside fenced code blocks", () => {
    const markdown = "```md\n#### code sample\n```\n\n#### real heading";
    expect(extractDeepMarkdownHeadings(markdown).map(({ level, text }) => ({ level, text }))).toEqual([
      { level: 4, text: "real heading" },
    ]);
  });

  it("merges deep headings with the CodeMirror H1-H3 outline in document order", () => {
    const shallow = [
      { id: "h-0", level: 1, text: "H1", pos: 0 },
      { id: "h-15", level: 2, text: "H2", pos: 15 },
    ];
    const markdown = "# H1\n\n#### H4\n\n## H2";

    expect(mergeMarkdownEditorHeadings(shallow, markdown).map(({ level, text }) => ({ level, text }))).toEqual([
      { level: 1, text: "H1" },
      { level: 4, text: "H4" },
      { level: 2, text: "H2" },
    ]);
  });
});
