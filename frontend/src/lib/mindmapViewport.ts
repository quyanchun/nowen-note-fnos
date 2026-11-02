import type { MindMapViewport } from "@/types";

export interface MindMapViewportNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MindMapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface MindMapContainerSize {
  width: number;
  height: number;
}

export interface FitViewportOptions {
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
}

export function computeLayoutBounds(nodes: MindMapViewportNode[], padding = 0): MindMapBounds {
  if (nodes.length === 0) {
    return { minX: -padding, minY: -padding, maxX: padding, maxY: padding, width: padding * 2, height: padding * 2 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function computeFitViewport(
  bounds: MindMapBounds,
  container: MindMapContainerSize,
  options: FitViewportOptions = {},
): MindMapViewport {
  const padding = options.padding ?? 120;
  const minZoom = options.minZoom ?? 0.6;
  const maxZoom = options.maxZoom ?? 1;
  const usableWidth = Math.max(1, container.width - padding * 2);
  const usableHeight = Math.max(1, container.height - padding * 2);
  const fitZoom = Math.min(usableWidth / bounds.width, usableHeight / bounds.height);
  const zoom = Math.max(minZoom, Math.min(maxZoom, fitZoom));
  const contentWidth = bounds.width * zoom;
  const contentHeight = bounds.height * zoom;

  return {
    x: (container.width - contentWidth) / 2 - bounds.minX * zoom,
    y: (container.height - contentHeight) / 2 - bounds.minY * zoom,
    zoom,
    userSet: false,
  };
}

export function isValidViewport(viewport: unknown): viewport is MindMapViewport {
  if (!viewport || typeof viewport !== "object") return false;
  const v = viewport as Partial<MindMapViewport>;
  return (
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.zoom) &&
    typeof v.zoom === "number" &&
    v.zoom >= 0.2 &&
    v.zoom <= 4
  );
}

export function fitMindMapToViewport(
  nodes: MindMapViewportNode[],
  container: MindMapContainerSize,
  options: FitViewportOptions = {},
): MindMapViewport {
  const bounds = computeLayoutBounds(nodes);
  return computeFitViewport(bounds, container, options);
}
