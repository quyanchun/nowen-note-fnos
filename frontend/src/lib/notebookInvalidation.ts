export const NOTEBOOKS_INVALIDATED_EVENT = "nowen:notebooks-invalidated";

export type NotebookInvalidationReason =
  | "move"
  | "reorder"
  | "create"
  | "delete"
  | "unknown";

export interface NotebookInvalidationDetail {
  reason: NotebookInvalidationReason;
}

export function invalidateNotebooks(reason: NotebookInvalidationReason = "unknown"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<NotebookInvalidationDetail>(NOTEBOOKS_INVALIDATED_EVENT, {
    detail: { reason },
  }));
}
