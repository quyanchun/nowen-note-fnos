/**
 * 文件夹同步服务
 *
 * 负责协调 Electron 本地扫描 + 后端导入的完整流程。
 * 只在桌面端可用，Web 环境 graceful fallback。
 */

import { api } from "./api";
import { getFolderSyncBridge, isFolderSyncAvailable, type FolderSyncConfig } from "./desktopBridge";
import { toast } from "./toast";

export interface SyncProgress {
  phase: "scanning" | "uploading" | "done" | "error";
  current: number;
  total: number;
  message: string;
}

export interface SyncResult {
  success: boolean;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * 执行文件夹同步
 */
export async function runFolderSync(
  config: FolderSyncConfig,
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncResult> {
  const bridge = getFolderSyncBridge();
  if (!bridge) {
    return { success: false, created: 0, updated: 0, skipped: 0, failed: 1, errors: ["文件夹同步仅桌面端可用"] };
  }

  const result: SyncResult = { success: true, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  try {
    // 1. 扫描
    onProgress?.({ phase: "scanning", current: 0, total: 0, message: "正在扫描文件夹..." });
    const scanResult = await bridge.runNow(config.folderId);
    if (!scanResult.ok) {
      return { success: false, created: 0, updated: 0, skipped: 0, failed: 1, errors: [scanResult.message || "扫描失败"] };
    }

    // 2. 获取待上传文件
    const pendingResult = await bridge.getPendingUploads(config.folderId);
    if (!pendingResult.ok) {
      return { success: false, created: 0, updated: 0, skipped: 0, failed: 1, errors: ["获取待上传文件失败"] };
    }

    const pending = pendingResult.pending;
    if (pending.length === 0) {
      onProgress?.({ phase: "done", current: 0, total: 0, message: "没有需要同步的文件" });
      return { success: true, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    }

    // 3. 串行上传
    onProgress?.({ phase: "uploading", current: 0, total: pending.length, message: `正在同步 0/${pending.length}...` });

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      onProgress?.({
        phase: "uploading",
        current: i + 1,
        total: pending.length,
        message: `正在同步 ${item.filename} (${i + 1}/${pending.length})...`,
      });

      try {
        const ext = item.ext.toLowerCase();
        const isBinary = [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"].includes(ext);

        if (isBinary) {
          // 附件文件：从 Electron 读取文件内容，上传到后端
          const fileResult = await bridge.getUploadFile(config.folderId, item.relativePath);
          if (!fileResult.ok) {
            throw new Error(fileResult.message || "读取文件失败");
          }

          // base64 转 Blob
          const binaryStr = atob(fileResult.buffer!);
          const bytes = new Uint8Array(binaryStr.length);
          for (let j = 0; j < binaryStr.length; j++) {
            bytes[j] = binaryStr.charCodeAt(j);
          }
          const blob = new Blob([bytes], { type: fileResult.mimeType });

          const importResult = await api.folderSync.importAttachment({
            sourcePathHash: item.sourcePathHash,
            relativePath: item.relativePath,
            filename: item.filename,
            sha256: item.sha256,
            targetNotebookId: config.targetNotebookId || "",
            existingNoteId: item.existingNoteId || undefined,
            file: blob,
          });

          if (importResult.skipped) {
            result.skipped++;
            await bridge.markUploadResult(config.folderId, item.relativePath, {
              success: true,
              noteId: importResult.noteId,
              skipped: true,
            });
          } else {
            result.created++;
            await bridge.markUploadResult(config.folderId, item.relativePath, {
              success: true,
              noteId: importResult.noteId,
              attachmentId: importResult.attachmentId,
            });
          }
        } else {
          // 文本文件：直接发送内容到后端
          if (!item.contentText && item.skipReason) {
            // 超过 2MB 或读取失败
            result.skipped++;
            await bridge.markUploadResult(config.folderId, item.relativePath, {
              success: true,
              skipped: true,
              error: item.skipReason,
            });
            continue;
          }

          const importResult = await api.folderSync.importFile({
            sourcePathHash: item.sourcePathHash,
            relativePath: item.relativePath,
            filename: item.filename,
            sha256: item.sha256,
            targetNotebookId: config.targetNotebookId || "",
            contentText: item.contentText || "",
            existingNoteId: item.existingNoteId || undefined,
          });

          if (importResult.skipped) {
            result.skipped++;
          } else if (importResult.created) {
            result.created++;
          } else {
            result.updated++;
          }

          await bridge.markUploadResult(config.folderId, item.relativePath, {
            success: true,
            noteId: importResult.noteId,
          });
        }
      } catch (err: any) {
        result.failed++;
        result.errors.push(`${item.filename}: ${err.message}`);
        try {
          await bridge.markUploadResult(config.folderId, item.relativePath, {
            success: false,
            error: err.message,
          });
        } catch { /* ignore */ }
      }
    }

    onProgress?.({ phase: "done", current: pending.length, total: pending.length, message: "同步完成" });
  } catch (err: any) {
    result.success = false;
    result.errors.push(err.message);
    onProgress?.({ phase: "error", current: 0, total: 0, message: `同步失败: ${err.message}` });
  }

  return result;
}
