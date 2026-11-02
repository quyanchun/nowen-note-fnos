import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ scope: "server:user", workspace: "personal", api: { getNotebooks: vi.fn(), createNotebook: vi.fn(), getNote: vi.fn(), createNoteConfirmed: vi.fn(), updateNoteConfirmed: vi.fn(), attachments: { upload: vi.fn() } } }));
vi.mock("../api", () => ({ api: mocks.api, getCurrentWorkspace: () => mocks.workspace }));
vi.mock("../offlineScope", () => ({ getOfflineQueueStorageKey: () => mocks.scope }));
import { emptyHomeCapture, getHomeCaptureScope, saveHomeCapture, type HomeCaptureDraft } from "../homeCapture";
beforeEach(() => {
  vi.resetAllMocks(); mocks.scope = "server:user"; mocks.workspace = "personal";
  mocks.api.getNotebooks.mockResolvedValue([{ id: "inbox", name: "收集箱", parentId: null, workspaceId: null }]);
  mocks.api.getNote.mockRejectedValue(Object.assign(new Error("missing"), { status: 404 }));
  mocks.api.createNoteConfirmed.mockImplementation(async data => ({ ...data, version: 1 }));
  mocks.api.updateNoteConfirmed.mockImplementation(async (id, data) => ({ id, ...data }));
});
it("retains draft and acknowledged attachment progress after failure and retries without creating duplicate notes (DCC-001 DCC-002 DCC-003)", async () => {
  let durable: HomeCaptureDraft = { ...emptyHomeCapture(getHomeCaptureScope()), text: "中文正文", files: ["a.txt", "b.txt"].map(name => ({ id: name, name, type: "text/plain", blob: new Blob([name]) })) };
  const persist = async (draft: HomeCaptureDraft) => { durable = structuredClone(draft); };
  mocks.api.attachments.upload.mockResolvedValueOnce({ id: "attachment-a", filename: "a.txt", url: "/a" }).mockRejectedValueOnce(new Error("network failed"));
  await expect(saveHomeCapture(durable, persist, "收集箱")).rejects.toThrow("network failed");
  expect(durable.text).toBe("中文正文"); expect(durable.files[0].attachment?.id).toBe("attachment-a"); expect(durable.files[1].attachment).toBeUndefined();
  expect(mocks.api.updateNoteConfirmed).not.toHaveBeenCalled();
  mocks.api.getNote.mockResolvedValue({ id: durable.id, notebookId: "inbox", version: 1 });
  mocks.api.attachments.upload.mockResolvedValue({ id: "attachment-b", filename: "b.txt", url: "/b" });
  await saveHomeCapture(durable, persist, "收集箱");
  expect(mocks.api.createNoteConfirmed).toHaveBeenCalledTimes(1);
  expect(mocks.api.attachments.upload).toHaveBeenCalledTimes(3);
  expect(mocks.api.updateNoteConfirmed).toHaveBeenLastCalledWith(durable.id, expect.objectContaining({ version: 1, content: "中文正文\n\n[a.txt](/api/attachments/attachment-a)\n\n[b.txt](/api/attachments/attachment-b)" }));
});
it("keeps original draft on rejected acknowledgement instead of reporting success (DCC-001 DCC-003)", async () => {
  const draft = emptyHomeCapture(getHomeCaptureScope()); draft.text = "仍需保存";
  mocks.api.createNoteConfirmed.mockRejectedValue(new Error("HTTP 503"));
  const persist = vi.fn().mockResolvedValue(undefined);
  await expect(saveHomeCapture(draft, persist, "收集箱")).rejects.toThrow("HTTP 503");
  expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({ id: draft.id, text: "仍需保存" });
  expect(mocks.api.updateNoteConfirmed).not.toHaveBeenCalled();
});
it("refuses late writes after account or workspace switches (DCC-006)", async () => {
  const draft = { ...emptyHomeCapture(getHomeCaptureScope()), text: "原账号内容" };
  mocks.api.getNotebooks.mockImplementation(async () => { mocks.scope = "server:other-user"; return []; });
  await expect(saveHomeCapture(draft, async () => {}, "收集箱")).rejects.toThrow("HOME_SCOPE_CHANGED");
  expect(mocks.api.createNotebook).not.toHaveBeenCalled(); expect(mocks.api.createNoteConfirmed).not.toHaveBeenCalled();
  mocks.scope = "server:user"; mocks.workspace = "other-workspace";
  await expect(saveHomeCapture(draft, async () => {}, "收集箱")).rejects.toThrow("HOME_SCOPE_CHANGED");
});
it("saves to the selected folder and preserves the original AI input in the confirmed content", async () => {
  const draft = { ...emptyHomeCapture(getHomeCaptureScope()), text: "整理后的要点", originalText: "原始输入 /tmp/example.md", preferences: { method: "tidy" as const, notebookId: "chosen" } };
  mocks.api.getNotebooks.mockResolvedValueOnce([{ id: "chosen", name: "资料", permission: "write" }]);
  await saveHomeCapture(draft, async () => {}, "收集箱");
  expect(mocks.api.createNoteConfirmed).toHaveBeenCalledWith(expect.objectContaining({ id: draft.id, notebookId: "chosen", content: expect.stringContaining("原始输入 /tmp/example.md") }));
  expect(mocks.api.createNotebook).not.toHaveBeenCalled();
  expect(mocks.api.updateNoteConfirmed).toHaveBeenCalledWith(draft.id, expect.objectContaining({ content: "整理后的要点\n\n---\n\n## 原文\n\n原始输入 /tmp/example.md", contentText: expect.stringContaining("原始输入 /tmp/example.md") }));
});
it("rejects a missing configured destination before binding a retry to the stale folder", async () => {
  const draft = { ...emptyHomeCapture(getHomeCaptureScope()), text: "原文", preferences: { method: "tidy" as const, notebookId: "deleted" } };
  const persist = vi.fn().mockResolvedValue(undefined);
  await expect(saveHomeCapture(draft, persist, "收集箱")).rejects.toThrow("重新选择");
  expect(persist.mock.calls.at(-1)?.[0].notebookId).toBeUndefined(); expect(mocks.api.createNoteConfirmed).not.toHaveBeenCalled();
});
