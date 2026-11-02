// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  invalidateNotebooks,
  NOTEBOOKS_INVALIDATED_EVENT,
  type NotebookInvalidationDetail,
} from "@/lib/notebookInvalidation";

describe("notebookInvalidation", () => {
  it("emits the confirmed mutation reason", () => {
    const listener = vi.fn((event: Event) => {
      const customEvent = event as CustomEvent<NotebookInvalidationDetail>;
      expect(customEvent.detail).toEqual({ reason: "move" });
    });

    window.addEventListener(NOTEBOOKS_INVALIDATED_EVENT, listener);
    invalidateNotebooks("move");
    window.removeEventListener(NOTEBOOKS_INVALIDATED_EVENT, listener);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
