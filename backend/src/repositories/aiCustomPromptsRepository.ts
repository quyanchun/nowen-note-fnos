/**
 * AI Custom Prompts Repository
 *
 * 职责：
 * - 封装 ai_custom_prompts 表的数据库操作
 * - 提供类型安全的接口
 * - 保持现有 SQLite 行为不变
 *
 * 注意：
 * - 只迁移 ai_custom_prompts 的 CRUD
 * - 不迁移 ai_chat_conversations / ai_chat_messages
 */

import { getDb } from "../db/schema";
import { SqliteAdapter } from "../db/adapters";

function getAdapter() {
  return new SqliteAdapter(getDb());
}

/** AI 自定义 Prompt 记录 */
export interface AiCustomPromptRecord {
  id: string;
  userId: string;
  name: string;
  prompt: string;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const aiCustomPromptsRepository = {
  /**
   * 列出用户的自定义 Prompt。
   *
   * @param userId 用户 ID
   * @returns Prompt 列表
   */
  listByUser(userId: string): AiCustomPromptRecord[] {
    const db = getDb();
    return db
      .prepare(
        `SELECT id, userId, name, prompt, usageCount, lastUsedAt, createdAt, updatedAt
         FROM ai_custom_prompts
         WHERE userId = ?
         ORDER BY usageCount DESC, updatedAt DESC, createdAt DESC
         LIMIT 200`,
      )
      .all(userId) as AiCustomPromptRecord[];
  },

  /**
   * 获取单个 Prompt（含 userId 校验）。
   *
   * @param id Prompt ID
   * @param userId 用户 ID
   * @returns Prompt 记录，或 undefined
   */
  getByIdAndUser(id: string, userId: string): AiCustomPromptRecord | undefined {
    const db = getDb();
    return db
      .prepare(
        "SELECT id, userId, name, prompt, usageCount, lastUsedAt, createdAt, updatedAt FROM ai_custom_prompts WHERE id = ? AND userId = ?",
      )
      .get(id, userId) as AiCustomPromptRecord | undefined;
  },

  /**
   * 创建 Prompt。
   *
   * @param input 创建输入
   */
  create(input: { id: string; userId: string; name: string; prompt: string }): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO ai_custom_prompts (id, userId, name, prompt, usageCount, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
    ).run(input.id, input.userId, input.name, input.prompt);
  },

  /**
   * 更新 Prompt（按 id + userId）。
   *
   * @param id Prompt ID
   * @param userId 用户 ID
   * @param patch 更新字段
   */
  updateByIdAndUser(id: string, userId: string, patch: { name?: string; prompt?: string }): void {
    const db = getDb();
    const updates: string[] = [];
    const params: any[] = [];

    if (patch.name !== undefined) {
      updates.push("name = ?");
      params.push(patch.name);
    }
    if (patch.prompt !== undefined) {
      updates.push("prompt = ?");
      params.push(patch.prompt);
    }

    if (updates.length === 0) return;

    updates.push("updatedAt = datetime('now')");
    params.push(id, userId);

    db.prepare(`UPDATE ai_custom_prompts SET ${updates.join(", ")} WHERE id = ? AND userId = ?`).run(...params);
  },

  /**
   * 删除 Prompt（按 id + userId）。
   *
   * @param id Prompt ID
   * @param userId 用户 ID
   * @returns 是否删除成功
   */
  deleteByIdAndUser(id: string, userId: string): boolean {
    const db = getDb();
    const result = db.prepare("DELETE FROM ai_custom_prompts WHERE id = ? AND userId = ?").run(id, userId);
    return result.changes > 0;
  },

  /**
   * 上报"被使用一次"。
   *
   * 仅更新 usageCount/lastUsedAt，不动 updatedAt。
   *
   * @param id Prompt ID
   * @param userId 用户 ID
   * @returns 是否更新成功
   */
  touchUsage(id: string, userId: string): boolean {
    const db = getDb();
    const result = db
      .prepare(
        `UPDATE ai_custom_prompts
         SET usageCount = usageCount + 1,
             lastUsedAt = datetime('now')
         WHERE id = ? AND userId = ?`,
      )
      .run(id, userId);
    return result.changes > 0;
  },

  async listByUserAsync(userId: string): Promise<AiCustomPromptRecord[]> {
    return getAdapter().queryMany<AiCustomPromptRecord>(
      `SELECT id, userId, name, prompt, usageCount, lastUsedAt, createdAt, updatedAt
       FROM ai_custom_prompts
       WHERE userId = ?
       ORDER BY usageCount DESC, updatedAt DESC, createdAt DESC
       LIMIT 200`,
      [userId],
    );
  },

  async getByIdAndUserAsync(id: string, userId: string): Promise<AiCustomPromptRecord | undefined> {
    return getAdapter().queryOne<AiCustomPromptRecord>(
      "SELECT id, userId, name, prompt, usageCount, lastUsedAt, createdAt, updatedAt FROM ai_custom_prompts WHERE id = ? AND userId = ?",
      [id, userId],
    );
  },

  async createAsync(input: { id: string; userId: string; name: string; prompt: string }): Promise<void> {
    await getAdapter().execute(
      `INSERT INTO ai_custom_prompts (id, userId, name, prompt, usageCount, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
      [input.id, input.userId, input.name, input.prompt],
    );
  },

  async updateByIdAndUserAsync(id: string, userId: string, patch: { name?: string; prompt?: string }): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) { updates.push("name = ?"); params.push(patch.name); }
    if (patch.prompt !== undefined) { updates.push("prompt = ?"); params.push(patch.prompt); }

    if (updates.length === 0) return;

    updates.push("updatedAt = datetime('now')");
    params.push(id, userId);

    await getAdapter().execute(`UPDATE ai_custom_prompts SET ${updates.join(", ")} WHERE id = ? AND userId = ?`, params);
  },

  async deleteByIdAndUserAsync(id: string, userId: string): Promise<boolean> {
    const result = await getAdapter().execute("DELETE FROM ai_custom_prompts WHERE id = ? AND userId = ?", [id, userId]);
    return result.changes > 0;
  },

  async touchUsageAsync(id: string, userId: string): Promise<boolean> {
    const result = await getAdapter().execute(
      `UPDATE ai_custom_prompts
       SET usageCount = usageCount + 1,
           lastUsedAt = datetime('now')
       WHERE id = ? AND userId = ?`,
      [id, userId],
    );
    return result.changes > 0;
  },
};
