import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(__dirname, "../EditorPane.tsx"), "utf8");

describe("EditorPane lifecycle offline queue", () => {
  it("queues lifecycle snapshots only while the browser is offline", () => {
    const start = source.indexOf("const flushToLocal = () => {");
    const end = source.indexOf("const onPageHide = () => flushToLocal();", start);
    const flushToLocal = source.slice(start, end);

    expect(flushToLocal).toContain("if (navigator.onLine) return;");
    expect(flushToLocal).toContain("enqueueOfflineMutation({");
  });
});
