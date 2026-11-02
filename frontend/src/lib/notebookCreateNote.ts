import type { NoteType } from "@/components/CreateNoteMenu";

export type NotebookCreateHandler = (notebookId: string) => void | Promise<void>;

export interface NotebookCreateHandlers {
  onCreateNote?: NotebookCreateHandler;
  onCreateMarkdownNote?: NotebookCreateHandler;
  onCreateWordNote?: NotebookCreateHandler;
}

export function getNotebookCreateHandlersForChild(
  handlers: NotebookCreateHandlers,
): NotebookCreateHandlers {
  return handlers;
}

export async function runNotebookCreateAction(
  type: NoteType,
  notebookId: string,
  handlers: NotebookCreateHandlers,
): Promise<boolean> {
  const handler =
    type === "normal"
      ? handlers.onCreateNote
      : type === "markdown"
        ? handlers.onCreateMarkdownNote
        : handlers.onCreateWordNote;

  if (!handler) return false;

  await handler(notebookId);
  return true;
}
