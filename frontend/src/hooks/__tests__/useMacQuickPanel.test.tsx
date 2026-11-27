import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useMacQuickPanel } from "../useMacQuickPanel";

const mock = vi.hoisted(() => ({
  scope: "personal",
  search: vi.fn(),
  ask: vi.fn(),
  file: vi.fn(),
  save: vi.fn(),
  getNote: vi.fn(),
  bridge: { ready: vi.fn(), results: vi.fn(), onAction: vi.fn(), onQuery: vi.fn() },
}));
vi.mock("@/lib/aiCollaboration", () => ({ collaborationRequest: mock.file }));
vi.mock("@/lib/aiReliable", () => ({ reliableAsk: mock.ask }));
vi.mock("@/lib/desktopBridge", () => ({ getQuickPanel: () => mock.bridge }));
vi.mock("@/lib/homeCapture", () => ({ getHomeCaptureScope: () => mock.scope, saveHomeCapture: mock.save }));
vi.mock("@/lib/api", () => ({ getCurrentWorkspace: () => "personal", api: { searchNotes: mock.search, getNote: mock.getNote } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("cancels superseded searches and drops results and actions on scope changes", async () => {
  const root = createRoot(document.createElement("div"));
  const onAction = vi.fn();
  function Harness() { useMacQuickPanel(onAction); return null; }
  mock.bridge.onAction.mockReturnValue(vi.fn());
  mock.bridge.onQuery.mockReturnValue(vi.fn());
  act(() => root.render(<Harness />));
  const query = mock.bridge.onQuery.mock.calls[0][0];
  const action = mock.bridge.onAction.mock.calls[0][0];
  let resolveFirst!: (rows: unknown[]) => void;
  mock.search.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  mock.search.mockResolvedValue([{ id: "id", title: "current", privateText: "body" }]);
  try {
    const first = query({id: 1, kind: "preview", query: "a"});
    await query({id: 2, kind: "search", query: "ab"});
    expect(mock.search.mock.calls[1][1]).toBe(50);
    expect(mock.search.mock.calls[0][2].aborted).toBe(true);
    resolveFirst([{id:"old",title:"late"}]);
    await first;
    expect(mock.bridge.results.mock.calls).toEqual([[{id: 2, kind: "search", query: "ab", rows: [{id:"id",title:"current"}]}]]);
    const pending = query({id: 3, kind: "preview", query: "abc"});
    mock.scope = "team";
    await pending;
    action({action: "open", text: "id"});
    expect(onAction).not.toHaveBeenCalled();
    expect(mock.bridge.results).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    expect(mock.bridge.ready.mock.calls).toEqual([[true],[false]]);
  }
});

it("streams answers and citations to the panel and keeps streaming during search, then drops late chunks after dismissal", async () => {
  vi.clearAllMocks();
  mock.scope = "personal";
  const root = createRoot(document.createElement("div"));
  function Harness() { useMacQuickPanel(vi.fn()); return null; }
  act(() => root.render(<Harness />));
  const query = mock.bridge.onQuery.mock.calls[0][0];
  const request = {id: 7, kind: "ask", query: "时间？"};
  let finish!: (answer: string) => void;
  mock.ask.mockImplementationOnce((_params, handlers) => {
    handlers.onDiagnostics({ hits: [{ noteId: "one", title: "时间表", preview: "九点签到", notebook: "展览", updatedAt: "2026-11-27" }] });
    handlers.onChunk("九点");
    return new Promise(resolve => { finish = resolve; });
  });
  try {
    const pending = query(request);
    await vi.waitFor(() => expect(mock.ask).toHaveBeenCalledOnce());
    expect(mock.bridge.results.mock.calls).toEqual([
      [{ ...request, rows: [{id: "one", title: "时间表", snippet: "九点签到", notebook: "展览", updatedAt: "2026-11-27"}] }], [{ ...request, answerHtml: "<p>九点</p>\n" }],
    ]);
    await query({id: 8, query: "", kind: "preview"});
    const [, callbacks, signal] = mock.ask.mock.calls[0];
    expect(signal.aborted).toBe(false);
    await query({id: 9, query: "", kind: "clear"});
    expect(signal.aborted).toBe(true);
    callbacks.onChunk("迟到的分片");
    finish("九点");
    await pending;
    expect(mock.bridge.results).toHaveBeenCalledTimes(2);
  } finally { act(() => root.unmount()); }
});

it("previews formatted text only for a note in the current workspace", async () => {
  vi.clearAllMocks();
  mock.scope = "personal";
  const root = createRoot(document.createElement("div"));
  function Harness() { useMacQuickPanel(vi.fn()); return null; }
  act(() => root.render(<Harness />));
  const query = mock.bridge.onQuery.mock.calls[0][0];
  const request = {id: 1, kind: "detail", query: "one"};
  const note = {title: "日程", content: "### 上午\n\n**签到** ![照片](https://example.test/a)", contentFormat: "markdown"};
  try {
    mock.getNote.mockResolvedValueOnce({...note, workspaceId: "another"});
    await query(request);
    expect(mock.bridge.results).toHaveBeenLastCalledWith({...request, error: "这篇笔记在当前工作区不可用"});
    mock.getNote.mockResolvedValueOnce(note);
    await query(request);
    const { html } = mock.bridge.results.mock.calls.at(-1)![0].detail;
    expect(html).toContain("<h3>上午</h3>");
    expect(html).toContain("<strong>签到</strong>");
    expect(html).not.toMatch(/<img|https:/);
    mock.getNote.mockResolvedValueOnce({...note, contentFormat: "encrypted-markdown"});
    await query(request);
    expect(mock.bridge.results.mock.calls.at(-1)![0].detail.html).toBe("");
  } finally { act(() => root.unmount()); }
});

it("files only on explicit request, keeps one ID after acknowledgement loss and cancels on a workspace switch", async () => {
  vi.clearAllMocks();
  mock.scope = "personal";
  const root = createRoot(document.createElement("div"));
  function Harness() { useMacQuickPanel(vi.fn()); return null; }
  act(() => root.render(<Harness />));
  const query = mock.bridge.onQuery.mock.calls[0][0];
  const draft = { id: "draft", title: "记录", text: "原文" };
  const request = { id: 1, kind: "save", query: draft.id, draft };
  try {
    mock.file.mockResolvedValueOnce({ notebookId: "guitar", path: "音乐 / 吉他" });
    mock.save.mockRejectedValueOnce(new Error("lost ack"));
    await query({ ...request, organize: true });
    expect(mock.save.mock.calls[0][0]).toMatchObject({ id: "draft", notebookId: "guitar", text: "原文" });
    expect(mock.bridge.results.mock.lastCall?.[0]).toMatchObject({ error: "lost ack" });
    mock.getNote.mockResolvedValueOnce({ ...draft, content: draft.text, notebookId: "guitar" });
    await query(request);
    expect(mock.bridge.results.mock.lastCall?.[0]).toMatchObject({ saved: "draft", folder: "音乐 / 吉他" });
    expect(mock.save).toHaveBeenCalledOnce(); expect(mock.file).toHaveBeenCalledOnce();
    mock.file.mockImplementationOnce(async () => { mock.scope = "different"; return { notebookId: "new", path: "工作" }; });
    await query({ ...request, organize: true });
    expect(mock.save).toHaveBeenCalledOnce();
  } finally { act(() => root.unmount()); }
});

it("paints the tail of a short burst while the model pauses and keeps Markdown formatted at completion", async () => {
  vi.clearAllMocks();
  mock.scope = "personal";
  const root = createRoot(document.createElement("div"));
  function Harness() { useMacQuickPanel(vi.fn()); return null; }
  act(() => root.render(<Harness />));
  const request = { id: 11, kind: "ask", query: "交接清单" };
  let finish!: (value: string) => void;
  const first = "## 交接\n\n";
  const second = "| 时间 | 内容 |\n| --- | --- |\n| 九点 | **签收** |";
  mock.ask.mockImplementationOnce((_params, handlers) => {
    handlers.onChunk(first);
    handlers.onChunk(second);
    return new Promise(resolve => { finish = resolve; });
  });
  try {
    const pending = mock.bridge.onQuery.mock.calls[0][0](request);
    await vi.waitFor(() => expect(mock.bridge.results).toHaveBeenCalledTimes(2));
    const html = mock.bridge.results.mock.calls[1][0].answerHtml;
    expect(html).toContain("<h2>交接</h2>");
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>签收</strong>");
    expect(mock.bridge.results.mock.calls[1][0].done).toBeUndefined();
    finish(first + second);
    await pending;
    expect(mock.bridge.results).toHaveBeenLastCalledWith({ ...request, done: true, answerHtml: html });
  } finally { act(() => root.unmount()); }
});
