import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor, generateHTML, generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  isValidLineHeight,
  LineHeightExtension,
  LINE_HEIGHT_PRESETS,
} from "../LineHeightExtension";

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
  }),
  LineHeightExtension,
];

describe("LineHeightExtension", () => {
  it("validates safe unitless line-height values", () => {
    expect(isValidLineHeight("1")).toBe(true);
    expect(isValidLineHeight("1.4")).toBe(true);
    expect(isValidLineHeight("2")).toBe(true);
    expect(isValidLineHeight("2.5")).toBe(true);
    expect(isValidLineHeight("3")).toBe(true);

    expect(isValidLineHeight("0.8")).toBe(false);
    expect(isValidLineHeight("3.5")).toBe(false);
    expect(isValidLineHeight("calc(1 + 1)")).toBe(false);
    expect(isValidLineHeight("url(javascript:alert(1))")).toBe(false);
    expect(isValidLineHeight("-1")).toBe(false);
    expect(isValidLineHeight("1.234")).toBe(false);
  });

  it("keeps the expected presets", () => {
    expect(LINE_HEIGHT_PRESETS.map((preset) => preset.value)).toEqual(["1", "1.4", "1.6", "1.8", "2"]);
  });

  it("renders valid line-height attrs to block style", () => {
    const html = generateHTML(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { lineHeight: "1.6" },
            content: [{ type: "text", text: "Hello" }],
          },
        ],
      },
      extensions,
    );

    expect(html).toContain("line-height: 1.6");
    expect(html).toContain("Hello");
  });

  it("parses line-height from HTML styles", () => {
    const json = generateJSON('<p style="line-height: 1.8">Hello</p>', extensions);
    const paragraph = json.content?.find((node: any) => node.type === "paragraph") as any;

    expect(paragraph?.attrs?.lineHeight).toBe("1.8");
  });

  it("sets line-height on the current paragraph", () => {
    const editor = new Editor({
      extensions,
      content: "<p>Hello</p>",
    });

    editor.commands.setTextSelection(2);
    expect(editor.commands.setLineHeight("1.8")).toBe(true);

    expect(editor.getJSON().content?.[0].attrs?.lineHeight).toBe("1.8");
    editor.destroy();
  });

  it("sets line-height on selected list items without breaking the list", () => {
    const editor = new Editor({
      extensions,
      content: "<ol><li><p>One</p></li><li><p>Two</p></li></ol>",
    });

    editor.commands.selectAll();
    expect(editor.commands.setLineHeight("2")).toBe(true);

    const orderedList = editor.getJSON().content?.find((node: any) => node.type === "orderedList") as any;
    const items = orderedList?.content ?? [];
    expect(items).toHaveLength(2);
    expect(items.map((item: any) => item.attrs?.lineHeight)).toEqual(["2", "2"]);
    expect(items[0].content?.[0]?.type).toBe("paragraph");
    editor.destroy();
  });

  it("unsets line-height from selected blocks", () => {
    const editor = new Editor({
      extensions,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { lineHeight: "1.8" },
            content: [{ type: "text", text: "Hello" }],
          },
        ],
      },
    });

    editor.commands.selectAll();
    expect(editor.commands.unsetLineHeight()).toBe(true);

    expect(editor.getJSON().content?.[0].attrs?.lineHeight).toBeNull();
    editor.destroy();
  });
});

describe("TiptapEditor line-height guardrails", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/TiptapEditor.tsx"), "utf8");

  it("registers the extension and exposes toolbar and bubble menu controls", () => {
    expect(source).toContain("LineHeightExtension");
    expect(source).toContain("<LineHeightPopover editor={editor} iconSize={iconSize} />");
    expect(source).toContain("<LineHeightPopover editor={editor} iconSize={14} compact />");
  });
});
