/**
 * Attachment Folders Repository
 *
 * 职责：
 * - 封装 attachment_folders 表的数据库操作
 * - 提供类型安全的接口
 * - 保持现有 SQLite 行为不变
 */

import { getDb } from "../db/schema";
import { SqliteAdapter } from "../db/adapters";

function getAdapter() {
  return new SqliteAdapter(getDb());
}

/** attachment_folders 记录 */
export interface AttachmentFolderRecord {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const attachmentFoldersRepository = {
  /**
   * 获取用户的附件文件夹列表。
   *
   * @param userId 用户 ID
   * @returns 文件夹列表
   */
  listByUser(userId: string): AttachmentFolderRecord[] {
    const db = getDb();
    return db
      .prepare(
        `SELECT id, name, parentId, createdAt, updatedAt
         FROM attachment_folders
         WHERE userId = ?
         ORDER BY name COLLATE NOCASE`
      )
      .all(userId) as AttachmentFolderRecord[];
  },

  /**
   * 检查同级是否存在同名文件夹。
   *
   * @param userId 用户 ID
   * @param name 文件夹名称
   * @param parentId 父文件夹 ID（null = 顶层）
   * @param excludeId 排除的文件夹 ID（用于更新时排除自身）
   * @returns 是否存在同名文件夹
   */
  existsByName(userId: string, name: string, parentId: string | null, excludeId?: string): boolean {
    const db = getDb();
    if (excludeId) {
      const row = db
        .prepare(
          "SELECT id FROM attachment_folders WHERE userId = ? AND name = ? AND id != ? AND (parentId = ? OR (parentId IS NULL AND ? IS NULL))"
        )
        .get(userId, name, excludeId, parentId, parentId);
      return !!row;
    } else {
      const row = db
        .prepare(
          "SELECT id FROM attachment_folders WHERE userId = ? AND name = ? AND (parentId = ? OR (parentId IS NULL AND ? IS NULL))"
        )
        .get(userId, name, parentId, parentId);
      return !!row;
    }
  },

  /**
   * 检查父文件夹是否存在且属于当前用户。
   *
   * @param parentId 父文件夹 ID
   * @param userId 用户 ID
   * @returns 是否存在
   */
  parentExists(parentId: string, userId: string): boolean {
    const db = getDb();
    const row = db
      .prepare("SELECT id FROM attachment_folders WHERE id = ? AND userId = ?")
      .get(parentId, userId);
    return !!row;
  },

  /**
   * 获取文件夹详情。
   *
   * @param folderId 文件夹 ID
   * @param userId 用户 ID
   * @returns 文件夹记录，或 undefined
   */
  getById(folderId: string, userId: string): AttachmentFolderRecord | undefined {
    const db = getDb();
    return db
      .prepare("SELECT id, parentId FROM attachment_folders WHERE id = ? AND userId = ?")
      .get(folderId, userId) as AttachmentFolderRecord | undefined;
  },

  /**
   * 创建文件夹。
   *
   * @param input 文件夹数据
   */
  create(input: {
    id: string;
    userId: string;
    name: string;
    parentId: string | null;
  }): void {
    const db = getDb();
    db.prepare(
      "INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)"
    ).run(input.id, input.userId, input.name, input.parentId);
  },

  /**
   * 更新文件夹名称。
   *
   * @param folderId 文件夹 ID
   * @param name 新名称
   */
  updateName(folderId: string, name: string): void {
    const db = getDb();
    db.prepare("UPDATE attachment_folders SET name = ?, updatedAt = datetime('now') WHERE id = ?")
      .run(name, folderId);
  },

  /**
   * 删除文件夹。
   *
   * @param folderId 文件夹 ID
   */
  delete(folderId: string): void {
    const db = getDb();
    db.prepare("DELETE FROM attachment_folders WHERE id = ?").run(folderId);
  },

  async listByUserAsync(userId: string): Promise<AttachmentFolderRecord[]> {
    return getAdapter().queryMany<AttachmentFolderRecord>(
      `SELECT id, name, parentId, createdAt, updatedAt
       FROM attachment_folders
       WHERE userId = ?
       ORDER BY name COLLATE NOCASE`,
      [userId],
    );
  },

  async existsByNameAsync(userId: string, name: string, parentId: string | null, excludeId?: string): Promise<boolean> {
    if (excludeId) {
      const row = await getAdapter().queryOne<{ id: string }>(
        "SELECT id FROM attachment_folders WHERE userId = ? AND name = ? AND id != ? AND (parentId = ? OR (parentId IS NULL AND ? IS NULL))",
        [userId, name, excludeId, parentId, parentId],
      );
      return !!row;
    } else {
      const row = await getAdapter().queryOne<{ id: string }>(
        "SELECT id FROM attachment_folders WHERE userId = ? AND name = ? AND (parentId = ? OR (parentId IS NULL AND ? IS NULL))",
        [userId, name, parentId, parentId],
      );
      return !!row;
    }
  },

  async parentExistsAsync(parentId: string, userId: string): Promise<boolean> {
    const row = await getAdapter().queryOne<{ id: string }>(
      "SELECT id FROM attachment_folders WHERE id = ? AND userId = ?",
      [parentId, userId],
    );
    return !!row;
  },

  async getByIdAsync(folderId: string, userId: string): Promise<AttachmentFolderRecord | undefined> {
    return getAdapter().queryOne<AttachmentFolderRecord>(
      "SELECT id, parentId FROM attachment_folders WHERE id = ? AND userId = ?",
      [folderId, userId],
    );
  },

  async createAsync(input: {
    id: string;
    userId: string;
    name: string;
    parentId: string | null;
  }): Promise<void> {
    await getAdapter().execute(
      "INSERT INTO attachment_folders (id, userId, name, parentId) VALUES (?, ?, ?, ?)",
      [input.id, input.userId, input.name, input.parentId],
    );
  },

  async updateNameAsync(folderId: string, name: string): Promise<void> {
    await getAdapter().execute(
      "UPDATE attachment_folders SET name = ?, updatedAt = datetime('now') WHERE id = ?",
      [name, folderId],
    );
  },

  async deleteAsync(folderId: string): Promise<void> {
    await getAdapter().execute("DELETE FROM attachment_folders WHERE id = ?", [folderId]);
  },
};
