import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { downloadDocxBlob } from "@/lib/wordNoteService";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadDocxBlob", () => {
  it("stages DOCX on the server before triggering a real HTTP download", async () => {
    const blob = new Blob(["docx"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const stage = vi.spyOn(api, "stageGeneratedExport").mockResolvedValue({
      downloadToken: "docx-token",
      filename: "资料分析模块.docx",
      size: 4,
    });
    const download = vi.spyOn(api, "downloadMarkdownExport").mockImplementation(() => {});

    await downloadDocxBlob(blob, "资料分析模块");

    expect(stage).toHaveBeenCalledWith(blob, "资料分析模块.docx");
    expect(download).toHaveBeenCalledWith("docx-token", "资料分析模块.docx");
  });
});
