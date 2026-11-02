type DesktopRuntime = { nowenDesktop?: { isDesktop?: boolean; platform?: string } };

export function isMacDesktopWorkspace(
  runtime: DesktopRuntime | undefined = typeof window === "undefined" ? undefined : window as DesktopRuntime,
): boolean {
  return runtime?.nowenDesktop?.isDesktop === true && runtime.nowenDesktop.platform === "darwin";
}

export type WorkspaceNavigationTab = "directory" | "all" | "favorites";

export function workspaceNavigationTab(view: string): WorkspaceNavigationTab | null {
  if (view === "notebook") return "directory";
  if (view === "favorites") return "favorites";
  if (view === "all" || view === "tag") return "all";
  return null;
}

/** Match the shared desktop CSS breakpoint; narrow screens keep the drawer flow. */
export function usesUnifiedNoteNavigation(viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth): boolean {
  return viewportWidth >= 768;
}
