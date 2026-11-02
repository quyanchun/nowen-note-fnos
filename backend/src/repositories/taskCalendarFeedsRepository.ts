/**
 * Task Calendar Feeds Repository
 *
 * 职责：
 * - 封装 task_calendar_feeds 表的数据库操作
 * - 提供类型安全的接口
 * - 保持现有 SQLite 行为不变
 */

import { getDb } from "../db/schema";
import { SqliteAdapter } from "../db/adapters";

function getAdapter() {
  return new SqliteAdapter(getDb());
}

/** task_calendar_feeds 记录 */
export interface TaskCalendarFeedRecord {
  id: string;
  userId: string;
  workspaceId: string | null;
  token: string;
  enabled: number;
  includeCompleted: number;
  includeDescription: number;
  defaultAlarmMinutes: number | null;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const taskCalendarFeedsRepository = {
  /**
   * 获取用户的 calendar feed。
   *
   * @param userId 用户 ID
   * @returns feed 记录，或 undefined
   */
  getByUser(userId: string): TaskCalendarFeedRecord | undefined {
    const db = getDb();
    return db
      .prepare("SELECT * FROM task_calendar_feeds WHERE userId = ?")
      .get(userId) as TaskCalendarFeedRecord | undefined;
  },

  /**
   * 根据 ID 和用户 ID 获取 feed（用于权限校验）。
   *
   * @param feedId feed ID
   * @param userId 用户 ID
   * @returns feed 记录，或 undefined
   */
  getByIdAndUser(feedId: string, userId: string): { id: string } | undefined {
    const db = getDb();
    return db
      .prepare("SELECT id FROM task_calendar_feeds WHERE id = ? AND userId = ?")
      .get(feedId, userId) as { id: string } | undefined;
  },

  /**
   * 根据 token 获取 feed（用于公开访问）。
   *
   * @param token feed token
   * @returns feed 记录，或 undefined
   */
  getByToken(token: string): TaskCalendarFeedRecord | undefined {
    const db = getDb();
    return db
      .prepare("SELECT * FROM task_calendar_feeds WHERE token = ?")
      .get(token) as TaskCalendarFeedRecord | undefined;
  },

  /**
   * 根据 token 获取启用的 feed（用于导出）。
   *
   * @param token feed token
   * @returns feed 记录，或 undefined
   */
  getEnabledByToken(token: string): TaskCalendarFeedRecord | undefined {
    const db = getDb();
    return db
      .prepare("SELECT * FROM task_calendar_feeds WHERE token = ? AND enabled = 1")
      .get(token) as TaskCalendarFeedRecord | undefined;
  },

  /**
   * 创建 feed。
   *
   * @param input feed 数据
   */
  create(input: {
    id: string;
    userId: string;
    token: string;
  }): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes)
       VALUES (?, ?, ?, 1, 0, 1, 30)`
    ).run(input.id, input.userId, input.token);
  },

  /**
   * 启用 feed。
   *
   * @param feedId feed ID
   */
  enable(feedId: string): void {
    const db = getDb();
    db.prepare(
      "UPDATE task_calendar_feeds SET enabled = 1, updatedAt = datetime('now') WHERE id = ?"
    ).run(feedId);
  },

  /**
   * 更新 feed 设置。
   *
   * @param feedId feed ID
   * @param input 更新数据
   */
  update(feedId: string, input: {
    enabled?: number;
    includeCompleted?: number;
    includeDescription?: number;
    defaultAlarmMinutes?: number | null;
  }): void {
    const db = getDb();
    const updates: string[] = [];
    const params: any[] = [];

    if (input.enabled !== undefined) {
      updates.push("enabled = ?");
      params.push(input.enabled);
    }
    if (input.includeCompleted !== undefined) {
      updates.push("includeCompleted = ?");
      params.push(input.includeCompleted);
    }
    if (input.includeDescription !== undefined) {
      updates.push("includeDescription = ?");
      params.push(input.includeDescription);
    }
    if (input.defaultAlarmMinutes !== undefined) {
      updates.push("defaultAlarmMinutes = ?");
      params.push(input.defaultAlarmMinutes);
    }

    if (updates.length === 0) return;

    updates.push("updatedAt = datetime('now')");
    params.push(feedId);

    db.prepare(`UPDATE task_calendar_feeds SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  },

  /**
   * 获取 feed 详情（更新后返回）。
   *
   * @param feedId feed ID
   * @returns feed 记录，或 undefined
   */
  getById(feedId: string): TaskCalendarFeedRecord | undefined {
    const db = getDb();
    return db
      .prepare("SELECT * FROM task_calendar_feeds WHERE id = ?")
      .get(feedId) as TaskCalendarFeedRecord | undefined;
  },

  /**
   * 重新生成 token。
   *
   * @param feedId feed ID
   * @param newToken 新 token
   */
  regenerateToken(feedId: string, newToken: string): void {
    const db = getDb();
    db.prepare(
      "UPDATE task_calendar_feeds SET token = ?, updatedAt = datetime('now') WHERE id = ?"
    ).run(newToken, feedId);
  },

  /**
   * 更新最后访问时间。
   *
   * @param feedId feed ID
   */
  updateLastAccessedAt(feedId: string): void {
    const db = getDb();
    db.prepare(
      "UPDATE task_calendar_feeds SET lastAccessedAt = datetime('now') WHERE id = ?"
    ).run(feedId);
  },

  /**
   * 获取 feed 的详细信息（包含 enabled 和 token）。
   *
   * @param feedId feed ID
   * @param userId 用户 ID
   * @returns feed 记录，或 undefined
   */
  getEnabledAndTokenByIdAndUser(feedId: string, userId: string): { id: string; enabled: number; token: string } | undefined {
    const db = getDb();
    return db
      .prepare("SELECT id, enabled, token FROM task_calendar_feeds WHERE id = ? AND userId = ?")
      .get(feedId, userId) as { id: string; enabled: number; token: string } | undefined;
  },

  async getByUserAsync(userId: string): Promise<TaskCalendarFeedRecord | undefined> {
    return getAdapter().queryOne<TaskCalendarFeedRecord>(
      "SELECT * FROM task_calendar_feeds WHERE userId = ?",
      [userId],
    );
  },

  async getByIdAndUserAsync(feedId: string, userId: string): Promise<{ id: string } | undefined> {
    return getAdapter().queryOne<{ id: string }>(
      "SELECT id FROM task_calendar_feeds WHERE id = ? AND userId = ?",
      [feedId, userId],
    );
  },

  async getByTokenAsync(token: string): Promise<TaskCalendarFeedRecord | undefined> {
    return getAdapter().queryOne<TaskCalendarFeedRecord>(
      "SELECT * FROM task_calendar_feeds WHERE token = ?",
      [token],
    );
  },

  async getEnabledByTokenAsync(token: string): Promise<TaskCalendarFeedRecord | undefined> {
    return getAdapter().queryOne<TaskCalendarFeedRecord>(
      "SELECT * FROM task_calendar_feeds WHERE token = ? AND enabled = 1",
      [token],
    );
  },

  async createAsync(input: {
    id: string;
    userId: string;
    token: string;
  }): Promise<void> {
    await getAdapter().execute(
      `INSERT INTO task_calendar_feeds (id, userId, token, enabled, includeCompleted, includeDescription, defaultAlarmMinutes)
       VALUES (?, ?, ?, 1, 0, 1, 30)`,
      [input.id, input.userId, input.token],
    );
  },

  async enableAsync(feedId: string): Promise<void> {
    await getAdapter().execute(
      "UPDATE task_calendar_feeds SET enabled = 1, updatedAt = datetime('now') WHERE id = ?",
      [feedId],
    );
  },

  async updateAsync(feedId: string, input: {
    enabled?: number;
    includeCompleted?: number;
    includeDescription?: number;
    defaultAlarmMinutes?: number | null;
  }): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.enabled !== undefined) { updates.push("enabled = ?"); params.push(input.enabled); }
    if (input.includeCompleted !== undefined) { updates.push("includeCompleted = ?"); params.push(input.includeCompleted); }
    if (input.includeDescription !== undefined) { updates.push("includeDescription = ?"); params.push(input.includeDescription); }
    if (input.defaultAlarmMinutes !== undefined) { updates.push("defaultAlarmMinutes = ?"); params.push(input.defaultAlarmMinutes); }

    if (updates.length === 0) return;

    updates.push("updatedAt = datetime('now')");
    params.push(feedId);

    await getAdapter().execute(`UPDATE task_calendar_feeds SET ${updates.join(", ")} WHERE id = ?`, params);
  },

  async getByIdAsync(feedId: string): Promise<TaskCalendarFeedRecord | undefined> {
    return getAdapter().queryOne<TaskCalendarFeedRecord>(
      "SELECT * FROM task_calendar_feeds WHERE id = ?",
      [feedId],
    );
  },

  async regenerateTokenAsync(feedId: string, newToken: string): Promise<void> {
    await getAdapter().execute(
      "UPDATE task_calendar_feeds SET token = ?, updatedAt = datetime('now') WHERE id = ?",
      [newToken, feedId],
    );
  },

  async updateLastAccessedAtAsync(feedId: string): Promise<void> {
    await getAdapter().execute(
      "UPDATE task_calendar_feeds SET lastAccessedAt = datetime('now') WHERE id = ?",
      [feedId],
    );
  },

  async getEnabledAndTokenByIdAndUserAsync(feedId: string, userId: string): Promise<{ id: string; enabled: number; token: string } | undefined> {
    return getAdapter().queryOne<{ id: string; enabled: number; token: string }>(
      "SELECT id, enabled, token FROM task_calendar_feeds WHERE id = ? AND userId = ?",
      [feedId, userId],
    );
  },
};
