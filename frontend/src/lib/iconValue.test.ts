import { describe, expect, it } from "vitest";
import { isImageIcon, splitImageIconText } from "./iconValue";

const SVG_ICON = "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMjQgMjQiPjxwYXRoIGQ9Ik0yIDJoMjB2MjBIMnoiLz48L3N2Zz4=";

describe("image icon values", () => {
  it("recognizes supported base64 image data URLs", () => {
    expect(isImageIcon(SVG_ICON)).toBe(true);
    expect(isImageIcon("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isImageIcon("https://example.com/icon.svg")).toBe(false);
    expect(isImageIcon("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
  });

  it("splits an imported image icon from surrounding React text", () => {
    expect(splitImageIconText(`${SVG_ICON} 项目笔记`)).toEqual([
      { type: "image", value: SVG_ICON },
      { type: "text", value: " 项目笔记" },
    ]);
  });

  it("keeps ordinary text unchanged", () => {
    expect(splitImageIconText("📒 普通笔记本")).toEqual([
      { type: "text", value: "📒 普通笔记本" },
    ]);
  });
});
