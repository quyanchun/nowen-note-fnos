import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ state: { sidebarCollapsed: false, mobileSidebarOpen: false }, actions: { setViewMode: vi.fn(), setEditorFullscreen: vi.fn(), setMobileSidebar: vi.fn(), toggleSidebar: vi.fn() } }));
vi.mock("@/store/AppContext", () => ({ useApp: () => ({ state: m.state }), useAppActions: () => m.actions }));
vi.mock("@/hooks/useSiteSettings", () => ({ useSiteSettings: () => ({ siteConfig: { title: "nowen-note" } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }) }));
vi.mock("@/lib/aiCollaboration", () => ({ openAICollaboration: vi.fn() }));
import { HomeButton } from "../AppHeader";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let host: HTMLDivElement;
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); m.state.sidebarCollapsed = false; });
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("brand goes home through normal navigation actions and collapses menus", () => {
  act(() => root.render(<HomeButton />));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="返回首页"]')!.click());
  expect(m.actions.setViewMode).toHaveBeenCalledWith("home"); expect(m.actions.toggleSidebar).toHaveBeenCalledOnce(); expect(m.actions.setMobileSidebar).toHaveBeenCalledWith(false);
});
it("compact brand still goes home when the directory is hidden", () => {
  m.state.sidebarCollapsed = true; act(() => root.render(<HomeButton compact />));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="返回首页"]')!.click());
  expect(m.actions.setViewMode).toHaveBeenCalledWith("home");
  expect(m.actions.toggleSidebar).not.toHaveBeenCalled();
  expect(host.querySelector("span")!.className).toBe("sr-only");
});
