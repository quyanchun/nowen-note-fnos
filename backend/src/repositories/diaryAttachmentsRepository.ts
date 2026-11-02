/**
 * Diary Attachments Repository
 *
 * 职责：
 * - 封装 diary_attachments 表的数据库操作
 * - 提供类型安全的接口
 * - 保持现有 SQLite 行为不变
 */

import { getDb } from "../db/schema";
import { SqliteAdapter } from "../db/adapters";

function getAdapter() {
  return new SqliteAdapter(getDb());
}

export const diaryAttachmentsRepository = {
  /**
   * 获取附件详情（用于下载）。
   *
   * @param attachmentId 附件 ID
   * @returns 附件记录，或 undefined
   */
  getById(attachmentId: string): { id: string; mimeType: string; path: string } | undefined {
    const db = getDb();
    return db
      .prepare("SELECT id, mimeType, path FROM diary_attachments WHERE id = ?")
      .get(attachmentId) as { id: string; mimeType: string; path: string } | undefined;
  },

  /**
   * 获取附件详情（用于删除权限校验）。
   *
   * @param attachmentId 附件 ID
   * @returns 附件记录，或 undefined
   */
  getByIdForDelete(attachmentId: string): { id: string; userId: string; diaryId: string | null; path: string } | undefined {
    const db = getDb();
    return db
      .prepare("SELECT id, userId, diaryId, path FROM diary_attachments WHERE id = ?")
      .get(attachmentId) as { id: string; userId: string; diaryId: string | null; path: string } | undefined;
  },

  /**
   * 获取日记的附件 ID 列表。
   *
   * @param diaryId 日记 ID
   * @returns 附件 ID 列表
   */
  listIdsByDiaryId(diaryId: string): string[] {
    const db = getDb();
    const rows = db
      .prepare("SELECT id FROM diary_attachments WHERE diaryId = ?")
      .all(diaryId) as { id: string }[];
    return rows.map((r) => r.id);
  },

  /**
   * 获取孤儿附件数量。
   *
   * @param userId 用户 ID
   * @param workspaceId 工作区 ID（null = 个人空间）
   * @returns 孤儿附件数量
   */
  countOrphans(userId: string, workspaceId: string | null): number {
    const db = getDb();
    if (workspaceId) {
      const row = db
        .prepare("SELECT COUNT(*) as count FROM diary_attachments WHERE userId = ? AND diaryId IS NULL AND workspaceId = ?")
        .get(userId, workspaceId) as { count: number };
      return row.count;
    } else {
      const row = db
        .prepare("SELECT COUNT(*) as count FROM diary_attachments WHERE userId = ? AND diaryId IS NULL AND workspaceId IS NULL")
        .get(userId) as { count: number };
      return row.count;
    }
  },

  /**
   * 创建附件。
   *
   * @param input 附件数据
   */
  create(input: {
    id: string;
    userId: string;
    workspaceId: string | null;
    mimeType: string;
    size: number;
    path: string;
  }): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO diary_attachments (id, diaryId, userId, workspaceId, mimeType, size, path)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`
    ).run(input.id, input.userId, input.workspaceId, input.mimeType, input.size, input.path);
  },

  /**
   * 删除附件。
   *
   * @param attachmentId 附件 ID
   */
  delete(attachmentId: string): void {
    const db = getDb();
    db.prepare("DELETE FROM diary_attachments WHERE id = ?").run(attachmentId);
  },

  /**
   * 获取过期的孤儿附件 ID 列表。
   *
   * @param cutoffIso 截止时间
   * @returns 过期附件 ID 列表
   */
  listExpiredOrphans(cutoffIso: string): string[] {
    const db = getDb();
    const rows = db
      .prepare("SELECT id FROM diary_attachments WHERE diaryId IS NULL AND createdAt < ?")
      .all(cutoffIso) as { id: string }[];
    return rows.map((r) => r.id);
  },

  /**
   * 批量删除附件。
   *
   * @param attachmentIds 附件 ID 列表
   * @returns 删除的行数
   */
  deleteByIds(attachmentIds: string[]): number {
    if (attachmentIds.length === 0) return 0;
    const db = getDb();
    const placeholders = attachmentIds.map(() => "?").join(",");
    const result = db.prepare(`DELETE FROM diary_attachments WHERE id IN (${placeholders})`).run(...attachmentIds);
    return result.changes;
  },

  async getByIdAsync(attachmentId: string): Promise<{ id: string; mimeType: string; path: string } | undefined> {
    return getAdapter().queryOne<{ id: string; mimeType: string; path: string }>(
      "SELECT id, mimeType, path FROM diary_attachments WHERE id = ?",
      [attachmentId],
    );
  },

  async getByIdForDeleteAsync(attachmentId: string): Promise<{ id: string; userId: string; diaryId: string | null; path: string } | undefined> {
    return getAdapter().queryOne<any>(
      "SELECT id, userId, diaryId, path FROM diary_attachments WHERE id = ?",
      [attachmentId],
    );
  },

  async listIdsByDiaryIdAsync(diaryId: string): Promise<string[]> {
    const rows = await getAdapter().queryMany<{ id: string }>(
      "SELECT id FROM diary_attachments WHERE diaryId = ?",
      [diaryId],
    );
    return rows.map((r) => r.id);
  },

  async countOrphansAsync(userId: string, workspaceId: string | null): Promise<number> {
    if (workspaceId) {
      const row = await getAdapter().queryOne<{ count: number }>(
        "SELECT COUNT(*) as count FROM diary_attachments WHERE userId = ? AND diaryId IS NULL AND workspaceId = ?",
        [userId, workspaceId],
      );
      return row?.count ?? 0;
    } else {
      const row = await getAdapter().queryOne<{ count: number }>(
        "SELECT COUNT(*) as count FROM diary_attachments WHERE userId = ? AND diaryId IS NULL AND workspaceId IS NULL",
        [userId],
      );
      return row?.count ?? 0;
    }
  },

  async createAsync(input: {
    id: string;
    userId: string;
    workspaceId: string | null;
    mimeType: string;
    size: number;
    path: string;
  }): Promise<void> {
    await getAdapter().execute(
      `INSERT INTO diary_attachments (id, diaryId, userId, workspaceId, mimeType, size, path)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      [input.id, input.userId, input.workspaceId, input.mimeType, input.size, input.path],
    );
  },

  async deleteAsync(attachmentId: string): Promise<void> {
    await getAdapter().execute("DELETE FROM diary_attachments WHERE id = ?", [attachmentId]);
  },

  async listExpiredOrphansAsync(cutoffIso: string): Promise<string[]> {
    const rows = await getAdapter().queryMany<{ id: string }>(
      "SELECT id FROM diary_attachments WHERE diaryId IS NULL AND createdAt < ?",
      [cutoffIso],
    );
    return rows.map((r) => r.id);
  },

  async deleteByIdsAsync(attachmentIds: string[]): Promise<number> {
    if (attachmentIds.length === 0) return 0;
    const placeholders = attachmentIds.map(() => "?").join(",");
    const result = await getAdapter().execute(
      `DELETE FROM diary_attachments WHERE id IN (${placeholders})`,
      attachmentIds,
    );
    return result.changes;
  },
};
