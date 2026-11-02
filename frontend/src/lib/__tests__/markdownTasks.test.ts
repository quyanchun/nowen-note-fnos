import { describe, expect, it } from "vitest";
import {
  applyMarkdownTaskCheckboxChange,
  getMarkdownTaskCheckboxChange,
  getMarkdownTaskCheckboxChangeAtOffset,
  toggleMarkdownTaskCheckbox,
} from "@/lib/markdownTasks";

describe("toggleMarkdownTaskCheckbox", () => {
  it("toggles the requested task checkbox without changing other tasks", () => {
    const markdown = [
      "- [ ] todo",
      "- [x] done",
      "plain text",
      "  - [ ] nested",
    ].join("\n");

    expect(toggleMarkdownTaskCheckbox(markdown, 0, true)).toBe([
      "- [x] todo",
      "- [x] done",
      "plain text",
      "  - [ ] nested",
    ].join("\n"));

    expect(toggleMarkdownTaskCheckbox(markdown, 1, false)).toBe([
      "- [ ] todo",
      "- [ ] done",
      "plain text",
      "  - [ ] nested",
    ].join("\n"));

    expect(toggleMarkdownTaskCheckbox(markdown, 2, true)).toBe([
      "- [ ] todo",
      "- [x] done",
      "plain text",
      "  - [x] nested",
    ].join("\n"));
  });

  it("returns the original markdown when the task index does not exist", () => {
    const markdown = "- [ ] todo";
    expect(toggleMarkdownTaskCheckbox(markdown, 5, true)).toBe(markdown);
  });

  it("returns a minimal marker change for the requested task", () => {
    const markdown = "- [ ] todo\n- [x] done";

    expect(getMarkdownTaskCheckboxChange(markdown, 1, false)).toEqual({
      from: 14,
      to: 15,
      insert: " ",
      checked: false,
    });
  });

  it("locates a task marker by source document offset", () => {
    const markdown = "- [ ] todo\n- [x] done";

    expect(getMarkdownTaskCheckboxChangeAtOffset(markdown, 3)).toEqual({
      from: 3,
      to: 4,
      insert: "x",
      checked: true,
    });

    expect(getMarkdownTaskCheckboxChangeAtOffset(markdown, 8)).toBeNull();
  });

  it("applies a minimal marker change", () => {
    const markdown = "- [ ] todo";
    const change = getMarkdownTaskCheckboxChange(markdown, 0, true);
    expect(change).not.toBeNull();
    expect(applyMarkdownTaskCheckboxChange(markdown, change!)).toBe("- [x] todo");
  });
});
