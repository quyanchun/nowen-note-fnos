import { describe, expect, it } from "vitest";
import {
  interpolatePositionByScroll,
  interpolateScrollByPosition,
  type MarkdownScrollAnchor,
} from "@/lib/markdownScrollSync";

const anchors: MarkdownScrollAnchor[] = [
  { pos: 0, top: 0 },
  { pos: 100, top: 240 },
  { pos: 300, top: 600 },
];

describe("markdown split scroll mapping", () => {
  it("interpolates source offsets to preview positions between semantic anchors", () => {
    expect(interpolateScrollByPosition(anchors, 50, 600, 300)).toBe(120);
    expect(interpolateScrollByPosition(anchors, 200, 600, 300)).toBe(420);
  });

  it("maps preview positions back to source offsets", () => {
    expect(interpolatePositionByScroll(anchors, 120, 600, 300)).toBe(50);
    expect(interpolatePositionByScroll(anchors, 420, 600, 300)).toBe(200);
  });

  it("falls back to proportional mapping when semantic anchors are unavailable", () => {
    expect(interpolateScrollByPosition([], 250, 1000, 500)).toBe(500);
    expect(interpolatePositionByScroll([], 500, 1000, 500)).toBe(250);
  });
});
