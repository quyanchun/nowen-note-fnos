import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Note } from "@/types";
import "@/i18n";

const fixture = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async original => {
  const actual = await original<typeof import("@tiptap/react")>();
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...args); fixture.editor = editor; return editor;
  } };
});
import TiptapEditor from "../TiptapEditor";
import { AppProvider } from "@/store/AppContext";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let host: HTMLDivElement;
const note = {
  id: "format-painter-test", title: "格式刷交互验收", notebookId: "test-book", contentFormat: "tiptap-json", version: 1,
  content: JSON.stringify({ type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "源文字", marks: [{ type: "bold" }, { type: "textStyle", attrs: { color: "#ff0000", fontSize: "24px" } }] }] },
    { type: "paragraph", content: [{ type: "text", text: "目标文字" }] },
  ] }), contentText: "源文字\n目标文字", createdAt: "2026-10-27", updatedAt: "2026-10-27", tags: [],
} as unknown as Note;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function range(text: string) {
  let result = { from: 0, to: 0 };
  fixture.editor!.state.doc.descendants((node, pos) => { if (node.isText && node.text?.includes(text)) result = { from: pos, to: pos + text.length }; });
  return result;
}
it.each(["keyboard", "pointer"])("applies captured formatting after asynchronous initialization via %s selection", async (input) => {
  await act(async () => root.render(<AppProvider><TiptapEditor note={note} onUpdate={vi.fn()} /></AppProvider>));
  expect(fixture.editor).not.toBeNull();
  expect(fixture.editor!.isInitialized).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(30));
  expect(fixture.editor!.isInitialized).toBe(true);
  act(() => fixture.editor!.view.dispatch(fixture.editor!.state.tr.setSelection(TextSelection.create(fixture.editor!.state.doc, range("源文字").from, range("源文字").to))));
  const painter = host.querySelector("svg.lucide-paintbrush")!.closest("button")!;
  expect(painter).toBeDefined();
  act(() => painter.click());
  expect(host.querySelector('[data-format-painter-active="true"]')).not.toBeNull();
  if (input === "pointer") act(() => fixture.editor!.view.dom.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  act(() => fixture.editor!.view.dispatch(fixture.editor!.state.tr.setSelection(TextSelection.create(fixture.editor!.state.doc, range("目标文字").from, range("目标文字").to))));
  if (input === "pointer") {
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(fixture.editor!.state.doc.nodeAt(range("目标文字").from)!.marks).toHaveLength(0);
    act(() => window.dispatchEvent(new Event("pointerup")));
  }
  await act(async () => vi.advanceTimersByTimeAsync(200));
  const target = fixture.editor!.state.doc.nodeAt(range("目标文字").from)!;
  expect(target.marks.map(mark => mark.type.name)).toContain("bold");
  expect(target.marks.find(mark => mark.type.name === "textStyle")?.attrs).toMatchObject({ color: "rgb(255, 0, 0)", fontSize: "24px" });
  expect(host.querySelector('[data-format-painter-active="true"]')).toBeNull();
});

it("cancels an armed painter with Escape without changing target text", async () => {
  await act(async () => root.render(<AppProvider><TiptapEditor note={note} onUpdate={vi.fn()} /></AppProvider>));
  await act(async () => vi.advanceTimersByTimeAsync(30));
  act(() => fixture.editor!.commands.setTextSelection(range("源文字")));
  act(() => host.querySelector("svg.lucide-paintbrush")!.closest("button")!.click());
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  act(() => fixture.editor!.commands.setTextSelection(range("目标文字")));
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(fixture.editor!.state.doc.nodeAt(range("目标文字").from)!.marks).toHaveLength(0);
  expect(host.querySelector('[data-format-painter-active="true"]')).toBeNull();
});
