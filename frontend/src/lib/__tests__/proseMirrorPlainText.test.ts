import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { serializeProseMirrorPlainText } from "@/lib/proseMirrorPlainText";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    text: { group: "inline" },
    hardBreak: {
      inline: true,
      group: "inline",
      selectable: false,
      toDOM: () => ["br"],
      parseDOM: [{ tag: "br" }],
    },
  },
});

describe("serializeProseMirrorPlainText", () => {
  it("serializes adjacent paragraphs with single newlines", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("19863422823")),
      schema.node("paragraph", null, schema.text("19863422823")),
      schema.node("paragraph", null, schema.text("19863422823")),
    ]);

    expect(serializeProseMirrorPlainText(doc.content)).toBe(
      "19863422823\n19863422823\n19863422823",
    );
  });

  it("preserves hard breaks as single newlines", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("first"),
        schema.nodes.hardBreak.create(),
        schema.text("second"),
      ]),
    ]);

    expect(serializeProseMirrorPlainText(doc.content)).toBe("first\nsecond");
  });
});
