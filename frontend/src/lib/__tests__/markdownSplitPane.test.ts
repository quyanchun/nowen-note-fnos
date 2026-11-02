import { describe, expect, it } from "vitest";
import { clampMarkdownSplitPercent } from "@/lib/markdownSplitPane";

describe("clampMarkdownSplitPercent", () => {
  it("keeps the source pane width inside the usable range", () => {
    expect(clampMarkdownSplitPercent(10)).toBe(25);
    expect(clampMarkdownSplitPercent(50)).toBe(50);
    expect(clampMarkdownSplitPercent(90)).toBe(75);
  });
});
