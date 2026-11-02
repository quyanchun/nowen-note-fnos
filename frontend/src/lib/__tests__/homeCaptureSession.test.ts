import { beforeEach, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => new Map<string, any>());
vi.mock("idb", () => ({ openDB: async () => ({
  get: async (_store: string, key: string) => structuredClone(stored.get(key)),
  put: async (_store: string, value: any) => { stored.set(value.key, structuredClone(value)); },
  close() {},
}) }));
vi.mock("../api", () => ({ api: {}, getCurrentWorkspace: () => "personal" }));
vi.mock("../offlineScope", () => ({ getOfflineQueueStorageKey: () => "server:account" }));

beforeEach(() => { stored.clear(); vi.resetModules(); });

it("starts empty after restarting while preserving capture preferences", async () => {
  const first = await import("../homeCapture");
  const key = first.getHomeCaptureScope();
  const draft = { ...first.emptyHomeCapture(key), text: "未保存输入", originalText: "整理前输入", title: "旧标题", notebookId: "bound-folder",
    files: [{ id: "file", name: "a.txt", type: "text/plain", blob: new Blob(["file"]) }],
    voice: { blob: new Blob(["audio"]), mimeType: "audio/wav", extension: "wav", durationMs: 1000, size: 5 },
    preferences: { method: "tidy" as const, notebookId: "preferred-folder" } };
  await first.homeCaptureStore.write(draft);
  expect(await first.homeCaptureStore.read(key)).toMatchObject({ id: draft.id, text: "未保存输入", files: [{ id: "file" }] });

  vi.resetModules();
  const restarted = await import("../homeCapture");
  const empty = await restarted.homeCaptureStore.read(key);
  expect(empty).toMatchObject({ key, text: "", files: [], preferences: draft.preferences });
  expect(empty?.id).not.toBe(draft.id);
  for (const property of ["voice", "originalText", "title", "notebookId"]) expect(empty).not.toHaveProperty(property);
});

it("does not repopulate old-version drafts or another account's input (DCC-006)", async () => {
  const capture = await import("../homeCapture");
  const key = capture.getHomeCaptureScope();
  stored.set(key, { key, id: "legacy", text: "旧版自动恢复的文字", files: [], preferences: { method: "tidy" } });
  expect(await capture.homeCaptureStore.read(key)).toMatchObject({ text: "", files: [], preferences: { method: "tidy" } });
  await capture.homeCaptureStore.write({ ...capture.emptyHomeCapture(key), text: "本次输入" });
  expect(await capture.homeCaptureStore.read(key)).toMatchObject({ text: "本次输入" });
  expect(await capture.homeCaptureStore.read("another-account:home:personal")).toBeUndefined();
});
