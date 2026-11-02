import { Home } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions } from "@/store/AppContext";
import { useSiteSettings } from "@/hooks/useSiteSettings";

export function HomeButton({ compact = false }: { compact?: boolean }) {
  const { state } = useApp();
  const actions = useAppActions();
  const { siteConfig } = useSiteSettings();
  const { i18n } = useTranslation();
  const label = i18n.language.startsWith("zh") ? "返回首页" : "Go to home";
  return <button type="button" aria-label={label} title={label} onClick={() => {
    actions.setViewMode("home");
    actions.setEditorFullscreen(false);
    actions.setMobileSidebar(false);
    if (!state.sidebarCollapsed) actions.toggleSidebar();
  }} className={`${compact ? "h-10 w-10 shrink-0 justify-center" : "min-w-0 gap-2 px-1"} flex items-center rounded-md py-2 text-tx-primary hover:text-accent-primary`}>
    <Home size={17} className="shrink-0 text-accent-primary" />
    <span className={compact ? "sr-only" : "truncate text-sm font-semibold"}>{siteConfig.title || "nowen-note"}</span>
  </button>;
}
