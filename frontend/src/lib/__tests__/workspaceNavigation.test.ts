import { describe, expect, it } from "vitest";
import { isMacDesktopWorkspace, usesUnifiedNoteNavigation, workspaceNavigationTab } from "../workspaceNavigation";

describe("Shared navigation and Mac menu boundary", () => {
  it("only applies the fixed wider menu to the native Mac bridge", () => {
    expect(isMacDesktopWorkspace({ nowenDesktop: { isDesktop: true, platform: "darwin" } })).toBe(true);
    for (const runtime of [{}, { nowenDesktop: { platform: "darwin" } }, { nowenDesktop: { isDesktop: true, platform: "win32" } }, { nowenDesktop: { isDesktop: true, platform: "linux" } }]) expect(isMacDesktopWorkspace(runtime)).toBe(false);
  });
  it.each([["notebook", "directory"], ["all", "all"], ["favorites", "favorites"], ["tag", "all"]])("keeps %s inside the shared navigation panel", (view, tab) => {
    expect(workspaceNavigationTab(view)).toBe(tab);
  });
  it.each(["search", "home", "tasks", "files", "mindmaps", "ai-chat", "shares", "diary", "trash", "issues"])("hides the whole panel in %s", view => expect(workspaceNavigationTab(view)).toBeNull());
});

it.each([768, 1024, 1600])("shares desktop navigation at %spx without depending on the OS", width => {
  expect(usesUnifiedNoteNavigation(width)).toBe(true);
});
it.each([375, 600, 767])("keeps the drawer navigation at %spx", width => {
  expect(usesUnifiedNoteNavigation(width)).toBe(false);
});
