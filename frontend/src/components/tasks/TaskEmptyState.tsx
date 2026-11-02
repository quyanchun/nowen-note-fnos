import React from "react";
import { Inbox, Search, CalendarDays, FileText, BellOff, Link2, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type TaskEmptyStateType =
  | "no-tasks"
  | "no-search"
  | "no-scheduled"
  | "no-templates"
  | "no-reminders"
  | "no-dependencies"
  | "no-projects";

interface TaskEmptyStateProps {
  type: TaskEmptyStateType;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

const ICONS: Record<TaskEmptyStateType, React.ReactNode> = {
  "no-tasks": <Inbox size={36} />,
  "no-search": <Search size={36} />,
  "no-scheduled": <CalendarDays size={36} />,
  "no-templates": <FileText size={36} />,
  "no-reminders": <BellOff size={36} />,
  "no-dependencies": <Link2 size={36} />,
  "no-projects": <FolderOpen size={36} />,
};

const COMPACT_ICONS: Record<TaskEmptyStateType, React.ReactNode> = {
  "no-tasks": <Inbox size={24} />,
  "no-search": <Search size={24} />,
  "no-scheduled": <CalendarDays size={24} />,
  "no-templates": <FileText size={24} />,
  "no-reminders": <BellOff size={24} />,
  "no-dependencies": <Link2 size={24} />,
  "no-projects": <FolderOpen size={24} />,
};

export function TaskEmptyState({ type, title, description, actionLabel, onAction, compact }: TaskEmptyStateProps) {
  const { t } = useTranslation();

  const resolvedTitle = title || t(`tasks.empty.${type}.title`);
  const resolvedDescription = description || t(`tasks.empty.${type}.description`);
  const resolvedAction = actionLabel || t(`tasks.empty.${type}.action`, { defaultValue: "" });

  return (
    <div className={cn(
      "flex flex-col items-center justify-center text-tx-tertiary",
      compact ? "py-6 px-4" : "py-12 px-4"
    )}>
      <div className="mb-3 opacity-40">
        {compact ? COMPACT_ICONS[type] : ICONS[type]}
      </div>
      <span className={cn("text-center font-medium", compact ? "text-xs" : "text-sm")}>
        {resolvedTitle}
      </span>
      {resolvedDescription && (
        <span className={cn("text-center mt-1 max-w-[280px]", compact ? "text-[11px]" : "text-xs")}>
          {resolvedDescription}
        </span>
      )}
      {resolvedAction && onAction && (
        <button
          type="button"
          onClick={onAction}
          className={cn(
            "mt-3 px-3 py-1.5 rounded-md text-white bg-accent-primary hover:bg-accent-primary/90 transition-colors",
            compact ? "text-[11px]" : "text-xs"
          )}
        >
          {resolvedAction}
        </button>
      )}
    </div>
  );
}
