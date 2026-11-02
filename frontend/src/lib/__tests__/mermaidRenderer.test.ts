import { beforeAll, expect, test } from "vitest";
import { renderMermaid } from "@/lib/mermaidRenderer";

beforeAll(() => {
  Object.defineProperties(SVGElement.prototype, {
    getBBox: {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 100, height: 40 }),
    },
    getComputedTextLength: {
      configurable: true,
      value: () => 80,
    },
  });

  if (!globalThis.CSSStyleSheet) {
    class CSSStyleSheetMock {
      cssRules: { cssText: string }[] = [];

      insertRule(rule: string) {
        this.cssRules.push({ cssText: rule });
      }
    }
    Object.defineProperty(globalThis, "CSSStyleSheet", { configurable: true, value: CSSStyleSheetMock });
  }
});

test("renders Mermaid node labels as SVG text instead of foreignObject", async () => {
  const result = await renderMermaid("graph TD\nA[开始] --> B[结束]");

  expect(result.error).toBe("");
  expect(result.svg).toContain("<text");
  expect(result.svg).not.toContain("foreignObject");
});
