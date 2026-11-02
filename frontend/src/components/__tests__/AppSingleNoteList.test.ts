import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(path.resolve(__dirname, "../../App.tsx"), "utf8");

describe("App note list mounting", () => {
  it("mounts a single responsive NoteList so one refresh produces one list request", () => {
    const noteListInstances = appSource.match(/<NoteList\s*\/>/g) || [];
    expect(noteListInstances).toHaveLength(1);
  });
});
