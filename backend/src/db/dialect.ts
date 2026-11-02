/**
 * SQL Dialect Helper
 *
 * 最小 SQL 方言工具，为 SQLite / PostgreSQL 差异做准备。
 * 当前只提供基础 helper，不接入 Repository，不做复杂 SQL parser。
 *
 * 用法：
 *   import { nowExpression, convertPlaceholders, booleanValue } from "./dialect";
 *   const sql = `INSERT INTO t (val, created) VALUES (?, ${nowExpression("sqlite")})`;
 *   const pgSql = convertPlaceholders(sql, "postgres");
 */

export type DatabaseDialect = "sqlite" | "postgres";

/**
 * 返回当前时间表达式。
 *
 * - sqlite: datetime('now')
 * - postgres: NOW()
 */
export function nowExpression(dialect: DatabaseDialect): string {
  if (dialect === "postgres") return "NOW()";
  return "datetime('now')";
}

/**
 * 返回第 N 个参数占位符。
 *
 * - sqlite: ?
 * - postgres: $1, $2, $3, ...
 */
export function placeholder(index: number, dialect: DatabaseDialect): string {
  if (dialect === "postgres") return `$${index}`;
  return "?";
}

/**
 * 将 SQL 中的 ? 占位符转换为目标方言格式。
 *
 * - sqlite: 原样返回
 * - postgres: 将 ? 依次替换为 $1, $2, $3, ...
 *
 * 注意：此实现是简单字符串替换，不会处理字符串字面量中的 ?。
 * 对于包含 ? 的字符串参数，应在调用方处理或使用参数化查询。
 */
export function convertPlaceholders(sql: string, dialect: DatabaseDialect): string {
  if (dialect === "sqlite") return sql;

  let index = 0;
  return sql.replace(/\?/g, () => {
    index++;
    return `$${index}`;
  });
}

/**
 * 返回布尔值的方言表示。
 *
 * - sqlite: 1 / 0 (INTEGER)
 * - postgres: true / false (BOOLEAN)
 */
export function booleanValue(value: boolean, dialect: DatabaseDialect): unknown {
  if (dialect === "postgres") return value;
  return value ? 1 : 0;
}

/**
 * 返回 INSERT 冲突策略。
 *
 * - sqlite: "INSERT OR IGNORE" 模式
 * - postgres: "ON CONFLICT DO NOTHING"
 *
 * 注意：SQLite 的 INSERT OR IGNORE 是语法级关键字，不能简单替换为 ON CONFLICT。
 * 此 helper 返回的是建议策略说明，实际 SQL 需要按方言构造。
 */
export function conflictDoNothing(dialect: DatabaseDialect): string {
  if (dialect === "postgres") return "ON CONFLICT DO NOTHING";
  return "INSERT OR IGNORE";
}
