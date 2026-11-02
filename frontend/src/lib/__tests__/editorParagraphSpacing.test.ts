import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../../index.css"), "utf8");

describe("editor paragraph spacing", () => {
  it("does not add paragraph margins that look like blank lines in the editor", () => {
    expect(css).toContain("margin: var(--pm-p-margin, 0) 0;");
    expect(css).toContain("line-height: var(--pm-p-line-height, 1.6);");
  });
});
