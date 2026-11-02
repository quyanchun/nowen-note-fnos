import { useRailMode } from "@/hooks/useRailMode";
import { useId } from "react";
import { Files, FolderTree, PanelLeft, PanelLeftClose, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/Sidebar";
import NoteList from "@/components/NoteList";
import { HomeButton } from "@/components/AppHeader";
import { useApp, useAppActions } from "@/store/AppContext";
import { isMacDesktopWorkspace, usesUnifiedNoteNavigation, workspaceNavigationTab, type WorkspaceNavigationTab } from "@/lib/workspaceNavigation";

export default function WorkspaceSidebar() {
  const { state } = useApp();
  const actions = useAppActions();
  const { i18n } = useTranslation();
  const id = useId();
  const [railMode] = useRailMode();
  const active = workspaceNavigationTab(state.viewMode);
  if (!usesUnifiedNoteNavigation() || !active || state.editorFullscreen) return null;
  const zh = i18n.language.startsWith("zh");
  const tabs = [
    { id: "directory", label: zh ? "目录" : "Directory", icon: FolderTree },
    { id: "all", label: zh ? "所有笔记" : "All notes", icon: Files },
    { id: "favorites", label: zh ? "收藏" : "Favorites", icon: Star },
  ] as const;
  const select = (tab: WorkspaceNavigationTab) => {
    actions.clearSelectedTags();
    actions.setSearchQuery("");
    if (tab !== "directory") actions.setSelectedNotebook(null);
    actions.setViewMode(tab === "directory" ? "notebook" : tab);
  };

  if (state.sidebarCollapsed) return <button type="button" data-workspace-panel="collapsed" onClick={actions.toggleSidebar} aria-label={zh ? "展开导航面板" : "Expand navigation panel"} title={zh ? "展开导航面板" : "Expand navigation panel"} aria-expanded={false} style={{ left: "calc(var(--workspace-rail-width, 0px) + 8px)" }} className="workspace-navigation-restore fixed top-2 z-40 flex h-8 w-8 items-center justify-center rounded-lg border border-app-border bg-app-elevated/95 text-tx-secondary shadow-sm backdrop-blur-sm hover:bg-app-hover"><PanelLeft size={16} /></button>;

  return <aside data-workspace-panel="expanded" className="workspace-sidebar vibrancy-sidebar flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-r border-app-border bg-app-sidebar" style={{ width: state.sidebarWidth }}>
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 px-3">
      <HomeButton />
      {railMode === "hidden" && !isMacDesktopWorkspace() && <div data-note-workspace-layout-anchor="" className="h-7 w-7 shrink-0" />}
      <button type="button" onClick={actions.toggleSidebar} aria-label={zh ? "收起导航面板" : "Collapse navigation panel"} title={zh ? "收起导航面板" : "Collapse navigation panel"} aria-expanded={true} className="shrink-0 rounded-md p-1.5 text-tx-secondary hover:bg-app-hover"><PanelLeftClose size={16} /></button>
    </header>
    <div role="tablist" aria-label={zh ? "笔记导航" : "Note navigation"} className="flex shrink-0 gap-1 border-y border-app-border px-2 py-2">
      {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`${id}-${tab.id}`} aria-controls={`${id}-panel`} aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1} onClick={() => select(tab.id)} onKeyDown={event => {
        const target = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (target === null) return;
        event.preventDefault();
        select(tabs[target].id);
        document.getElementById(`${id}-${tabs[target].id}`)?.focus();
      }} className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-xs transition-colors ${active === tab.id ? "bg-accent-primary/10 font-medium text-accent-primary" : "text-tx-secondary hover:bg-app-hover"}`}><tab.icon size={14} className="shrink-0" /><span className="truncate">{tab.label}</span></button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${active}`} className="min-h-0 min-w-0 flex-1 overflow-hidden">
      {active === "directory" ? <Sidebar variant="desktop" embedded /> : <NoteList />}
    </div>
  </aside>;
}
