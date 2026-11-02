import { describe, it, expect } from "vitest";
import { wouldCreateCycle, buildTaskRowIndex, getDependencyLinePoints, getBlockingDependencies, isTaskBlockedByDependency, getDependencyScheduleWarnings } from "../taskDependencyUtils";
import { resizeTaskDateRange } from "../taskGanttUtils";
import type { TaskDependency } from "../../../types";

function dep(pre: string, suc: string): TaskDependency {
  return {
    id: `${pre}->${suc}`,
    userId: "u1",
    workspaceId: null,
    predecessorTaskId: pre,
    successorTaskId: suc,
    type: "finish_to_start",
    createdAt: "",
    updatedAt: "",
  };
}

describe("wouldCreateCycle", () => {
  it("A -> B is not a cycle", () => {
    expect(wouldCreateCycle([dep("A", "B")], "A", "B")).toBe(false);
  });

  it("A -> B, then B -> A would be a cycle", () => {
    expect(wouldCreateCycle([dep("A", "B")], "B", "A")).toBe(true);
  });

  it("A -> B -> C, then C -> A would be a cycle", () => {
    const deps = [dep("A", "B"), dep("B", "C")];
    expect(wouldCreateCycle(deps, "C", "A")).toBe(true);
  });

  it("unrelated chain does not cycle", () => {
    const deps = [dep("A", "B"), dep("C", "D")];
    expect(wouldCreateCycle(deps, "A", "D")).toBe(false);
  });

  it("self dependency is always a cycle", () => {
    expect(wouldCreateCycle([], "A", "A")).toBe(true);
  });

  it("empty dependencies never cycle", () => {
    expect(wouldCreateCycle([], "A", "B")).toBe(false);
  });

  it("deep chain A->B->C->D, then D->A cycles", () => {
    const deps = [dep("A", "B"), dep("B", "C"), dep("C", "D")];
    expect(wouldCreateCycle(deps, "D", "A")).toBe(true);
  });

  it("deep chain A->B->C->D, then D->B cycles", () => {
    const deps = [dep("A", "B"), dep("B", "C"), dep("C", "D")];
    expect(wouldCreateCycle(deps, "D", "B")).toBe(true);
  });
});

describe("buildTaskRowIndex", () => {
  it("maps task ids to array indices", () => {
    const tasks = [{ id: "a" }, { id: "b" }, { id: "c" }] as any;
    const map = buildTaskRowIndex(tasks);
    expect(map.get("a")).toBe(0);
    expect(map.get("b")).toBe(1);
    expect(map.get("c")).toBe(2);
  });
});

describe("getDependencyLinePoints", () => {
  it("returns elbow connector for different rows", () => {
    const points = getDependencyLinePoints(
      { left: 0, width: 5, row: 0 },
      { left: 3, width: 5, row: 2 }
    );
    expect(points.length).toBe(4);
    expect(points[0].x).toBe(5); // right edge of predecessor
    expect(points[3].x).toBe(3); // left edge of successor
  });

  it("returns horizontal line for same row", () => {
    const points = getDependencyLinePoints(
      { left: 0, width: 5, row: 1 },
      { left: 6, width: 5, row: 1 }
    );
    expect(points.length).toBe(2);
  });
});

describe("getBlockingDependencies", () => {
  const tasks = [
    { id: "A", isCompleted: 0 },
    { id: "B", isCompleted: 1 },
    { id: "C", isCompleted: 0 },
  ] as any;
  const deps = [dep("A", "C"), dep("B", "C")];

  it("returns incomplete predecessors", () => {
    const blockers = getBlockingDependencies("C", deps, tasks);
    expect(blockers.length).toBe(1);
    expect(blockers[0].id).toBe("A");
  });

  it("returns empty when all predecessors done", () => {
    const blockers = getBlockingDependencies("B", [], tasks);
    expect(blockers.length).toBe(0);
  });

  it("returns empty for task with no deps", () => {
    const blockers = getBlockingDependencies("A", deps, tasks);
    expect(blockers.length).toBe(0);
  });
});

describe("isTaskBlockedByDependency", () => {
  const tasks = [
    { id: "A", isCompleted: 0 },
    { id: "B", isCompleted: 0 },
  ] as any;

  it("returns true when blocked", () => {
    expect(isTaskBlockedByDependency("B", [dep("A", "B")], tasks)).toBe(true);
  });

  it("returns false when predecessor completed", () => {
    const doneTasks = [{ id: "A", isCompleted: 1 }, { id: "B", isCompleted: 0 }] as any;
    expect(isTaskBlockedByDependency("B", [dep("A", "B")], doneTasks)).toBe(false);
  });

  it("returns false when no deps", () => {
    expect(isTaskBlockedByDependency("A", [], tasks)).toBe(false);
  });
});

describe("getDependencyScheduleWarnings", () => {
  it("suggests reschedule when B.startDate <= A.dueDate and A incomplete", () => {
    const tasks = [
      { id: "A", isCompleted: 0, dueDate: "2026-06-20" },
      { id: "B", isCompleted: 0, startDate: "2026-06-18", dueDate: "2026-06-25" },
    ] as any;
    const deps = [dep("A", "B")];
    const warn = getDependencyScheduleWarnings("B", deps, tasks);
    expect(warn).not.toBeNull();
    expect(warn!.suggestedStartDate).toBe("2026-06-21");
    expect(warn!.reason).toBe("date_overlap");
  });

  it("returns null when predecessor completed", () => {
    const tasks = [
      { id: "A", isCompleted: 1, dueDate: "2026-06-20" },
      { id: "B", isCompleted: 0, startDate: "2026-06-18", dueDate: "2026-06-25" },
    ] as any;
    const deps = [dep("A", "B")];
    expect(getDependencyScheduleWarnings("B", deps, tasks)).toBeNull();
  });

  it("returns null when predecessor has no dueDate", () => {
    const tasks = [
      { id: "A", isCompleted: 0, dueDate: null },
      { id: "B", isCompleted: 0, startDate: "2026-06-18", dueDate: "2026-06-25" },
    ] as any;
    const deps = [dep("A", "B")];
    expect(getDependencyScheduleWarnings("B", deps, tasks)).toBeNull();
  });

  it("takes latest dueDate from multiple predecessors", () => {
    const tasks = [
      { id: "A", isCompleted: 0, dueDate: "2026-06-15" },
      { id: "C", isCompleted: 0, dueDate: "2026-06-22" },
      { id: "B", isCompleted: 0, startDate: "2026-06-20", dueDate: "2026-06-30" },
    ] as any;
    const deps = [dep("A", "B"), dep("C", "B")];
    const warn = getDependencyScheduleWarnings("B", deps, tasks);
    expect(warn).not.toBeNull();
    expect(warn!.suggestedStartDate).toBe("2026-06-23");
  });

  it("preserves duration when rescheduling", () => {
    const tasks = [
      { id: "A", isCompleted: 0, dueDate: "2026-06-20" },
      { id: "B", isCompleted: 0, startDate: "2026-06-18", dueDate: "2026-06-22" },
    ] as any;
    const deps = [dep("A", "B")];
    const warn = getDependencyScheduleWarnings("B", deps, tasks);
    expect(warn).not.toBeNull();
    // Original duration: 4 days (18-22). New start: 21. New end: 21 + 4 = 25.
    expect(warn!.suggestedStartDate).toBe("2026-06-21");
    expect(warn!.suggestedDueDate).toBe("2026-06-25");
  });

  it("returns null when task has no dates", () => {
    const tasks = [
      { id: "A", isCompleted: 0, dueDate: "2026-06-20" },
      { id: "B", isCompleted: 0, startDate: null, dueDate: null },
    ] as any;
    const deps = [dep("A", "B")];
    expect(getDependencyScheduleWarnings("B", deps, tasks)).toBeNull();
  });
});

describe("regression: dependency lifecycle", () => {
  it("blocked status clears when predecessor completed", () => {
    const incomplete = [{ id: "A", isCompleted: 0 }] as any;
    const complete = [{ id: "A", isCompleted: 1 }] as any;
    const deps = [dep("A", "B")];

    expect(isTaskBlockedByDependency("B", deps, incomplete)).toBe(true);
    expect(isTaskBlockedByDependency("B", deps, complete)).toBe(false);
  });

  it("schedule warning does not auto-modify task data", () => {
    const tasks = [
      { id: "A", isCompleted: 0, dueDate: "2026-06-20" },
      { id: "B", isCompleted: 0, startDate: "2026-06-18", dueDate: "2026-06-22" },
    ] as any;
    const deps = [dep("A", "B")];
    const before = JSON.stringify(tasks);
    getDependencyScheduleWarnings("B", deps, tasks);
    expect(JSON.stringify(tasks)).toBe(before);
  });

  it("dueDate-only single day task resize works", () => {
    const task = { id: "1", dueDate: "2026-06-15" } as any;
    const result = resizeTaskDateRange(task, "end", "2026-06-20");
    expect(result).not.toBeNull();
    expect(result!.dueDate).toBe("2026-06-20");
  });

  it("empty dependencies never block", () => {
    expect(isTaskBlockedByDependency("A", [], [{ id: "A", isCompleted: 0 }] as any)).toBe(false);
    expect(getBlockingDependencies("A", [], [{ id: "A", isCompleted: 0 }] as any)).toEqual([]);
    expect(getDependencyScheduleWarnings("A", [], [{ id: "A", isCompleted: 0, startDate: "2026-06-10" }] as any)).toBeNull();
  });
});

