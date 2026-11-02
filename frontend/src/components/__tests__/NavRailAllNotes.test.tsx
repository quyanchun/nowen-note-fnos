import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_PREFERENCES } from "@/lib/userPreferenceAccountCache";
import NavRail from "../NavRail";

const mock = vi.hoisted(() => ({
  state: { viewMode: "tasks", selectedNotebookId: null as string | null, selectedTagIds: [] as string[], searchQuery: "", noteListCollapsed: true, sidebarCollapsed: false },
  actions: {
    setViewMode: vi.fn(), setSelectedNotebook: vi.fn(), clearSelectedTags: vi.fn(),
    setSearchQuery: vi.fn(), setMobileView: vi.fn(), setMobileSidebar: vi.fn(),
    toggleNoteListCollapsed: vi.fn(), setEditorFullscreen: vi.fn(), toggleSidebar: vi.fn(),
  },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/store/AppContext", () => ({ useApp: () => ({ state: mock.state }), useAppActions: () => mock.actions }));
vi.mock("@/hooks/useUserPreferences", () => ({ useUserPreferences: () => ({ prefs: DEFAULT_USER_PREFERENCES }) }));
vi.mock("@/hooks/useRailMode", () => ({ useRailMode: () => ["label"] }));
vi.mock("@/hooks/useSidebarTextStyle", () => ({ useSidebarTextStyle: () => ["classic"] }));
vi.mock("@/hooks/useMobileRailHidden", () => ({ useMobileRailHidden: () => [false, vi.fn()] }));
vi.mock("@/lib/api", () => ({ api: {}, getCurrentWorkspace: () => "personal", getServerUrl: () => "", broadcastLogout: vi.fn(), clearServerUrl: vi.fn() }));
vi.mock("@/lib/desktopBridge", () => ({ isDesktop: () => false, getAppInfo: vi.fn(), getDiagnosticsInfo: vi.fn(), clearDesktopLocalAuth: vi.fn(), switchDesktopToFull: vi.fn() }));
vi.mock("@/lib/offlineQueue", () => ({ clearQueue: vi.fn(), clearLocalIdMap: vi.fn(), getQueueLength: () => 0 }));
vi.mock("@/lib/accountLoginHistory", () => ({ isAccountLoginHistorySupported: () => false }));
vi.mock("@/components/AccountLoginHistory", () => ({ AccountLoginHistoryDialog: () => null }));

vi.mock("@/components/AppHeader", () => ({ HomeButton: () => <button aria-label="返回首页">Home</button> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); window.history.replaceState({}, "", "/");
  Object.assign(mock.state, { viewMode: "tasks", selectedNotebookId: null, selectedTagIds: [], searchQuery: "", noteListCollapsed: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render(variant: "desktop" | "mobile" = "desktop") { await act(async () => root.render(<NavRail variant={variant} />)); }
function entry() { return host.querySelector<HTMLButtonElement>('[aria-label="sidebar.allNotes"]')!; }

describe("All Notes primary navigation", () => {
  it("is the fixed entry with favorites only inside the second column", async () => {
    await render();
    expect(entry()).not.toBeNull();
    expect(entry().textContent).toBe("sidebar.allNotes");
    expect(host.querySelector('[aria-label="sidebar.favorites"]')).toBeNull();
  });

  it.each(["tasks", "files", "ai-chat", "notebook", "search"])("opens the directory from %s with filters cleared and the list expanded", async mode => {
    Object.assign(mock.state, { viewMode: mode, selectedNotebookId: "folder-1", selectedTagIds: ["tag-1"], searchQuery: "keyword" });
    localStorage.setItem("nowen-note-workspace-layout", "standard");
    await render(); expect(entry()).not.toBeNull();
    act(() => entry().click());
    expect(mock.actions.setViewMode).toHaveBeenCalledWith("notebook");
    expect(mock.actions.setSelectedNotebook).toHaveBeenCalledWith(null);
    expect(mock.actions.clearSelectedTags).toHaveBeenCalledOnce();
    expect(mock.actions.setSearchQuery).toHaveBeenCalledWith("");
    expect(mock.actions.toggleNoteListCollapsed).toHaveBeenCalledOnce();
    expect(localStorage.getItem("nowen-note-workspace-layout")).toBe("standard");
  });

  it("keeps All Notes selected for filters inside the unified workspace", async () => {
    mock.state.viewMode = "all";
    await render(); expect(entry()?.getAttribute("aria-current")).toBe("page");
    for (const patch of [{ selectedNotebookId: "folder-1" }, { selectedTagIds: ["tag-1"] }, { searchQuery: "keyword" }]) {
      Object.assign(mock.state, { selectedNotebookId: null, selectedTagIds: [], searchQuery: "" }, patch);
      await render(); expect(entry()?.getAttribute("aria-current")).toBe("page");
    }
  });

  it("opens the mobile list and closes the drawer without changing desktop layout", async () => {
    localStorage.setItem("nowen-note-workspace-layout", "standard");
    await render("mobile"); expect(entry()).not.toBeNull();
    act(() => entry().click());
    expect(mock.actions.setViewMode).toHaveBeenCalledWith("all");
    expect(mock.actions.setMobileView).toHaveBeenCalledWith("list");
    expect(mock.actions.setMobileSidebar).toHaveBeenCalledWith(false);
    expect(mock.actions.toggleNoteListCollapsed).not.toHaveBeenCalled();
    expect(localStorage.getItem("nowen-note-workspace-layout")).toBe("standard");
  });
});

 it.each(["home", "notebook", "all", "tasks"])("keeps one directory toggle separate from layout settings in %s", async mode => {
  mock.state.viewMode = mode;
  await render();
  const toggles = host.querySelectorAll<HTMLButtonElement>('[data-directory-toggle]');
  expect(toggles).toHaveLength(0);
  expect(host.querySelector('[data-note-workspace-layout-anchor]')).not.toBeNull();
 });
 it.each(["home", "all", "tasks"])("keeps Home visible in %s with the directory expanded or collapsed", async mode => {
  mock.state.viewMode = mode;
  for (const collapsed of [false, true]) {
    mock.state.sidebarCollapsed = collapsed;
    await render();
    expect(host.querySelectorAll('[aria-label="返回首页"]')).toHaveLength(1);
  }
  mock.state.sidebarCollapsed = false;
 });

it("native Mac keeps labeled menu wider and moves collapse/layout controls out of the menu", async () => {
  (window as any).nowenDesktop = { isDesktop: true, platform: "darwin" }; mock.state.sidebarCollapsed = true;
  try {
    await render();
    expect(host.firstElementChild?.classList.contains("w-[70px]")).toBe(true);
    expect(host.querySelector('[data-directory-toggle]')).toBeNull();
    expect(host.querySelector('[data-note-workspace-layout-anchor]')).toBeNull();
    act(() => entry().click()); expect(mock.actions.toggleSidebar).toHaveBeenCalledOnce();
  } finally { delete (window as any).nowenDesktop; mock.state.sidebarCollapsed = false; }
});

it.each(["all", "favorites", "notebook", "ai-chat", "files"])("Mac removes duplicate favorite and standalone quick capture entries in %s", async mode => {
  (window as any).nowenDesktop = { isDesktop: true, platform: "darwin" }; mock.state.viewMode = mode;
  try {
    await render();
    expect(host.querySelector('[aria-label="sidebar.favorites"]')).toBeNull();
    expect(host.querySelector('[aria-label="aiCollaboration.entry"]')).toBeNull();
    expect(entry().getAttribute("aria-current")).toBe(["all", "favorites", "notebook"].includes(mode) ? "page" : null);
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  } finally { delete (window as any).nowenDesktop; }
});

it.each(["win32", undefined])("%s shares the Mac navigation behavior without the Mac width", async platform => {
  (window as any).nowenDesktop = platform ? { isDesktop: true, platform } : undefined;
  mock.state.viewMode = "favorites";
  try {
    await render();
    expect(host.querySelector('[aria-label="sidebar.favorites"]')).toBeNull();
    expect(entry().getAttribute("aria-current")).toBe("page");
    expect(host.firstElementChild?.classList.contains("w-16")).toBe(true);
    expect(host.querySelector('[aria-label="aiCollaboration.entry"]')).toBeNull();
  } finally { delete (window as any).nowenDesktop; }
});
