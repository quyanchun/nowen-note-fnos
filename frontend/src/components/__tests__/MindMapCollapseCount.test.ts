import { describe, expect, it } from "vitest";
import type { MindMapNode } from "@/types";
import { countMindMapDescendants } from "../MindMapEditor";

describe("countMindMapDescendants", () => {
  it("counts every hidden descendant of a collapsed node", () => {
    const node: MindMapNode = {
      id: "topic",
      text: "核心观点",
      children: [
        { id: "point-1", text: "观点 1", children: [] },
        {
          id: "point-2",
          text: "观点 2",
          children: [{ id: "detail", text: "细节", children: [] }],
        },
      ],
    };

    expect(countMindMapDescendants(node)).toBe(3);
  });
});
