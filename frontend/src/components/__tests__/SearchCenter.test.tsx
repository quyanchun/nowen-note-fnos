import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  search: vi.fn(), scope: "owner:personal", load: vi.fn(),
  state: { viewMode: "search", searchQuery: "雨伞", sidebarCollapsed: true, sidebarWidth: 260, editorFullscreen: false, selectedNotebookId: null, notebooks: [] as any[] },
  actions: { setSearchQuery: vi.fn(), setViewMode: vi.fn(), setSelectedNotebook: vi.fn(), clearSelectedTags: vi.fn(), setMobileSidebar: vi.fn(), setMobileView: vi.fn() },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "zh-CN" } }) }));
vi.mock("@/store/AppContext", () => ({ useApp: () => ({ state: m.state }), useAppActions: () => m.actions }));
vi.mock("@/hooks/useNoteLoader", () => ({ useNoteLoader: () => ({ loadNote: m.load }) }));
vi.mock("@/lib/api", () => ({ api: { search: m.search } }));
vi.mock("@/lib/homeCapture", () => ({ getHomeCaptureScope: () => m.scope }));
vi.mock("@/components/SearchNotebookExclusionsPanel", () => ({ default: () => null }));
import SearchCenter from "../SearchCenter";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const base = { id: "a", title: "旅行清单", notebookId: "folder", resourceType: "note", snippetHtml: "带上<mark>雨伞</mark>", updatedAt: "2026-10-29", matchCount: 1, matchedField: "content" };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); m.scope = "owner:personal"; m.state.searchQuery = "雨伞";
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  Element.prototype.scrollIntoView = vi.fn();
  m.search.mockResolvedValue([]); m.load.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render() { await act(async () => root.render(<SearchCenter />)); }
async function wait() { await act(async () => { await vi.advanceTimersByTimeAsync(400); }); }
function type(value: string) {
  const el = document.querySelector<HTMLInputElement>('input[aria-label="搜索笔记标题与正文…"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("renders a dedicated page with highlighted snippets, semantic relevance and result navigation", async () => {
  m.search.mockResolvedValue([{ ...base, semanticRelevance: 0.81234, semanticDistance: 0.23, retrieval: "hybrid" }]);
  await render(); await wait();
  expect(m.search).toHaveBeenCalledWith("雨伞", expect.objectContaining({ semantic: true, signal: expect.any(AbortSignal) }));
  expect(document.querySelector('section[aria-label="搜索笔记"]')).not.toBeNull();
  expect(document.body.textContent).toContain("语义相关度 81.2%"); expect(document.querySelector("mark")?.textContent).toBe("雨伞");
  await act(async () => { document.querySelector<HTMLButtonElement>(".group")!.click(); });
  expect(m.load).toHaveBeenCalledWith(expect.objectContaining({ noteId: "a" }));
  expect(m.actions.setViewMode).toHaveBeenCalledWith("notebook");
});
it("does not invent a percentage for keyword-only results or keyword matches for vector-only results", async () => {
  m.search.mockResolvedValue([base, { ...base, id: "b", title: "出行准备", matchedField: "semantic", matchCount: 0, semanticRelevance: 0.5 }]);
  await render(); await wait();
  const cards = [...document.querySelectorAll("button.group")];
  expect(cards[0].textContent).not.toContain("%");
  expect(cards[1].textContent).toContain("语义命中"); expect(cards[1].textContent).not.toContain("个匹配项");
});
it("aborts old requests and ignores their results after a query or account change", async () => {
  let done!: (rows: any[]) => void;
  m.search.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  await render(); await wait(); const signal = m.search.mock.calls[0][1].signal;
  type("新查询"); expect(signal.aborted).toBe(true); await wait();
  await act(async () => done([{ ...base, title: "过期搜索内容" }]));
  expect(document.body.textContent).not.toContain("过期搜索内容");
  m.search.mockImplementationOnce(() => new Promise(resolve => { done = resolve; })); type("另一个查询"); await wait();
  m.scope = "another:workspace"; await render();
  await act(async () => done([{ ...base, title: "旧账号私密内容" }]));
  expect(document.body.textContent).not.toContain("旧账号私密内容");
});
it("clearing the query prevents a pending response from restoring old results", async () => {
  let done!: (rows: any[]) => void; m.search.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  await render(); await wait(); type("");
  await act(async () => done([base]));
  expect(document.body.textContent).not.toContain("旅行清单"); expect(document.body.textContent).toContain("输入关键词开始搜索");
});
it("removes keyboard instructions and selects results with arrows from both input and cards", async () => {
  m.search.mockResolvedValue([base, { ...base, id: "b", title: "另一条结果" }]);
  await render(); await wait();
  expect(document.body.textContent).not.toContain("↑↓"); expect(document.body.textContent).not.toContain("Enter 打开");
  const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索笔记标题与正文…"]')!;
  act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
  expect(document.querySelector('[aria-current="true"]')?.getAttribute("data-search-result")).toBe("b");
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  expect(m.load).toHaveBeenLastCalledWith(expect.objectContaining({ noteId: "b" }));
  const card = document.querySelector<HTMLButtonElement>('[data-search-result="b"]')!;
  act(() => { card.focus(); card.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })); });
  expect(document.activeElement?.getAttribute("data-search-result")).toBe("a");
  await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  expect(m.load).toHaveBeenLastCalledWith(expect.objectContaining({ noteId: "a" }));
});
it("does not use IME confirmation as a command to open a result", async () => {
  m.search.mockResolvedValue([base]); await render(); await wait();
  act(() => { document.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })); });
  expect(m.load).not.toHaveBeenCalled();
});
it("restores the search query, filters, sort, selection and scroll after opening a detail", async () => {
  const opened = vi.fn(); m.search.mockResolvedValue([base, { ...base, id: "b", title: "后一条", updatedAt: "2026-10-30" }]);
  await act(async () => root.render(<SearchCenter onOpenResult={opened} />)); await wait();
  act(() => { [...document.querySelectorAll("button")].find(el => el.textContent === "仅正文")!.click(); });
  act(() => { [...document.querySelectorAll("button")].find(el => el.textContent === "最近更新")!.click(); });
  const scroller = document.querySelector<HTMLElement>("[data-search-scroll]")!; scroller.scrollTop = 340;
  await act(async () => { document.querySelector<HTMLButtonElement>('[data-search-result="a"]')!.click(); });
  const session = opened.mock.calls[0][1];
  expect(session).toMatchObject({ query: "雨伞", filter: "content", sortMode: "recent", scrollTop: 340 });
  act(() => root.unmount()); root = createRoot(host); m.search.mockClear();
  await act(async () => root.render(<SearchCenter session={session} />)); await wait();
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("雨伞");
  expect(document.querySelector<HTMLElement>("[data-search-scroll]")!.scrollTop).toBe(340);
  expect(document.querySelector("[data-search-result]")?.getAttribute("data-search-result")).toBe("b");
  expect(m.search).not.toHaveBeenCalled();
});
it("searches again after clearing a restored search and reentering its old query", async () => {
  await act(async () => root.render(<SearchCenter session={{ query: "雨伞", results: [base] as any, filter: "all", sortMode: "relevance", activeIndex: 0, includeExcluded: false, scrollTop: 0 }} />));
  await wait(); expect(m.search).not.toHaveBeenCalled();
  type(""); type("雨伞"); await wait(); expect(m.search).toHaveBeenCalledOnce();
});
it("does not open a result from an earlier account before the next render", async () => {
  m.search.mockResolvedValue([base]); await render(); await wait(); m.scope = "another:personal";
  await act(async () => { document.querySelector<HTMLButtonElement>("[data-search-result]")!.click(); });
  expect(m.load).not.toHaveBeenCalled();
});
it("renders one result list even when a legacy sidebar slot exists", async () => {
  const slot = document.createElement("aside"); slot.setAttribute("data-search-sidebar", ""); document.body.append(slot);
  try {
    m.search.mockResolvedValue([base, { ...base, id: "b", title: "仅标题", matchedField: "title", updatedAt: "2026-10-30" }]);
    await render(); await wait();
    expect(m.search).toHaveBeenCalledOnce(); expect(slot.childElementCount).toBe(0);
    const main = document.querySelector('section[aria-label="搜索笔记"]')!;
    expect(document.querySelectorAll('[data-search-result]')).toHaveLength(2);
    expect(main.className).toContain('flex-1'); expect(main.className).not.toContain('fixed');
    act(() => { [...main.querySelectorAll("button")].find(el => el.textContent === "最近更新")!.click(); });
    expect(main.querySelector('[data-search-result]')?.getAttribute('data-search-result')).toBe('b');
    act(() => { [...main.querySelectorAll("button")].find(el => el.textContent === "仅正文")!.click(); });
    expect(document.querySelectorAll('[data-search-result]')).toHaveLength(1);
    await act(async () => { main.querySelector<HTMLButtonElement>('[data-search-result]')!.click(); });
    expect(m.load).toHaveBeenLastCalledWith(expect.objectContaining({ noteId: 'a' }));
  } finally { slot.remove(); }
});
