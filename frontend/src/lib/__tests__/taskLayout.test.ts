import { describe, expect, it } from "vitest";
import {
  TASK_CENTER_ROOT_CLASS,
  TASK_CENTER_MAIN_CLASS,
  TASK_MOBILE_FILTER_BAR_CLASS,
  TASK_VIEW_SHELL_CLASS,
} from "@/lib/taskLayout";

describe("taskLayout", () => {
  it("lets the mobile task page shrink to the viewport instead of the filter buttons", () => {
    expect(TASK_VIEW_SHELL_CLASS).toContain("min-w-0");
    expect(TASK_VIEW_SHELL_CLASS).toContain("overflow-hidden");
    expect(TASK_CENTER_ROOT_CLASS).toContain("min-w-0");
    expect(TASK_CENTER_MAIN_CLASS).toContain("min-w-0");
    expect(TASK_MOBILE_FILTER_BAR_CLASS).toContain("overflow-x-auto");
  });
});
