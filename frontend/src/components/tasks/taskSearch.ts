import type { Task } from "@/types";

export function taskMatchesSearch(task: Pick<Task, "title" | "description">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    task.title.toLowerCase().includes(q) ||
    (task.description ?? "").toLowerCase().includes(q)
  );
}
