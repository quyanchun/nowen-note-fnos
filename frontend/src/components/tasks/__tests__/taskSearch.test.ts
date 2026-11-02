import { describe, expect, it } from "vitest";
import { taskMatchesSearch } from "../taskSearch";

describe("taskMatchesSearch", () => {
  it("matches task description", () => {
    expect(taskMatchesSearch({
      title: "Release checklist",
      description: "Smoke test billing and rollback notes",
    }, "rollback")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(taskMatchesSearch({
      title: "Release checklist",
      description: "Smoke test billing and rollback notes",
    }, "marketing")).toBe(false);
  });
});
