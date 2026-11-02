import { describe, expect, it, vi } from "vitest";
import {
  getNotebookCreateHandlersForChild,
  runNotebookCreateAction,
} from "@/lib/notebookCreateNote";

describe("runNotebookCreateAction", () => {
  it("Markdown 菜单项使用当前树节点的笔记本 id", async () => {
    const onCreateNote = vi.fn();
    const onCreateMarkdownNote = vi.fn().mockResolvedValue(undefined);
    const onCreateWordNote = vi.fn();

    const handled = await runNotebookCreateAction("markdown", "child-notebook-id", {
      onCreateNote,
      onCreateMarkdownNote,
      onCreateWordNote,
    });

    expect(handled).toBe(true);
    expect(onCreateMarkdownNote).toHaveBeenCalledWith("child-notebook-id");
    expect(onCreateNote).not.toHaveBeenCalled();
    expect(onCreateWordNote).not.toHaveBeenCalled();
  });

  it("缺少对应处理函数时返回 false", async () => {
    await expect(runNotebookCreateAction("word", "notebook-id", {})).resolves.toBe(false);
  });

  it("递归渲染子笔记本时保留全部新建处理函数", () => {
    const handlers = {
      onCreateNote: vi.fn(),
      onCreateMarkdownNote: vi.fn(),
      onCreateWordNote: vi.fn(),
    };

    const forwarded = getNotebookCreateHandlersForChild(handlers);

    expect(forwarded.onCreateNote).toBe(handlers.onCreateNote);
    expect(forwarded.onCreateMarkdownNote).toBe(handlers.onCreateMarkdownNote);
    expect(forwarded.onCreateWordNote).toBe(handlers.onCreateWordNote);
  });
});
