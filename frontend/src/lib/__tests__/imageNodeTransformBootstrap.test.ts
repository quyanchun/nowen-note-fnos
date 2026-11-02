import { describe, expect, it } from "vitest";
import { generateHTML, generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TurndownService from "turndown";
import {
  getPersistentImageTransform,
  installImageTransformTurndownGuard,
  installPersistentImageTransformAttributes,
  normalizeImageFlipX,
  normalizeImageRotation,
} from "@/lib/imageNodeTransformBootstrap";

installPersistentImageTransformAttributes();
installImageTransformTurndownGuard();

const ImageWithEditorWidths = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const value = Number.parseInt(element.getAttribute("width") || "", 10);
          return Number.isFinite(value) && value > 0 ? value : null;
        },
        renderHTML: (attrs) => attrs.width == null ? {} : { width: attrs.width },
      },
      height: { default: null },
    };
  },
}).configure({ inline: false, allowBase64: true });

const extensions = [StarterKit, ImageWithEditorWidths];

describe("persistent image transform attributes", () => {
  it("normalizes repeated rotations and flip values", () => {
    expect(normalizeImageRotation(-90)).toBe(270);
    expect(normalizeImageRotation(450)).toBe(90);
    expect(normalizeImageFlipX("true")).toBe(true);
    expect(normalizeImageFlipX(false)).toBe(false);
    expect(getPersistentImageTransform(90, true)).toBe("rotate(90deg) scaleX(-1)");
  });

  it("round-trips rotation, flip and existing pixel width", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "image",
        attrs: {
          src: "https://example.com/a.png",
          alt: "A",
          title: null,
          width: 320,
          height: null,
          rotation: 270,
          flipX: true,
        },
      }],
    };
    const html = generateHTML(doc as any, extensions);
    expect(html).toContain('width="320"');
    expect(html).toContain('data-image-rotation="270"');
    expect(html).toContain('data-image-flip-x="true"');
    expect(html).toContain("rotate(270deg) scaleX(-1)");

    const parsed = generateJSON(html, extensions) as any;
    expect(parsed.content[0].attrs.width).toBe(320);
    expect(parsed.content[0].attrs.rotation).toBe(270);
    expect(parsed.content[0].attrs.flipX).toBe(true);
  });

  it("preserves transformed images as raw HTML when exporting Markdown", () => {
    const td = new TurndownService();
    const markdown = td.turndown(
      '<p>before</p><img src="/a.png" width="320" data-image-rotation="90" data-image-flip-x="true" style="transform:rotate(90deg) scaleX(-1);transform-origin:center center;"><p>after</p>',
    );
    expect(markdown).toContain('<img src="/a.png"');
    expect(markdown).toContain('data-image-rotation="90"');
    expect(markdown).toContain('data-image-flip-x="true"');
  });
});
