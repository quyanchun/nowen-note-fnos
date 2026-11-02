# PostgreSQL Migration Risk Assessment

## 总体评估

| 维度 | 风险等级 | 说明 |
|------|---------|------|
| SQL 兼容性 | 🟡 中 | datetime/upsert/placeholder 需适配 |
| Schema 兼容性 | 🟡 中 | BOOLEAN/TIMESTAMPTZ 需转换 |
| 数据迁移 | 🟡 中 | 时间格式/布尔值需转换 |
| 测试覆盖 | 🟢 低 | 42/42 串行测试通过 |
| Repository 改动 | 🟢 低 | 已有 async 接口，只需适配 SQL |
| Adapter 改动 | 🟢 低 | 已有 DatabaseAdapter interface |
| 业务影响 | 🟢 低 | SQLite 继续作为默认库 |

## 阻塞项

**无阻塞项。** 所有风险均可通过分阶段迁移解决。

## 高风险详情

### 1. FTS5 全文搜索（notes 表）

| 项目 | 详情 |
|------|------|
| 影响范围 | notes 表全文搜索功能 |
| SQLite 实现 | FTS5 虚拟表 |
| PostgreSQL 替代 | tsvector + tsquery + GIN 索引 |
| 风险 | 需要重写搜索逻辑 |
| 建议 | 单独迁移，不阻塞基础 CRUD |

### 2. datetime 方言差异

| 项目 | 详情 |
|------|------|
| 影响范围 | 21 个 Repository，114 处 |
| SQLite | `datetime('now')` |
| PostgreSQL | `NOW()` 或 `CURRENT_TIMESTAMP` |
| 风险 | 需要 dialect helper 或 SQL 替换 |
| 建议 | 使用 PG-DIALECT-01 的 nowExpression() |

### 3. 参数占位符差异

| 项目 | 详情 |
|------|------|
| 影响范围 | 全部 Repository |
| SQLite | `?` |
| PostgreSQL | `$1, $2, ...` |
| 风险 | 需要在 Adapter 层转换 |
| 建议 | PostgresAdapter 内部自动转换 |

## 中风险详情

### 1. BOOLEAN 字段

| 项目 | 详情 |
|------|------|
| 影响范围 | ~29 个 BOOLEAN 字段 |
| SQLite | INTEGER 0/1 |
| PostgreSQL | BOOLEAN true/false |
| 风险 | 需要数据迁移转换 |
| 建议 | Migration 脚本中转换 |

### 2. INSERT OR IGNORE

| 项目 | 详情 |
|------|------|
| 影响范围 | 4 个 Repository，12 处 |
| SQLite | `INSERT OR IGNORE` |
| PostgreSQL | `INSERT ... ON CONFLICT DO NOTHING` |
| 风险 | 语法不同 |
| 建议 | 使用 dialect helper 或 SQL 替换 |

### 3. result.changes vs rowCount

| 项目 | 详情 |
|------|------|
| 影响范围 | 36 处 |
| SQLite | `result.changes` |
| PostgreSQL | `result.rowCount` |
| 风险 | 返回值字段名不同 |
| 建议 | PostgresAdapter 内部适配 |

## 低风险详情

### 1. ON CONFLICT DO UPDATE
- PG 原生支持，无需修改

### 2. COALESCE / NULLIF
- 完全兼容

### 3. 外键约束
- PG 支持更严格，有利无害

### 4. UUID 主键
- PG 支持 TEXT 主键，也可用 uuid 类型

## 推荐迁移顺序

```
PG-ADAPTER-01 ✅ DatabaseAdapter interface
PG-DIALECT-01 ✅ SQL dialect helpers
PG-SCHEMA-01  ✅ Schema 草案（当前）
PG-SCHEMA-02  → PostgreSQL CREATE TABLE SQL
PG-SCHEMA-03  → Docker PostgreSQL 环境
PG-SCHEMA-04  → 空库初始化测试
PG-PILOT-01   → systemSettingsRepository 双库测试
PG-PILOT-02   → 扩展到更多 Repository
PG-FTS-01     → FTS5 → tsvector 迁移
PG-DATA-01    → 数据迁移脚本
```

## 结论

PostgreSQL 迁移**可行且无阻塞**。建议从 systemSettingsRepository 试点，逐步扩展。
SQLite 继续作为默认开发数据库，PostgreSQL 作为可选生产数据库。
