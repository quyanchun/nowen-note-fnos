import { useState } from "react";
import { ListTree, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ShareOutlineItem } from "@/lib/shareOutline";

interface ShareOutlineProps {
  items: ShareOutlineItem[];
  activeId?: string;
  onItemClick?: (id: string) => void;
}

export default function ShareOutline({ items, activeId, onItemClick }: ShareOutlineProps) {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (items.length === 0) return null;

  const handleItemClick = (id: string) => {
    onItemClick?.(id);
    setMobileOpen(false);
  };

  return (
    <>
      <aside className="hidden xl:block w-56 shrink-0">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
          <OutlineList
            title={t("share.outline.title")}
            items={items}
            activeId={activeId}
            onItemClick={handleItemClick}
          />
        </div>
      </aside>

      <div className="xl:hidden fixed right-4 bottom-5 z-20">
        <Button
          type="button"
          size="sm"
          className="h-9 rounded-full shadow-lg shadow-zinc-900/10 dark:shadow-black/30"
          onClick={() => setMobileOpen(true)}
          aria-label={t("share.outline.open")}
        >
          <ListTree size={15} className="mr-1.5" />
          {t("share.outline.title")}
        </Button>
      </div>

      {mobileOpen && (
        <div className="xl:hidden fixed inset-0 z-30">
          <button
            type="button"
            className="absolute inset-0 bg-zinc-950/35"
            aria-label={t("share.outline.close")}
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[70vh] rounded-t-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                <ListTree size={16} className="text-indigo-500" />
                {t("share.outline.title")}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setMobileOpen(false)}
                aria-label={t("share.outline.close")}
              >
                <X size={15} />
              </Button>
            </div>
            <div className="max-h-[calc(70vh-4.25rem)] overflow-y-auto">
              <OutlineItems items={items} activeId={activeId} onItemClick={handleItemClick} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function OutlineList({
  title,
  items,
  activeId,
  onItemClick,
}: {
  title: string;
  items: ShareOutlineItem[];
  activeId?: string;
  onItemClick: (id: string) => void;
}) {
  return (
    <nav className="border-l border-zinc-200 pl-3 dark:border-zinc-800" aria-label={title}>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
        <ListTree size={14} className="text-indigo-500" />
        {title}
      </div>
      <OutlineItems items={items} activeId={activeId} onItemClick={onItemClick} />
    </nav>
  );
}

function OutlineItems({
  items,
  activeId,
  onItemClick,
}: {
  items: ShareOutlineItem[];
  activeId?: string;
  onItemClick: (id: string) => void;
}) {
  return (
    <ol className="space-y-0.5">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onItemClick(item.id)}
            className={cn(
              "block w-full rounded-md px-2 py-1.5 text-left text-xs leading-snug transition-colors",
              "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100",
              item.level === 2 && "pl-4",
              item.level === 3 && "pl-7",
              item.level >= 4 && "pl-10",
              activeId === item.id &&
                "bg-indigo-500/10 font-medium text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300"
            )}
            title={item.text}
          >
            <span className="line-clamp-2 break-words">{item.text}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
