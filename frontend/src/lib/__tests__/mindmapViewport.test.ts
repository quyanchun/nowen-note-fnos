import { describe, expect, it } from "vitest";
import {
  computeFitViewport,
  computeLayoutBounds,
  fitMindMapToViewport,
  isValidViewport,
} from "@/lib/mindmapViewport";

describe("mindmapViewport", () => {
  it("keeps a small map at zoom 1 and centers it", () => {
    const viewport = fitMindMapToViewport(
      [{ x: 0, y: 0, width: 120, height: 40 }],
      { width: 800, height: 600 },
    );

    expect(viewport.zoom).toBe(1);
    expect(viewport.x).toBeCloseTo(340);
    expect(viewport.y).toBeCloseTo(280);
  });

  it("clamps large map fit zoom to the configured minimum", () => {
    const bounds = computeLayoutBounds([{ x: 0, y: 0, width: 3000, height: 2000 }]);
    const viewport = computeFitViewport(bounds, { width: 900, height: 600 });

    expect(viewport.zoom).toBe(0.6);
  });

  it("keeps the content center near the container center", () => {
    const nodes = [
      { x: -200, y: -100, width: 100, height: 50 },
      { x: 300, y: 200, width: 140, height: 60 },
    ];
    const bounds = computeLayoutBounds(nodes);
    const viewport = computeFitViewport(bounds, { width: 1000, height: 700 });
    const contentCenterX = ((bounds.minX + bounds.maxX) / 2) * viewport.zoom + viewport.x;
    const contentCenterY = ((bounds.minY + bounds.maxY) / 2) * viewport.zoom + viewport.y;

    expect(contentCenterX).toBeCloseTo(500);
    expect(contentCenterY).toBeCloseTo(350);
  });

  it("rejects invalid saved viewport values", () => {
    expect(isValidViewport({ x: 1, y: 2, zoom: 1, userSet: true })).toBe(true);
    expect(isValidViewport({ x: 1, y: 2, zoom: Number.NaN })).toBe(false);
    expect(isValidViewport({ x: 1, y: 2, zoom: 8 })).toBe(false);
  });
});
