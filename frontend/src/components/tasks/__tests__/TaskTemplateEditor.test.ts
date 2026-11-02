import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import { buildTemplateItems } from "../TaskTemplateEditor";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id || crypto.randomUUID(),
    userId: "user1",
    workspaceId: null,
    title: overrides.title || "Test task",
    description: overrides.description ?? "",
    isCompleted: overrides.isCompleted ?? 0,
    priority: overrides.priority ?? 2,
    dueDate: overrides.dueDate ?? null,
    dueAt: overrides.dueAt ?? null,
    noteId: null,
    projectId: null,
    status: "todo",
    parentId: overrides.parentId ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: "2026-01-01T00:00:00",
    updatedAt: "2026-01-01T00:00:00",
    ...overrides,
  };
}

describe("buildTemplateItems", () => {
  it("copies task descriptions into template items", () => {
    const task = makeTask({
      title: "Launch task",
      description: "Check build, smoke tests, and rollback notes.",
    });

    const items = buildTemplateItems(task, [task]);

    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Check build, smoke tests, and rollback notes.");
  });
});
