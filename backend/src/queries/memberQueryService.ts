/**
 * Member Query Service
 *
 * 职责：
 * - 承接成员 / 权限相关复杂查询（notebook_members / notebook_acl_overrides / notes / notebooks）
 * - 不处理 HTTP / 鉴权 / 业务日志
 * - 使用 getDb() 获取数据库实例
 *
 * Issue #215：目录权限采用“最近的显式规则优先”。从目标目录向根目录回溯：
 * 1. 当前目录的用户覆盖规则；
 * 2. 当前目录的成员规则；
 * 3. 父目录重复以上顺序。
 *
 * 因此根目录成员会自动继承到全部子目录，而子目录上的覆盖规则可以收紧或放宽权限。
 */

import { getDb } from "../db/schema";

export interface NotebookMemberAccessRow {
  role: string;
  sourceNotebookId: string;
  depth: number;
  source: "override" | "member";
  allowDownload?: number;
  allowReshare?: number;
}

export function ensureNotebookAclOverridesTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS notebook_acl_overrides (
      notebookId TEXT NOT NULL,
      userId TEXT NOT NULL,
      permission TEXT NOT NULL CHECK(permission IN ('none', 'read', 'comment', 'write', 'manage')),
      allowDownload INTEGER NOT NULL DEFAULT 1,
      allowReshare INTEGER NOT NULL DEFAULT 0,
      createdBy TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (notebookId, userId),
      FOREIGN KEY (notebookId) REFERENCES notebooks(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notebook_acl_user
      ON notebook_acl_overrides(userId, notebookId);
  `);
}

function getNotebookMemberAccess(notebookId: string, userId: string): NotebookMemberAccessRow | undefined {
  ensureNotebookAclOverridesTable();
  const db = getDb();
  return db.prepare(`
    WITH RECURSIVE ancestors(id, parentId, depth) AS (
      SELECT id, parentId, 0
      FROM notebooks
      WHERE id = ? AND isDeleted = 0
      UNION ALL
      SELECT parent.id, parent.parentId, ancestors.depth + 1
      FROM notebooks parent
      JOIN ancestors ON parent.id = ancestors.parentId
      WHERE parent.isDeleted = 0
    ), candidates AS (
      SELECT
        acl.permission AS role,
        ancestors.id AS sourceNotebookId,
        ancestors.depth AS depth,
        'override' AS source,
        acl.allowDownload AS allowDownload,
        acl.allowReshare AS allowReshare,
        0 AS sourcePriority
      FROM ancestors
      JOIN notebook_acl_overrides acl
        ON acl.notebookId = ancestors.id AND acl.userId = ?

      UNION ALL

      SELECT
        nm.role AS role,
        ancestors.id AS sourceNotebookId,
        ancestors.depth AS depth,
        'member' AS source,
        COALESCE(nm.allowDownload, 1) AS allowDownload,
        COALESCE(nm.allowReshare, CASE WHEN nm.role = 'owner' THEN 1 ELSE 0 END) AS allowReshare,
        1 AS sourcePriority
      FROM ancestors
      JOIN notebook_members nm
        ON nm.notebookId = ancestors.id
       AND nm.userId = ?
       AND nm.status = 'active'
    )
    SELECT role, sourceNotebookId, depth, source, allowDownload, allowReshare
    FROM candidates
    ORDER BY depth ASC, sourcePriority ASC
    LIMIT 1
  `).get(notebookId, userId, userId) as NotebookMemberAccessRow | undefined;
}

export const memberQueryService = {
  /** 返回最近命中的目录成员/覆盖规则及其来源。 */
  getNotebookMemberAccess,

  /** 兼容旧调用：只返回角色/权限字符串。 */
  getNotebookMemberRole(
    notebookId: string,
    userId: string,
  ): { role: string } | undefined {
    const access = getNotebookMemberAccess(notebookId, userId);
    return access ? { role: access.role } : undefined;
  },

  /** 获取笔记所属目录的最近有效成员/覆盖规则。 */
  getNoteNotebookMemberAccess(
    noteId: string,
    userId: string,
  ): NotebookMemberAccessRow | undefined {
    const note = getDb()
      .prepare("SELECT notebookId FROM notes WHERE id = ? AND isTrashed = 0")
      .get(noteId) as { notebookId: string } | undefined;
    if (!note?.notebookId) return undefined;
    return getNotebookMemberAccess(note.notebookId, userId);
  },

  /** 兼容旧调用：只返回角色/权限字符串。 */
  getNoteNotebookMemberRole(
    noteId: string,
    userId: string,
  ): { role: string } | undefined {
    const access = this.getNoteNotebookMemberAccess(noteId, userId);
    return access ? { role: access.role } : undefined;
  },

  /**
   * 列出用户直接参与的共享根目录。子目录权限通过继承解析，不重复出现在“共享给我”根列表中。
   */
  listSharedNotebookIds(userId: string): string[] {
    const db = getDb();
    return (
      db
        .prepare(
          `SELECT nm.notebookId
             FROM notebook_members nm
             JOIN notebooks nb ON nb.id = nm.notebookId
            WHERE nm.userId = ?
              AND nm.status = 'active'
              AND nb.userId <> ?
              AND nb.isDeleted = 0
            ORDER BY nb.updatedAt DESC, nb.id ASC`,
        )
        .all(userId, userId) as { notebookId: string }[]
    ).map((row) => row.notebookId);
  },
};
