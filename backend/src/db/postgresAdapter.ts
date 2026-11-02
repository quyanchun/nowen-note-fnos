/**
 * PostgreSQL Async Adapter
 *
 * 实现 DatabaseAdapter 接口，用于 PostgreSQL 数据库。
 * 当前为最小实现，不接入默认运行时。
 *
 * 设计原则：
 * - 实现 DatabaseAdapter 接口
 * - 将 ? 占位符转换为 $1, $2, ...
 * - 使用 pg Pool 或 Client
 * - 不自动创建连接，由调用方传入
 * - 不做 datetime 转换（由 SQL 层面处理）
 * - 禁止 db.transaction(async) 模式
 */

import type { Pool, PoolClient, QueryResult } from "pg";
import type { DatabaseAdapter, DbRunResult } from "./adapters/types";
import { convertPlaceholders } from "./dialect";

export class PostgresAdapter implements DatabaseAdapter {
  constructor(private readonly pool: Pool) {}

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const pgSql = convertPlaceholders(sql, "postgres");
    const result = await this.pool.query(pgSql, params);
    return (result.rows[0] as T) ?? undefined;
  }

  async queryMany<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pgSql = convertPlaceholders(sql, "postgres");
    const result = await this.pool.query(pgSql, params);
    return result.rows as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<DbRunResult> {
    const pgSql = convertPlaceholders(sql, "postgres");
    const result = await this.pool.query(pgSql, params);
    return {
      changes: result.rowCount ?? 0,
    };
  }

  async executeBatch(sql: string, paramsList: unknown[][]): Promise<DbRunResult> {
    if (paramsList.length === 0) {
      return { changes: 0 };
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let totalChanges = 0;
      const pgSql = convertPlaceholders(sql, "postgres");

      for (const params of paramsList) {
        const result = await client.query(pgSql, params);
        totalChanges += result.rowCount ?? 0;
      }

      await client.query("COMMIT");
      return { changes: totalChanges };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async executeStatements(statements: Array<{ sql: string; params?: unknown[] }>): Promise<{ changes: number }> {
    if (statements.length === 0) {
      return { changes: 0 };
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let totalChanges = 0;

      for (const stmt of statements) {
        const pgSql = convertPlaceholders(stmt.sql, "postgres");
        const result = await client.query(pgSql, stmt.params ?? []);
        totalChanges += result.rowCount ?? 0;
      }

      await client.query("COMMIT");
      return { changes: totalChanges };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
