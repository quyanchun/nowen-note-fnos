/**
 * Workspace Invites Repository
 *
 * 职责：
 * - 封装 workspace_invites 表的数据库操作
 * - 提供类型安全的接口
 * - 保持现有 SQLite 行为不变
 */

import { getDb } from "../db/schema";
import { SqliteAdapter } from "../db/adapters";

function getAdapter() {
  return new SqliteAdapter(getDb());
}

/** workspace_invites 记录 */
export interface WorkspaceInviteRecord {
  id: string;
  workspaceId: string;
  code: string;
  role: string;
  maxUses: number;
  useCount: number;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export const workspaceInvitesRepository = {
  /**
   * 获取邀请详情。
   *
   * @param inviteId 邀请 ID
   * @returns 邀请记录，或 undefined
   */
  getById(inviteId: string): WorkspaceInviteRecord | undefined {
    const db = getDb();
    return db
      .prepare("SELECT * FROM workspace_invites WHERE id = ?")
      .get(inviteId) as WorkspaceInviteRecord | undefined;
  },

  /**
   * 获取工作区的邀请列表。
   *
   * @param workspaceId 工作区 ID
   * @returns 邀请列表
   */
  listByWorkspace(workspaceId: string): WorkspaceInviteRecord[] {
    const db = getDb();
    return db
      .prepare("SELECT * FROM workspace_invites WHERE \"workspaceId\" = ? ORDER BY \"createdAt\" DESC")
      .all(workspaceId) as WorkspaceInviteRecord[];
  },

  /**
   * 根据邀请码获取邀请。
   *
   * @param code 邀请码
   * @returns 邀请记录，或 undefined
   */
  getByCode(code: string): WorkspaceInviteRecord | undefined {
    const db = getDb();
    return db
      .prepare("SELECT * FROM workspace_invites WHERE code = ?")
      .get(code) as WorkspaceInviteRecord | undefined;
  },

  /**
   * 创建邀请。
   *
   * @param input 邀请数据
   */
  create(input: {
    id: string;
    workspaceId: string;
    code: string;
    role: string;
    maxUses: number;
    expiresAt: string | null;
    createdBy: string;
  }): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO workspace_invites (id, "workspaceId", code, role, "maxUses", "expiresAt", "createdBy")
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(input.id, input.workspaceId, input.code, input.role, input.maxUses, input.expiresAt, input.createdBy);
  },

  /**
   * 删除邀请。
   *
   * @param inviteId 邀请 ID
   * @param workspaceId 工作区 ID
   */
  delete(inviteId: string, workspaceId: string): void {
    const db = getDb();
    db.prepare("DELETE FROM workspace_invites WHERE id = ? AND \"workspaceId\" = ?").run(inviteId, workspaceId);
  },

  /**
   * 增加邀请使用次数。
   *
   * @param inviteId 邀请 ID
   */
  incrementUseCount(inviteId: string): void {
    const db = getDb();
    db.prepare("UPDATE workspace_invites SET \"useCount\" = \"useCount\" + 1 WHERE id = ?").run(inviteId);
  },

  /**
   * 转移邀请创建者（用户迁移时使用）。
   *
   * @param fromUserId 源用户 ID
   * @param toUserId 目标用户 ID
   * @returns 更新的行数
   */
  transferOwnership(fromUserId: string, toUserId: string): number {
    const db = getDb();
    const result = db.prepare("UPDATE workspace_invites SET \"createdBy\" = ? WHERE \"createdBy\" = ?").run(toUserId, fromUserId);
    return result.changes;
  },

  async getByIdAsync(inviteId: string): Promise<WorkspaceInviteRecord | undefined> {
    return getAdapter().queryOne<WorkspaceInviteRecord>(
      "SELECT * FROM workspace_invites WHERE id = ?",
      [inviteId],
    );
  },

  async listByWorkspaceAsync(workspaceId: string): Promise<WorkspaceInviteRecord[]> {
    return getAdapter().queryMany<WorkspaceInviteRecord>(
      "SELECT * FROM workspace_invites WHERE \"workspaceId\" = ? ORDER BY \"createdAt\" DESC",
      [workspaceId],
    );
  },

  async getByCodeAsync(code: string): Promise<WorkspaceInviteRecord | undefined> {
    return getAdapter().queryOne<WorkspaceInviteRecord>(
      "SELECT * FROM workspace_invites WHERE code = ?",
      [code],
    );
  },

  async createAsync(input: {
    id: string;
    workspaceId: string;
    code: string;
    role: string;
    maxUses: number;
    expiresAt: string | null;
    createdBy: string;
  }): Promise<void> {
    await getAdapter().execute(
      `INSERT INTO workspace_invites (id, "workspaceId", code, role, "maxUses", "expiresAt", "createdBy")
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.id, input.workspaceId, input.code, input.role, input.maxUses, input.expiresAt, input.createdBy],
    );
  },

  async deleteAsync(inviteId: string, workspaceId: string): Promise<void> {
    await getAdapter().execute(
      "DELETE FROM workspace_invites WHERE id = ? AND \"workspaceId\" = ?",
      [inviteId, workspaceId],
    );
  },

  async incrementUseCountAsync(inviteId: string): Promise<void> {
    await getAdapter().execute(
      "UPDATE workspace_invites SET \"useCount\" = \"useCount\" + 1 WHERE id = ?",
      [inviteId],
    );
  },

  async transferOwnershipAsync(fromUserId: string, toUserId: string): Promise<number> {
    const result = await getAdapter().execute(
      "UPDATE workspace_invites SET \"createdBy\" = ? WHERE \"createdBy\" = ?",
      [toUserId, fromUserId],
    );
    return result.changes;
  },
};
