/**
 * mindmaps / mindmap_folders 统一 schema 兜底
 * ---------------------------------------------------------------------------
 * 背景：
 *   mindmaps.ts 的 ensureTable() 只建 mindmaps 表 + 兜底 starred，
 *   没有兜底 folderId；mindmap-folders.ts 没有任何表初始化逻辑。
 *   当旧库迁移状态异常（v17 未执行或部分执行），列表接口会触发
 *   "no such column: m.folderId" 或 "no such table: mindmap_folders" 500。
 *
 * 设计：
 *   导出单个 ensureMindmapSchema(db?) 函数，两个路由文件共用同一份逻辑。
 *   所有 DDL 都是幂等的（IF NOT EXISTS + PRAGMA 探测），可安全重复调用。
 */

import type Database from "better-sqlite3";
import { getDb } from "../db/schema";

export function ensureMindmapSchema(db?: Database.Database): void {
  const _db = db ?? getDb();

  // ---- 1. mindmaps 表 ----
  _db.exec(`
    CREATE TABLE IF NOT EXISTS mindmaps (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      workspaceId TEXT,
      title TEXT NOT NULL DEFAULT '无标题导图',
      data TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mindmaps_user ON mindmaps(userId);
    CREATE INDEX IF NOT EXISTS idx_mindmaps_updated ON mindmaps(updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_mindmaps_workspace ON mindmaps(workspaceId);
  `);

  // ---- 2. 兜底缺列：starred / folderId ----
  const mindmapCols = _db.prepare("PRAGMA table_info(mindmaps)").all() as { name: string }[];
  const mindmapColNames = new Set(mindmapCols.map((c) => c.name));

  if (!mindmapColNames.has("starred")) {
    _db.exec("ALTER TABLE mindmaps ADD COLUMN starred INTEGER NOT NULL DEFAULT 0");
  }
  if (!mindmapColNames.has("folderId")) {
    _db.exec("ALTER TABLE mindmaps ADD COLUMN folderId TEXT");
  }

  // ---- 3. mindmap_folders 表 ----
  _db.exec(`
    CREATE TABLE IF NOT EXISTS mindmap_folders (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      workspaceId TEXT,
      parentId TEXT,
      name TEXT NOT NULL DEFAULT '未命名文件夹',
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mindmap_folders_user ON mindmap_folders(userId);
    CREATE INDEX IF NOT EXISTS idx_mindmap_folders_parent ON mindmap_folders(parentId);
    CREATE INDEX IF NOT EXISTS idx_mindmap_folders_workspace ON mindmap_folders(workspaceId);
  `);
}
