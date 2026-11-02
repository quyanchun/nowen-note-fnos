import AppSelect from "@/components/ui/AppSelect";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Link2 } from "lucide-react";
import type { Task, TaskDependency } from "../../types";
import { wouldCreateCycle } from "./taskDependencyUtils";

interface Props {
  task: Task;
  allTasks: Task[];
  dependencies: TaskDependency[];
  onCreateDependency: (predecessorTaskId: string, successorTaskId: string) => Promise<void>;
  onDeleteDependency: (id: string) => Promise<void>;
}

export function TaskDependencyEditor({ task, allTasks, dependencies, onCreateDependency, onDeleteDependency }: Props) {
  const { t } = useTranslation();
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Current task's predecessors
  const predecessors = useMemo(
    () => dependencies.filter((d) => d.successorTaskId === task.id),
    [dependencies, task.id]
  );

  // Current task's successors
  const successors = useMemo(
    () => dependencies.filter((d) => d.predecessorTaskId === task.id),
    [dependencies, task.id]
  );

  // Tasks available to add as predecessor (exclude self, existing deps, different scope)
  const availableTasks = useMemo(() => {
    const existingPredIds = new Set(predecessors.map((d) => d.predecessorTaskId));
    return allTasks.filter((t) => {
      if (t.id === task.id) return false;
      if (existingPredIds.has(t.id)) return false;
      // Same scope check
      if (t.workspaceId !== task.workspaceId) return false;
      if (!task.workspaceId && t.userId !== task.userId) return false;
      return true;
    });
  }, [allTasks, task, predecessors]);

  const handleAdd = async () => {
    if (!selectedTaskId) return;
    setError(null);

    // Frontend cycle check
    if (wouldCreateCycle(dependencies, selectedTaskId, task.id)) {
      setError(t("tasks.dependencies.cycleError"));
      return;
    }

    setIsCreating(true);
    try {
      await onCreateDependency(selectedTaskId, task.id);
      setSelectedTaskId("");
    } catch (e: any) {
      if (e?.code === "DEPENDENCY_CYCLE") {
        setError(t("tasks.dependencies.cycleError"));
      } else {
        setError(e?.message || "Failed");
      }
    } finally {
      setIsCreating(false);
    }
  };

  const getTaskTitle = (taskId: string) => {
    const found = allTasks.find((t) => t.id === taskId);
    return found?.title || taskId;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-tx-primary">
        <Link2 size={14} />
        {t("tasks.dependencies.title")}
      </div>

      {/* Blocked by (predecessors) */}
      {predecessors.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-tx-secondary">{t("tasks.dependencies.blockedBy")}</div>
          {predecessors.map((dep) => (
            <div key={dep.id} className="flex items-center justify-between px-2 py-1 rounded bg-app-bg text-sm">
              <span className="truncate">{getTaskTitle(dep.predecessorTaskId)}</span>
              <button
                onClick={() => onDeleteDependency(dep.id)}
                className="p-0.5 hover:text-red-500 text-tx-tertiary"
                title={t("tasks.dependencies.delete")}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Blocks (successors) */}
      {successors.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-tx-secondary">{t("tasks.dependencies.blocks")}</div>
          {successors.map((dep) => (
            <div key={dep.id} className="flex items-center justify-between px-2 py-1 rounded bg-app-bg text-sm">
              <span className="truncate">{getTaskTitle(dep.successorTaskId)}</span>
              <button
                onClick={() => onDeleteDependency(dep.id)}
                className="p-0.5 hover:text-red-500 text-tx-tertiary"
                title={t("tasks.dependencies.delete")}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {predecessors.length === 0 && successors.length === 0 && (
        <div className="text-xs text-tx-tertiary">{t("tasks.dependencies.noDependencies")}</div>
      )}

      {/* Add predecessor */}
      {availableTasks.length > 0 && (
        <div className="flex items-center gap-1">
          <AppSelect
            value={selectedTaskId}
            onChange={(e) => { setSelectedTaskId(e.target.value); setError(null); }}
            className="flex-1 px-2 py-1 text-xs rounded border border-app-border bg-app-bg text-tx-primary"
          >
            <option value="">{t("tasks.dependencies.selectTask")}</option>
            {availableTasks.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </AppSelect>
          <button
            onClick={handleAdd}
            disabled={!selectedTaskId || isCreating}
            className="px-2 py-1 text-xs rounded bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50"
          >
            <Plus size={12} />
          </button>
        </div>
      )}

      {error && <div className="text-xs text-red-500">{error}</div>}
    </div>
  );
}
