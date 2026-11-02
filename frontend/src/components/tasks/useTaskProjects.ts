import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { TaskProject } from "@/types";

export function useTaskProjects() {
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    try {
      const data = await api.getTaskProjects();
      setProjects(data);
    } catch (err) {
      console.error("Failed to load projects:", err);
      toast.error("Failed to load projects");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const createProject = useCallback(async (name: string, icon?: string, color?: string) => {
    try {
      const p = await api.createTaskProject({ name, icon, color });
      setProjects((prev) => [...prev, p]);
      return p;
    } catch (err) {
      console.error("Failed to create project:", err);
      toast.error("Failed to create project");
      return null;
    }
  }, []);

  const updateProject = useCallback(async (id: string, data: Partial<TaskProject>) => {
    try {
      const p = await api.updateTaskProject(id, data);
      setProjects((prev) => prev.map((x) => (x.id === id ? p : x)));
      return p;
    } catch (err) {
      console.error("Failed to update project:", err);
      toast.error("Failed to update project");
      return null;
    }
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    try {
      await api.deleteTaskProject(id);
      setProjects((prev) => prev.filter((x) => x.id !== id));
      if (selectedProjectId === id) setSelectedProjectId(null);
    } catch (err) {
      console.error("Failed to delete project:", err);
      toast.error("Failed to delete project");
    }
  }, [selectedProjectId]);

  // Refresh task counts (call after task CRUD)
  const refreshCounts = useCallback(async () => {
    try {
      const data = await api.getTaskProjects();
      setProjects(data);
    } catch {
      // ignore
    }
  }, []);

  return {
    projects,
    selectedProjectId,
    setSelectedProjectId,
    isLoading,
    createProject,
    updateProject,
    deleteProject,
    refreshCounts,
    reload: loadProjects,
  };
}
