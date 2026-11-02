import { describe, expect, it } from "vitest";
import { insertTaskTitleSnippet } from "../taskTitleTokens";

describe("insertTaskTitleSnippet", () => {
  it("inserts a pasted task attachment at the textarea selection", () => {
    expect(
      insertTaskTitleSnippet("before after", "![shot](/api/task-attachments/a)", 7, 12),
    ).toBe("before ![shot](/api/task-attachments/a)");
  });

  it("appends with a space when there is no active selection", () => {
    expect(insertTaskTitleSnippet("before", "![shot](/api/task-attachments/a)")).toBe(
      "before ![shot](/api/task-attachments/a)",
    );
  });
});
