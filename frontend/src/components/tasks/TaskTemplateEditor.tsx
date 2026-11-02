import React, { useState, useCallback } from "react";
import { Loader2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Task, TaskTemplateItem } from "@/types";

interface TaskTemplateEditorProps {
  task: Task;
  allTasks?: Task[];
  onSaved?: () => void;
}

/**
 * Convert a task tree (task + children from allTasks) into TaskTemplateItem[].
 * Uses the task's dueDate as the base and computes relativeDueDays for each item.
 */
export function buildTemplateItems(task: Task, allTasks: Task[]): TaskTemplateItem[] {
  const items: TaskTemplateItem[] = [];
  const baseDate = task.dueDate ? new Date(task.dueDate) : null;

  const addTask = (t: Task, parentIndex: number | null) => {
    const index = items.length;
    let relativeDueDays: number | null = null;
    if (baseDate && t.dueDate) {
      const taskDate = new Date(t.dueDate);
      relativeDueDays = Math.round((taskDate.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24));
    }
    items.push({
      title: t.title,
      description: t.description ?? "",
      priority: t.priority,
      relativeDueDays,
      parentIndex,
      sortOrder: t.sortOrder,
    });
    // Find children
    const children = allTasks.filter((c) => c.parentId === t.id);
    children.forEach((child) => addTask(child, index));
  };

  addTask(task, null);
  return items;
}

export function TaskTemplateEditor({ task, allTasks = [], onSaved }: TaskTemplateEditorProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const items = buildTemplateItems(task, allTasks);
      await api.createTaskTemplate({
        name: name.trim(),
        description: description.trim() || undefined,
        items,
      });
      setName("");
      setDescription("");
      setIsOpen(false);
      onSaved?.();
    } catch (err) {
      console.error("Failed to save template:", err);
      toast.error(t("tasks.templates.failed"));
    } finally {
      setIsSaving(false);
    }
  }, [name, description, task, allTasks, onSaved]);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-tx-tertiary hover:text-accent-primary hover:bg-accent-primary/5 rounded-md transition-colors"
      >
        <Save size={13} />
        {t("tasks.templates.saveCurrent")}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-app-border bg-app-elevated/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Save size={14} className="text-tx-tertiary" />
        <span className="text-sm font-medium text-tx-primary">{t("tasks.templates.saveCurrent")}</span>
      </div>
      <Input
        placeholder={t("tasks.templates.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        placeholder={t("tasks.templates.description")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex items-center gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={() => setIsOpen(false)}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" disabled={!name.trim() || isSaving} onClick={handleSave}>
          {isSaving && <Loader2 size={14} className="animate-spin mr-1" />}
          {t("tasks.templates.create")}
        </Button>
      </div>
    </div>
  );
}
