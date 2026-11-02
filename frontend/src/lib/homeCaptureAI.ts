export interface CapturePreferences {
  notebookId?: string;
  method: "tidy" | "summary" | "tasks";
  referenceNotebookId?: string;
  instruction?: string;
}
export const defaultCapturePreferences: CapturePreferences = { method: "tidy" };

export async function organizeCapture(input: string, preferences: CapturePreferences, signal: AbortSignal): Promise<string> {
  const { collaborationRequest } = await import("./aiCollaboration");
  const methods = {
    tidy: "仅修正明显错字、分段和排版，尽量少改。",
    summary: "提炼原文已有的关键要点，简明列出，不丢失重要信息。",
    tasks: "把原文中明确提到的事项列为 Markdown 待办，不能编造负责人、时间或额外任务。",
  };
  const result = await collaborationRequest<{ content: string }>("compose", {
    input, intent: "capture",
    ...(preferences.referenceNotebookId ? { notebookId: preferences.referenceNotebookId } : {}),
    skill: { kind: "prompt", name: "随手收集", prompt: `${methods[preferences.method] || methods.tidy}\n禁止扩写成文章、编造背景或补充未提供的事实。路径、网址、账号和代码原样保留。只输出整理后的 Markdown 正文。\n${preferences.instruction || ""}` },
  }, signal);
  if (!result.content?.trim()) throw new Error("AI 没有返回整理内容，原文已保留。");
  return result.content;
}
