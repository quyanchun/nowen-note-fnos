/**
 * System Settings Repository
 *
 * 职责：
 * - 封装 system_settings 表的所有数据库操作
 * - 提供类型安全的接口
 * - 保持现有 SQLite 行为不变
 * - 支持 adapter 注入（PG-PILOT-01 双库试点）
 */

import { getDb } from "../db/schema";
import { SqliteAdapter } from "../db/adapters";
import type { DatabaseAdapter } from "../db/adapters/types";
import type { SystemSetting } from "./types";

/** 创建轻量 adapter 实例（每次调用新建，无全局生命周期） */
function getAdapter() {
  return new SqliteAdapter(getDb());
}

/**
 * 创建 systemSettingsRepository 实例。
 *
 * 默认使用 SQLite adapter。测试中可注入 PostgresAdapter 进行双库验证。
 *
 * @param adapter 数据库适配器（默认 SQLite）
 * @param nowExpr 当前时间表达式（SQLite: datetime('now'), PostgreSQL: NOW()）
 */
export function createSystemSettingsRepository(
  adapter: DatabaseAdapter = getAdapter(),
  nowExpr = "datetime('now')",
) {
  return {
    // ---- 同步方法（仅 SQLite） ----

    ["get"](key: string): SystemSetting | undefined {
      const db = getDb();
      return db
        .prepare("SELECT key, value, updatedAt FROM system_settings WHERE key = ?")
        .get(key) as SystemSetting | undefined;
    },

    getMany(keys: string[]): SystemSetting[] {
      if (keys.length === 0) return [];
      const db = getDb();
      const placeholders = keys.map(() => "?").join(",");
      return db
        .prepare(
          `SELECT key, value, updatedAt FROM system_settings WHERE key IN (${placeholders})`,
        )
        .all(...keys) as SystemSetting[];
    },

    getAll(): SystemSetting[] {
      const db = getDb();
      return db
        .prepare("SELECT key, value, updatedAt FROM system_settings")
        .all() as SystemSetting[];
    },

    getByPrefix(prefix: string): SystemSetting[] {
      const db = getDb();
      return db
        .prepare(
          "SELECT key, value, updatedAt FROM system_settings WHERE key LIKE ?",
        )
        .all(`${prefix}%`) as SystemSetting[];
    },

    getByPrefixes(prefixes: string[]): SystemSetting[] {
      if (prefixes.length === 0) return [];
      const db = getDb();
      const conditions = prefixes.map(() => "key LIKE ?").join(" OR ");
      const params = prefixes.map((p) => `${p}%`);
      return db
        .prepare(
          `SELECT key, value, updatedAt FROM system_settings WHERE ${conditions}`,
        )
        .all(...params) as SystemSetting[];
    },

    set(key: string, value: string): void {
      const db = getDb();
      db.prepare(
        `INSERT INTO system_settings (key, value, "updatedAt")
         VALUES (?, ?, ${nowExpr})
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, "updatedAt" = ${nowExpr}`,
      ).run(key, value);
    },

    setMany(entries: Array<{ key: string; value: string }>): void {
      if (entries.length === 0) return;
      const db = getDb();
      const upsert = db.prepare(
        `INSERT INTO system_settings (key, value, "updatedAt")
         VALUES (?, ?, ${nowExpr})
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, "updatedAt" = ${nowExpr}`,
      );
      const tx = db.transaction(() => {
        for (const { key, value } of entries) {
          upsert.run(key, value);
        }
      });
      tx();
    },

    delete(key: string): void {
      const db = getDb();
      db.prepare("DELETE FROM system_settings WHERE key = ?").run(key);
    },

    deleteMany(keys: string[]): void {
      if (keys.length === 0) return;
      const db = getDb();
      const placeholders = keys.map(() => "?").join(",");
      db.prepare(
        `DELETE FROM system_settings WHERE key IN (${placeholders})`,
      ).run(...keys);
    },

    deleteByPrefix(prefix: string): void {
      const db = getDb();
      db.prepare("DELETE FROM system_settings WHERE key LIKE ?").run(
        `${prefix}%`,
      );
    },

    // ---- Async 方法（支持 adapter 注入） ----

    async getAsync(key: string): Promise<SystemSetting | undefined> {
      return adapter.queryOne<SystemSetting>(
        'SELECT key, value, "updatedAt" FROM system_settings WHERE key = ?',
        [key],
      );
    },

    async getManyAsync(keys: string[]): Promise<SystemSetting[]> {
      if (keys.length === 0) return [];
      const placeholders = keys.map(() => "?").join(",");
      return adapter.queryMany<SystemSetting>(
        `SELECT key, value, "updatedAt" FROM system_settings WHERE key IN (${placeholders})`,
        keys,
      );
    },

    async getAllAsync(): Promise<SystemSetting[]> {
      return adapter.queryMany<SystemSetting>(
        'SELECT key, value, "updatedAt" FROM system_settings',
      );
    },

    async getByPrefixAsync(prefix: string): Promise<SystemSetting[]> {
      return adapter.queryMany<SystemSetting>(
        'SELECT key, value, "updatedAt" FROM system_settings WHERE key LIKE ?',
        [`${prefix}%`],
      );
    },

    async getByPrefixesAsync(prefixes: string[]): Promise<SystemSetting[]> {
      if (prefixes.length === 0) return [];
      const conditions = prefixes.map(() => "key LIKE ?").join(" OR ");
      const params = prefixes.map((p) => `${p}%`);
      return adapter.queryMany<SystemSetting>(
        `SELECT key, value, "updatedAt" FROM system_settings WHERE ${conditions}`,
        params,
      );
    },

    async setAsync(key: string, value: string): Promise<void> {
      await adapter.execute(
        `INSERT INTO system_settings (key, value, "updatedAt")
         VALUES (?, ?, ${nowExpr})
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, "updatedAt" = ${nowExpr}`,
        [key, value],
      );
    },

    async deleteAsync(key: string): Promise<void> {
      await adapter.execute(
        "DELETE FROM system_settings WHERE key = ?",
        [key],
      );
    },

    async deleteManyAsync(keys: string[]): Promise<void> {
      if (keys.length === 0) return;
      const placeholders = keys.map(() => "?").join(",");
      await adapter.execute(
        `DELETE FROM system_settings WHERE key IN (${placeholders})`,
        keys,
      );
    },

    async deleteByPrefixAsync(prefix: string): Promise<void> {
      await adapter.execute(
        "DELETE FROM system_settings WHERE key LIKE ?",
        [`${prefix}%`],
      );
    },

    async setManyAsync(entries: Array<{ key: string; value: string }>): Promise<void> {
      if (entries.length === 0) return;
      await adapter.executeBatch(
        `INSERT INTO system_settings (key, value, "updatedAt")
         VALUES (?, ?, ${nowExpr})
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, "updatedAt" = ${nowExpr}`,
        entries.map((e) => [e.key, e.value]),
      );
    },
  };
}

/** 默认实例（SQLite，保持向后兼容） */
export const systemSettingsRepository = createSystemSettingsRepository();
