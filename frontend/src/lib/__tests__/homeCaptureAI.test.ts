import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../aiCollaboration", () => ({ collaborationRequest: m.request }));
import { organizeCapture } from "../homeCaptureAI";
it("uses the existing AI service with conservative cleanup defaults and optional instructions", async () => {
  m.request.mockResolvedValueOnce({ content: "整理结果" }); const abort = new AbortController();
  expect(await organizeCapture("/tmp/a.md", { method: "tidy", instruction: "保留链接", referenceNotebookId: "project" }, abort.signal)).toBe("整理结果");
  expect(m.request).toHaveBeenLastCalledWith("compose", expect.objectContaining({ input: "/tmp/a.md", intent: "capture", notebookId: "project", skill: expect.objectContaining({ prompt: expect.stringContaining("禁止扩写成文章") }) }), abort.signal);
});
it("refuses empty model output instead of replacing the draft", async () => {
  m.request.mockResolvedValueOnce({ content: "  " });
  await expect(organizeCapture("原文", { method: "tidy" }, new AbortController().signal)).rejects.toThrow("原文已保留");
});
