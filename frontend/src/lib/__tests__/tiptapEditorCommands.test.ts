import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import {
  createPlainTextParagraphNodes,
  createPlainTextParagraphContainer,
  findAdjacentListJoinPositions,
  insertCodeBlockNewline,
  isAllowedRemoteImageUrl,
} from "@/lib/tiptapEditorCommands";

const listSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    text: { group: "inline" },
    orderedList: {
      content: "listItem+",
      group: "block",
      attrs: { start: { default: 1 } },
      toDOM: (node) => ["ol", { start: node.attrs.start }, 0],
      parseDOM: [{ tag: "ol" }],
    },
    bulletList: {
      content: "listItem+",
      group: "block",
      toDOM: () => ["ul", 0],
      parseDOM: [{ tag: "ul" }],
    },
    listItem: {
      content: "paragraph block*",
      toDOM: () => ["li", 0],
      parseDOM: [{ tag: "li" }],
    },
    codeBlock: {
      content: "text*",
      group: "block",
      code: true,
      defining: true,
      toDOM: () => ["pre", ["code", 0]],
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
    },
  },
});

const p = (text: string) =>
  text
    ? listSchema.node("paragraph", null, listSchema.text(text))
    : listSchema.node("paragraph");
const li = (text: string) => listSchema.node("listItem", null, p(text));
const ol = (...items: string[]) => listSchema.node("orderedList", null, items.map(li));
const ul = (...items: string[]) => listSchema.node("bulletList", null, items.map(li));
const code = (text: string) =>
  text ? listSchema.node("codeBlock", null, listSchema.text(text)) : listSchema.node("codeBlock");

function createTestView(doc: any, selectionPos: number, selectionTo = selectionPos) {
  let state = EditorState.create({
    schema: listSchema,
    doc,
    selection: TextSelection.create(doc, selectionPos, selectionTo),
  });
  return {
    get state() {
      return state;
    },
    dispatch(tr: any) {
      state = state.apply(tr);
    },
    focus() {},
  };
}

describe("createPlainTextParagraphContainer", () => {
  it("turns CRLF multiline text into real paragraph elements", () => {
    const root = createPlainTextParagraphContainer("first\r\n\r\nthird");
    const paragraphs = Array.from(root.querySelectorAll("p"));

    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.map((node) => node.textContent)).toEqual(["first", "", "third"]);
    expect(paragraphs[1].querySelector("br")).not.toBeNull();
  });
});

describe("createPlainTextParagraphNodes", () => {
  it("turns multiline code text into one paragraph per line", () => {
    const nodes = createPlainTextParagraphNodes(listSchema, "a\nb\n\nc");

    expect(nodes).toHaveLength(4);
    expect(nodes.map((node) => node.type.name)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
    expect(nodes.map((node) => node.textContent)).toEqual(["a", "b", "", "c"]);
  });

  it("turns an empty code block into one empty paragraph", () => {
    const nodes = createPlainTextParagraphNodes(listSchema, "");

    expect(nodes).toHaveLength(1);
    expect(nodes[0].type.name).toBe("paragraph");
    expect(nodes[0].textContent).toBe("");
  });

  it("normalizes CRLF and CR line endings", () => {
    const nodes = createPlainTextParagraphNodes(listSchema, "first\r\nsecond\rthird");

    expect(nodes.map((node) => node.textContent)).toEqual(["first", "second", "third"]);
  });
});

describe("insertCodeBlockNewline", () => {
  it("inserts a real newline inside the current code block", () => {
    const view = createTestView(listSchema.node("doc", null, [code("abc")]), 3);

    expect(insertCodeBlockNewline(view as any)).toBe(true);
    expect(view.state.doc.child(0).textContent).toBe("ab\nc");
    expect(view.state.doc.child(0).type.name).toBe("codeBlock");
  });

  it("replaces selected code text with a newline", () => {
    const view = createTestView(listSchema.node("doc", null, [code("abcd")]), 2, 4);

    expect(insertCodeBlockNewline(view as any)).toBe(true);
    expect(view.state.doc.child(0).textContent).toBe("a\nd");
  });

  it("does not handle Enter outside code blocks", () => {
    const view = createTestView(listSchema.node("doc", null, [p("abc")]), 2);

    expect(insertCodeBlockNewline(view as any)).toBe(false);
    expect(view.state.doc.child(0).textContent).toBe("abc");
  });
});

describe("isAllowedRemoteImageUrl", () => {
  it("allows only http and https image URLs", () => {
    expect(isAllowedRemoteImageUrl("https://example.com/a.png")).toBe(true);
    expect(isAllowedRemoteImageUrl("http://example.com/a.png")).toBe(true);
    expect(isAllowedRemoteImageUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedRemoteImageUrl("data:image/png;base64,abc")).toBe(false);
    expect(isAllowedRemoteImageUrl("file:///C:/tmp/a.png")).toBe(false);
  });
});

describe("findAdjacentListJoinPositions", () => {
  it("finds adjacent ordered lists with matching attrs", () => {
    const doc = listSchema.node("doc", null, [ol("one"), ol("two")]);

    expect(findAdjacentListJoinPositions(doc)).toHaveLength(1);
  });

  it("does not join across a different list type", () => {
    const doc = listSchema.node("doc", null, [ol("one"), ul("nested"), ol("two")]);

    expect(findAdjacentListJoinPositions(doc)).toHaveLength(0);
  });
});
