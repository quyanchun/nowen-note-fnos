# Repository 试点收口说明与后续迁移规则

> 最后更新：2026-06-27
> 状态：✅ 正式收口

## 一、试点概述

为后续数据库迁移（SQLite → PostgreSQL）做准备，引入 Repository 模式封装数据库操作。本次试点覆盖三个表：`system_settings`、`custom_fonts`、`api_tokens`。

### 目标

- 将数据库操作从路由/业务逻辑中抽离
- 提供类型安全的接口
- 保持现有 SQLite 行为不变
- 为后续 PostgreSQL 迁移奠定基础

---

## 二、已完成内容

### 2.1 Repository 实现

| Repository | 文件 | 方法数 | 职责 |
|------------|------|--------|------|
| `systemSettingsRepository` | `backend/src/repositories/systemSettingsRepository.ts` | 10 | system_settings 表 CRUD |
| `customFontsRepository` | `backend/src/repositories/customFontsRepository.ts` | 9 | custom_fonts 表 CRUD |
| `apiTokensRepository` | `backend/src/repositories/apiTokensRepository.ts` | 11 | api_tokens + api_token_usage 表 CRUD |

### 2.2 路由迁移

| 路由文件 | 使用的 Repository |
|----------|-------------------|
| `routes/settings.ts` | `systemSettingsRepository` |
| `routes/fonts.ts` | `customFontsRepository` |
| `routes/tokens.ts` | `apiTokensRepository` |

### 2.3 服务迁移

| 服务文件 | 迁移内容 |
|----------|----------|
| `services/vec-store.ts` | vec_dim 读写改用 `systemSettingsRepository` |

### 2.4 业务逻辑迁移

| 文件 | 迁移内容 |
|------|----------|
| `lib/api-tokens.ts` | 鉴权链路相关 DB 读写改用 `apiTokensRepository` |

### 2.5 共享类型

| 文件 | 内容 |
|------|------|
| `repositories/types.ts` | Repository 方法的参数/返回值类型定义 |
| `repositories/index.ts` | 统一导出入口 |

### 2.6 Commit 列表

| Commit | 描述 |
|--------|------|
| `3530db1` | DB-REPOSITORY-PILOT-01-A: system_settings + custom_fonts Repository |
| `3e54ec5` | DB-REPOSITORY-PILOT-01-B: vec_dim 走 Repository |
| `62d02b3` | DB-REPOSITORY-PILOT-02-B: api_tokens CRUD 迁移 |
| `75b00a6` | DB-REPOSITORY-PILOT-02-C1: resolveApiToken() SELECT 迁移 |
| `2f10835` | DB-REPOSITORY-PILOT-02-C2-A: lastUsedAt/lastUsedIp UPDATE 迁移 |
| `646b4fe` | DB-REPOSITORY-PILOT-02-C2-B: recordTokenUsage() 迁移 |
| `e902904` | DB-REPOSITORY-PILOT-02-C3: pruneTokenUsage() 迁移 |
| `dd20450` | 合并到 main（merge commit） |

---

## 三、明确未做内容

以下内容在本次试点中**刻意保留原位**，不做迁移：

| 项目 | 原因 |
|------|------|
| `initApiTokensTable()` DDL | 建表逻辑保留原位，后续统一处理 |
| PostgreSQL 接入 | 另开独立主线 |
| `DB_DRIVER` 配置 | 另开独立主线 |
| `DATABASE_URL` 配置 | 另开独立主线 |
| `schema.ts` 改动 | 不在本次范围 |
| `migrations.ts` 改动 | 不在本次范围 |
| `docker-compose.yml` 改动 | 不在本次范围 |
| `package.json` 改动 | 不在本次范围 |
| `notes` 表迁移 | 高风险，后置 |
| `attachments` 表迁移 | 高风险，后置 |
| `backup` 表迁移 | 高风险，后置 |
| `index.ts` 鉴权中间件 | 高风险，后置 |

---

## 四、Repository 设计规范

### 4.1 文件结构

```
backend/src/repositories/
├── index.ts                          # 统一导出
├── types.ts                          # 共享类型定义
├── systemSettingsRepository.ts       # system_settings 表
├── customFontsRepository.ts          # custom_fonts 表
└── apiTokensRepository.ts            # api_tokens 表
```

### 4.2 命名规范

- Repository 文件：`{tableName}Repository.ts`（camelCase）
- Repository 对象：`{tableName}Repository`（camelCase）
- 方法名：动词 + 名词，如 `getById()`、`create()`、`delete()`

### 4.3 代码规范

```typescript
/**
 * {TableName} Repository
 *
 * 职责：
 * - 封装 {table_name} 表的所有数据库操作
 * - 提供类型安全的接口
 * - 保持现有 SQLite 行为不变
 */

import { getDb } from "../db/schema";
import type { SomeType } from "./types";

export const someRepository = {
  /**
   * 方法说明
   */
  methodName(param: string): ReturnType {
    const db = getDb();
    return db.prepare("SELECT ...").get(param) as ReturnType;
  },
};
```

### 4.4 类型定义规范

- 所有类型统一定义在 `repositories/types.ts`
- 接口命名：`{TableName}Record`、`{TableName}ListItem`、`{TableName}LookupRow` 等
- 导出方式：在 `repositories/index.ts` 中统一导出

### 4.5 接口设计原则

1. **单一职责**：每个 Repository 只负责一张表（或紧密相关的表）
2. **同步 API**：保持与 better-sqlite3 一致的同步调用方式
3. **类型安全**：所有方法都有明确的参数和返回值类型
4. **行为等价**：迁移后的 SQL 与原直连 SQL 完全等价
5. **错误处理**：由调用方决定如何处理错误，Repository 不吞掉异常

---

## 五、后续迁移规则

### 5.1 核心原则

1. **小步迁移**
   - 每次只迁移一个表或一个功能点
   - 每步必须有独立的 commit 和 RV 验证
   - 不要一次性迁移多个高风险模块

2. **先审计再实现**
   - 迁移前必须审计目标表的所有 SQL 操作
   - 确认哪些操作可以迁移，哪些需要保留
   - 识别高风险操作（如 FTS5、sqlite-vec）

3. **每步必须 RV 验证**
   - tsc exit code 0
   - vite build exit code 0
   - git status clean
   - 无 PostgreSQL / DB_DRIVER / DATABASE_URL 混入
   - 无 schema / migrations / docker / package 改动

4. **不混入 PostgreSQL**
   - Repository 层只使用 SQLite SQL
   - 不引入 PostgreSQL 特有语法
   - 不引入 pg 依赖

5. **不混入基础设施改动**
   - 不改 schema.ts
   - 不改 migrations.ts
   - 不改 docker-compose
   - 不改 package.json

### 5.2 高风险模块识别

| 模块 | 风险等级 | 原因 |
|------|----------|------|
| `notes` | 🔴 高 | FTS5、rowid、搜索、高频业务 |
| `attachments` | 🔴 高 | 文件存储、索引、导入导出 |
| `backup` | 🔴 高 | 备份逻辑、数据完整性 |
| `index.ts` | 🔴 高 | 鉴权中间件、全局影响 |
| `tags` | 🟢 低 | 简单 CRUD |
| `note_links` | 🟢 低 | 简单 CRUD |
| `calendar_export_targets` | 🟢 低 | 简单 CRUD |

### 5.3 推荐迁移顺序

#### 第一优先级（低风险）

1. `tags` 表
2. `note_links` 表
3. `calendar_export_targets` 表
4. 其他简单 CRUD 表

#### 第二优先级（中风险）

1. `notebooks` 表
2. `users` 表（部分操作）

#### 第三优先级（高风险，需单独设计）

1. `notes` 表（含 FTS5）
2. `attachments` 表（含文件存储）
3. `backup` 表

#### 独立主线

1. PostgreSQL 支持
2. DB_DRIVER 通用适配
3. DbAdapter 抽象层

### 5.4 迁移检查清单

每次迁移必须完成以下检查：

```markdown
## 迁移前

- [ ] 审计目标表的所有 SQL 操作
- [ ] 识别可迁移操作和需保留操作
- [ ] 确认风险等级
- [ ] 设计 Repository 接口

## 迁移中

- [ ] 创建 Repository 文件
- [ ] 定义共享类型
- [ ] 实现 Repository 方法
- [ ] 修改路由/服务使用 Repository
- [ ] 保持行为等价

## 迁移后（RV 验证）

- [ ] tsc exit code 0
- [ ] vite build exit code 0
- [ ] git status clean
- [ ] 无 PostgreSQL / DB_DRIVER / DATABASE_URL
- [ ] 无 schema / migrations / docker / package 改动
- [ ] 功能测试通过
- [ ] 边界测试通过
```

---

## 六、验证标准

### 6.1 工程验证

| 命令 | 预期结果 |
|------|----------|
| `npx tsc -b --noEmit` | exit code 0 |
| `npx vite build` | exit code 0 |
| `git status --short` | 无输出（clean） |

### 6.2 架构边界验证

| 检查项 | 预期结果 |
|--------|----------|
| 无 PostgreSQL / pg 引用 | ✅ |
| 无 DB_DRIVER | ✅ |
| 无 DATABASE_URL | ✅ |
| 无 schema.ts 改动 | ✅ |
| 无 migrations.ts 改动 | ✅ |
| 无 docker-compose 改动 | ✅ |
| 无 package.json 改动 | ✅ |
| Repository 使用 getDb() + SQLite SQL | ✅ |
| Repository 同步 API | ✅ |

### 6.3 功能验证

- 所有原有功能正常工作
- API 返回结构不变
- 错误处理不变
- 性能无明显下降

---

## 七、回滚方案

### 7.1 单次迁移回滚

```bash
git revert <commit-hash>
```

### 7.2 整个试点回滚

```bash
git revert dd20450  # merge commit
```

### 7.3 回滚注意事项

- 回滚前确认无其他提交依赖
- 回滚后需要重新验证 tsc 和 vite build
- 回滚后需要更新本文档状态

---

## 八、后续建议

### 8.1 短期（1-2 周）

1. 观察当前 Repository 层运行情况
2. 收集性能数据
3. 修复可能的回归问题

### 8.2 中期（1-2 月）

1. 迁移低风险表（tags、note_links 等）
2. 完善 Repository 测试覆盖
3. 考虑引入单元测试框架

### 8.3 长期（3-6 月）

1. 设计 PostgreSQL 适配层
2. 迁移高风险表（notes、attachments）
3. 实现 DB_DRIVER 通用抽象
4. 完成 SQLite → PostgreSQL 迁移

---

## 九、附录

### 9.1 文件清单

```
backend/src/repositories/
├── index.ts
├── types.ts
├── systemSettingsRepository.ts
├── customFontsRepository.ts
└── apiTokensRepository.ts

backend/src/routes/
├── settings.ts (已迁移)
├── fonts.ts (已迁移)
└── tokens.ts (已迁移)

backend/src/services/
└── vec-store.ts (部分迁移)

backend/src/lib/
└── api-tokens.ts (部分迁移)
```

### 9.2 相关文档

- [SQLite to PostgreSQL Migration Roadmap](db-migration-roadmap.md)
- [README.md](../README.md)

### 9.3 联系方式

如有疑问，请联系项目维护者。

---

**文档版本**：v1.0
**最后更新**：2026-06-27
**维护者**：cropflre
