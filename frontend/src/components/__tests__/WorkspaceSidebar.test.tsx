import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  state: { viewMode: "all", sidebarCollapsed: false, sidebarWidth: 280, editorFullscreen: false, activeNote: { id: "keep-active" } },
  actions: { setViewMode: vi.fn(), clearSelectedTags: vi.fn(), setSearchQuery: vi.fn(), setSelectedNotebook: vi.fn(), toggleSidebar: vi.fn() },
}));
vi.mock("@/store/AppContext", () => ({ useApp: () => ({ state: m.state }), useAppActions: () => m.actions }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "zh-CN" } }) }));
vi.mock("@/components/Sidebar", () => ({ default: ({ embedded }: { embedded: boolean }) => <div data-testid="tree" data-embedded={embedded}>Directory tree</div> }));
vi.mock("@/components/NoteList", () => ({ default: () => <div data-testid="list">Note list</div> }));
vi.mock("@/components/AppHeader", () => ({ HomeButton: () => <button aria-label="返回首页">Home</button> }));
import WorkspaceSidebar from "../WorkspaceSidebar";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(m.state, { viewMode: "all", sidebarCollapsed: false, editorFullscreen: false });
  (window as any).nowenDesktop = { isDesktop: true, platform: "darwin" };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as any).nowenDesktop; });
function render() { act(() => root.render(<WorkspaceSidebar />)); }
it.each([["notebook", "tree"], ["all", "list"], ["favorites", "list"]])("mounts just one shared pane for %s", (view, child) => {
  m.state.viewMode = view; render();
  expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
  expect(host.querySelector(`[data-testid="${child}"]`)).not.toBeNull();
  expect(host.querySelectorAll('[data-testid="tree"], [data-testid="list"]')).toHaveLength(1);
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3);
});
it("switches scopes without changing the open note or creating another column", () => {
  render(); const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  act(() => tabs[2].click());
  expect(m.actions.setViewMode).toHaveBeenCalledWith("favorites");
  expect(m.actions.clearSelectedTags).toHaveBeenCalledOnce(); expect(m.actions.setSearchQuery).toHaveBeenCalledWith("");
  expect(m.state.activeNote.id).toBe("keep-active");
  act(() => tabs[0].click()); expect(m.actions.setViewMode).toHaveBeenCalledWith("notebook");
});
it("collapses and restores from the panel itself", () => {
  render(); act(() => host.querySelector<HTMLButtonElement>('[aria-label="收起导航面板"]')!.click());
  expect(m.actions.toggleSidebar).toHaveBeenCalledOnce(); expect(m.actions.setViewMode).not.toHaveBeenCalled();
  m.state.sidebarCollapsed = true; render();
  expect(host.querySelector('[role="tabpanel"]')).toBeNull();
  expect(host.firstElementChild?.tagName).toBe("BUTTON");
  expect(host.firstElementChild?.classList.contains("fixed")).toBe(true);
  expect(host.querySelector("aside")).toBeNull();
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="展开导航面板"]')!.click());
  expect(m.actions.toggleSidebar).toHaveBeenCalledTimes(2);
});
it("supports arrow keys across the three tabs", () => {
  render(); const selected = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
  act(() => selected.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(m.actions.setViewMode).toHaveBeenCalledWith("favorites");
  expect(document.activeElement?.textContent).toBe("收藏");
});
it.each(["home", "files", "tasks", "ai-chat", "mindmaps", "diary", "trash", "shares"])("has no second column in %s", view => {
  m.state.viewMode = view; render(); expect(host.childElementCount).toBe(0);
});
it.each(["win32", "linux", undefined])("shares the same second-column layout with %s clients", platform => {
  (window as any).nowenDesktop = platform ? { isDesktop: true, platform } : undefined;
  render(); expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
});

it("leaves narrow-screen navigation in the existing drawer", () => {
  const width = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 767 });
  try { render(); expect(host.childElementCount).toBe(0); }
  finally { Object.defineProperty(window, "innerWidth", { configurable: true, value: width }); }
});
