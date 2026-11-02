import AppSelect from "@/components/ui/AppSelect";
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, FileText, Trash2, Loader2, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { TaskEmptyState } from "./TaskEmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TaskTemplate, TaskProject } from "@/types";

interface TaskTemplatePickerProps {
  projects: TaskProject[];
  onClose: () => void;
  onApplied: () => void;
}

export function TaskTemplatePicker({ projects, onClose, onApplied }: TaskTemplatePickerProps) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>("");
  const [baseDate, setBaseDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [isApplying, setIsApplying] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await api.getTaskTemplates();
      setTemplates(data);
    } catch (err) {
      console.error("Failed to load templates:", err);
      toast.error(t("tasks.templates.failed"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteTaskTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      console.error("Failed to delete template:", err);
      toast.error(t("tasks.templates.failed"));
    }
  };

  const handleApply = async () => {
    if (!selectedId) return;
    setIsApplying(true);
    try {
      await api.applyTaskTemplate(selectedId, {
        projectId: projectId || null,
        baseDate: baseDate || null,
      });
      onApplied();
    } catch (err) {
      console.error("Failed to apply template:", err);
      toast.error(t("tasks.templates.failed"));
    } finally {
      setIsApplying(false);
    }
  };

  const selectedTemplate = templates.find((t) => t.id === selectedId);

  return (
    <motion.div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.97, opacity: 0, y: 4 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md rounded-xl border border-app-border bg-app-surface shadow-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
          <h3 className="text-base font-semibold text-tx-primary">{t("tasks.templates.title")}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-tx-tertiary hover:text-tx-primary hover:bg-app-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-tx-tertiary" />
            </div>
          ) : templates.length === 0 ? (
            <TaskEmptyState type="no-templates" compact />
          ) : (
            <div className="space-y-2">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => setSelectedId(tpl.id)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    selectedId === tpl.id
                      ? "border-accent-primary bg-accent-primary/5"
                      : "border-app-border hover:bg-app-hover"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-tx-tertiary shrink-0" />
                      <span className="text-sm font-medium text-tx-primary truncate">{tpl.name}</span>
                      <span className="text-xs text-tx-tertiary">{t("tasks.templates.itemCount", { count: tpl.items.length })}</span>
                    </div>
                    {tpl.description && (
                      <p className="text-xs text-tx-tertiary mt-1 truncate">{tpl.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDelete(tpl.id); }}
                    className="p-1.5 rounded-md text-tx-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
                    title={t("tasks.templates.deleteConfirm")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Options */}
          {selectedTemplate && (
            <div className="space-y-3 pt-2 border-t border-app-border">
              <div>
                <label className="block text-xs font-medium text-tx-secondary mb-1">
                  {t("tasks.templates.selectProject")}
                </label>
                <AppSelect
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full h-9 rounded-md border border-app-border bg-app-surface px-3 text-sm text-tx-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
                >
                  <option value="">{t("tasks.templates.selectProject")}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                  ))}
                </AppSelect>
              </div>
              <div>
                <label className="block text-xs font-medium text-tx-secondary mb-1">
                  {t("tasks.templates.baseDate")}
                </label>
                <Input
                  type="date"
                  value={baseDate}
                  onChange={(e) => setBaseDate(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-app-bg/40 border-t border-app-border">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={!selectedId || isApplying}
            onClick={handleApply}
          >
            {isApplying ? <Loader2 size={14} className="animate-spin mr-1" /> : <Check size={14} className="mr-1" />}
            {t("tasks.templates.use")}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
