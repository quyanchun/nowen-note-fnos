# PostgreSQL Schema Migration Plan

## 概述

基于 SQLite schema 生成的 PostgreSQL 迁移设计草案。
当前状态：SQLite async 迁移 100% 完成，PostgreSQL 实际接入 0%。

## 表清单（约 40+ 表）

### 核心表

| 表 | 主键 | 说明 |
|---|---|---|
| users | TEXT (UUID) | 用户表 |
| workspaces | TEXT (UUID) | 工作区表 |
| notebooks | TEXT (UUID) | 笔记本表 |
| notes | TEXT (UUID) | 笔记表 |
| tags | TEXT (UUID) | 标签表 |
| note_tags | TEXT (UUID) | 笔记标签关联 |

### 成员/权限表

| 表 | 主键 | 说明 |
|---|---|---|
| workspace_members | TEXT (UUID) | 工作区成员 |
| workspace_invites | TEXT (UUID) | 工作区邀请 |
| notebook_members | TEXT (UUID) | 笔记本成员 |
| notebook_share_links | TEXT (UUID) | 笔记本分享链接 |
| note_acl | TEXT (UUID) | 笔记权限 |
| share_comments | TEXT (UUID) | 分享评论 |

### 任务表

| 表 | 主键 | 说明 |
|---|---|---|
| task_projects | TEXT (UUID) | 任务项目 |
| tasks | TEXT (UUID) | 任务 |
| task_templates | TEXT (UUID) | 任务模板 |
| task_reminders | TEXT (UUID) | 任务提醒 |
| task_dependencies | TEXT (UUID) | 任务依赖 |
| task_calendar_feeds | TEXT (UUID) | 日历订阅 |
| task_attachments | TEXT (UUID) | 任务附件 |

### 附件表

| 表 | 主键 | 说明 |
|---|---|---|
| attachments | TEXT (UUID) | 附件主表 |
| attachment_chunks | INTEGER AUTOINCREMENT | 附件分块 |
| attachment_folders | TEXT (UUID) | 附件文件夹 |
| attachment_references | TEXT (UUID) | 附件引用 |
| attachment_embedding_queue | TEXT (UUID) | 附件嵌入队列 |

### 其他表

| 表 | 主键 | 说明 |
|---|---|---|
| favorites | TEXT (UUID) | 收藏 |
| mindmap_folders | TEXT (UUID) | 思维导图文件夹 |
| folder_sync_files | TEXT (UUID) | 文件夹同步 |
| calendar_export_targets | TEXT (UUID) | 日历导出 |
| diary_attachments | TEXT (UUID) | 日记附件 |
| note_links | TEXT (UUID) | 笔记链接 |
| note_versions | TEXT (UUID) | 笔记版本 |
| note_yupdates | TEXT (UUID) | Y.js 更新 |
| note_ysnapshots | TEXT (UUID) | Y.js 快照 |
| system_settings | TEXT (KEY) | 系统设置 |
| user_sessions | TEXT (UUID) | 用户会话 |
| api_tokens | TEXT (UUID) | API 令牌 |
| api_token_usage | TEXT (UUID) | API 使用统计 |
| custom_fonts | TEXT (UUID) | 自定义字体 |
| ai_custom_prompts | TEXT (UUID) | AI 自定义提示 |
| ai_chat_conversations | TEXT (UUID) | AI 聊天会话 |

## SQLite → PostgreSQL 类型映射

| SQLite 类型 | PostgreSQL 类型 | 说明 |
|-----------|--------------|------|
| TEXT PRIMARY KEY | TEXT PRIMARY KEY | 保持 UUID TEXT |
| INTEGER PRIMARY KEY AUTOINCREMENT | SERIAL 或 GENERATED ALWAYS AS IDENTITY | 仅 attachment_chunks |
| TEXT NOT NULL DEFAULT (datetime('now')) | TIMESTAMPTZ NOT NULL DEFAULT NOW() | 时间戳 |
| INTEGER NOT NULL DEFAULT 0 (boolean) | BOOLEAN NOT NULL DEFAULT false | 布尔值 |
| INTEGER NOT NULL DEFAULT 1 (boolean) | BOOLEAN NOT NULL DEFAULT true | 布尔值 |
| TEXT (JSON) | JSONB 或 TEXT | 按用途选择 |
| TEXT DEFAULT '' | TEXT DEFAULT '' | 兼容 |
| REAL | DOUBLE PRECISION 或 NUMERIC | 浮点 |

## SQL 语法差异

| SQLite 语法 | PostgreSQL 替代 | 使用频率 |
|-----------|---------------|--------|
| `datetime('now')` | `NOW()` | 极高（114处） |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` | 中（12处） |
| `ON CONFLICT ... DO UPDATE` | 完全兼容 | 中（9处） |
| `?` 占位符 | `$1, $2, ...` | 全部 |
| `result.changes` | `rowCount` | 高（36处） |
| `lastInsertRowid` | `RETURNING id` | 低（2处） |
| `PRAGMA table_info` | `information_schema.columns` | 仅 migrations |
| `LIKE` | `LIKE` 或 `ILIKE` | 低 |
| `COALESCE` | 完全兼容 | 低 |
| SQLite FTS5 | `tsvector/tsquery` | 1处 |

## 高风险表

| 表 | 风险点 | 说明 |
|---|---|---|
| notes | FTS5 全文搜索 | 需要用 PG tsvector 替换 |
| note_yupdates / note_ysnapshots | Y.js 二进制数据 | 需确认 BYTEA 映射 |
| attachment_chunks | AUTOINCREMENT 主键 | 唯一使用自增 ID 的表 |
| system_settings | ON CONFLICT upsert | PG 完全兼容 |

## 中风险表

| 表 | 风险点 |
|---|---|
| user_sessions | datetime 过期判断 |
| api_tokens | datetime 过期判断 |
| task_reminders | datetime 调度 |
| embedding_queue | datetime 状态管理 |

## 低风险表

大部分表为简单 CRUD，无特殊 SQLite 语法，可直接迁移。

## Migration 策略建议

### 阶段 1：PG-SCHEMA-01（当前）
- ✅ Schema 草案
- ✅ 类型映射
- ✅ 风险评估

### 阶段 2：PG-SCHEMA-02
- 生成 PostgreSQL CREATE TABLE SQL
- 生成索引 SQL
- 生成约束 SQL

### 阶段 3：PG-SCHEMA-03
- Docker PostgreSQL 本地环境
- docker-compose.yml 添加 postgres 服务
- DATABASE_URL 环境变量

### 阶段 4：PG-SCHEMA-04
- 空库初始化测试
- Migration 脚本验证

### 阶段 5：PG-PILOT-01
- systemSettingsRepository 双库测试
- 最低风险试点
