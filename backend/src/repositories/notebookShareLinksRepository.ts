import { getDb } from "../db/schema";
import { SqliteAdapter } from "../db/adapters";

function getAdapter() {
  return new SqliteAdapter(getDb());
}

export interface NotebookShareLinkRecord {
  id: string;
  notebookId: string;
  token: string;
  role: string;
  enabled: number;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const RECORD_COLUMNS = `id, "notebookId", token, role, enabled, "expiresAt", "maxUses", "useCount", "createdBy", "createdAt", "updatedAt"`;

export const notebookShareLinksRepository = {
  getByTokenWithDetails(token: string): (NotebookShareLinkRecord & {
    name: string; icon: string; color: string | null; ownerUsername: string; ownerDisplayName: string | null;
  }) | undefined {
    return getDb().prepare(`
      SELECT l.id, l."notebookId", l.token, l.role, l.enabled, l."expiresAt", l."maxUses", l."useCount",
             l."createdBy", l."createdAt", l."updatedAt", nb.name, nb.icon, nb.color,
             u.username AS "ownerUsername", u."displayName" AS "ownerDisplayName"
      FROM notebook_share_links l
      JOIN notebooks nb ON nb.id = l."notebookId"
      JOIN users u ON u.id = nb."userId"
      WHERE l.token = ? AND l.enabled = 1 AND nb."isDeleted" = 0
        AND (l."expiresAt" IS NULL OR l."expiresAt" > datetime('now'))
    `).get(token) as any;
  },

  getEnabledByToken(token: string): (NotebookShareLinkRecord & { ownerId: string }) | undefined {
    return getDb().prepare(`
      SELECT l.id, l."notebookId", l.token, l.role, l.enabled, l."expiresAt", l."maxUses", l."useCount",
             l."createdBy", l."createdAt", l."updatedAt", nb."userId" AS "ownerId"
      FROM notebook_share_links l
      JOIN notebooks nb ON nb.id = l."notebookId"
      WHERE l.token = ? AND l.enabled = 1 AND nb."isDeleted" = 0
        AND (l."expiresAt" IS NULL OR l."expiresAt" > datetime('now'))
    `).get(token) as any;
  },

  getLatestEnabledByNotebook(notebookId: string): NotebookShareLinkRecord | undefined {
    return getDb().prepare(`SELECT ${RECORD_COLUMNS} FROM notebook_share_links
      WHERE "notebookId" = ? AND enabled = 1 ORDER BY "createdAt" DESC LIMIT 1`)
      .get(notebookId) as NotebookShareLinkRecord | undefined;
  },

  getById(linkId: string): NotebookShareLinkRecord | undefined {
    return getDb().prepare(`SELECT ${RECORD_COLUMNS} FROM notebook_share_links WHERE id = ?`)
      .get(linkId) as NotebookShareLinkRecord | undefined;
  },

  disableAllByNotebook(notebookId: string): void {
    getDb().prepare(`UPDATE notebook_share_links SET enabled = 0, "updatedAt" = datetime('now')
      WHERE "notebookId" = ? AND enabled = 1`).run(notebookId);
  },

  create(input: {
    id: string; notebookId: string; token: string; role: string; expiresAt: string | null;
    maxUses?: number | null; createdBy: string;
  }): void {
    getDb().prepare(`INSERT INTO notebook_share_links
      (id, "notebookId", token, role, enabled, "expiresAt", "maxUses", "useCount", "createdBy")
      VALUES (?, ?, ?, ?, 1, ?, ?, 0, ?)`)
      .run(input.id, input.notebookId, input.token, input.role, input.expiresAt, input.maxUses ?? null, input.createdBy);
  },

  update(linkId: string, input: {
    token?: string; role?: string; enabled?: number; expiresAt?: string | null;
    maxUses?: number | null; useCount?: number;
  }): void {
    const updates: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => { updates.push(sql); params.push(value); };
    if (input.token !== undefined) add("token = ?", input.token);
    if (input.role !== undefined) add("role = ?", input.role);
    if (input.enabled !== undefined) add("enabled = ?", input.enabled);
    if (input.expiresAt !== undefined) add('"expiresAt" = ?', input.expiresAt);
    if (input.maxUses !== undefined) add('"maxUses" = ?', input.maxUses);
    if (input.useCount !== undefined) add('"useCount" = ?', input.useCount);
    if (!updates.length) return;
    updates.push('"updatedAt" = datetime(\'now\')');
    params.push(linkId);
    getDb().prepare(`UPDATE notebook_share_links SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  },

  async getByTokenWithDetailsAsync(token: string): Promise<any | undefined> {
    return getAdapter().queryOne(`
      SELECT l.id, l."notebookId", l.token, l.role, l.enabled, l."expiresAt", l."maxUses", l."useCount",
             l."createdBy", l."createdAt", l."updatedAt", nb.name, nb.icon, nb.color,
             u.username AS "ownerUsername", u."displayName" AS "ownerDisplayName"
      FROM notebook_share_links l JOIN notebooks nb ON nb.id = l."notebookId"
      JOIN users u ON u.id = nb."userId"
      WHERE l.token = ? AND l.enabled = 1 AND nb."isDeleted" = 0
        AND (l."expiresAt" IS NULL OR l."expiresAt" > datetime('now'))`, [token]);
  },

  async getEnabledByTokenAsync(token: string): Promise<any | undefined> {
    return getAdapter().queryOne(`
      SELECT l.id, l."notebookId", l.token, l.role, l.enabled, l."expiresAt", l."maxUses", l."useCount",
             l."createdBy", l."createdAt", l."updatedAt", nb."userId" AS "ownerId"
      FROM notebook_share_links l JOIN notebooks nb ON nb.id = l."notebookId"
      WHERE l.token = ? AND l.enabled = 1 AND nb."isDeleted" = 0
        AND (l."expiresAt" IS NULL OR l."expiresAt" > datetime('now'))`, [token]);
  },

  async getByIdAsync(linkId: string): Promise<NotebookShareLinkRecord | undefined> {
    return getAdapter().queryOne<NotebookShareLinkRecord>(
      `SELECT ${RECORD_COLUMNS} FROM notebook_share_links WHERE id = ?`,
      [linkId],
    );
  },

  async getLatestEnabledByNotebookAsync(notebookId: string): Promise<NotebookShareLinkRecord | undefined> {
    return getAdapter().queryOne<NotebookShareLinkRecord>(`SELECT ${RECORD_COLUMNS} FROM notebook_share_links
      WHERE "notebookId" = ? AND enabled = 1 ORDER BY "createdAt" DESC LIMIT 1`, [notebookId]);
  },

  async updateAsync(linkId: string, input: {
    token?: string; role?: string; enabled?: number; expiresAt?: string | null;
    maxUses?: number | null; useCount?: number;
  }): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => { updates.push(sql); params.push(value); };
    if (input.token !== undefined) add("token = ?", input.token);
    if (input.role !== undefined) add("role = ?", input.role);
    if (input.enabled !== undefined) add("enabled = ?", input.enabled);
    if (input.expiresAt !== undefined) add('"expiresAt" = ?', input.expiresAt);
    if (input.maxUses !== undefined) add('"maxUses" = ?', input.maxUses);
    if (input.useCount !== undefined) add('"useCount" = ?', input.useCount);
    if (!updates.length) return;
    updates.push('"updatedAt" = datetime(\'now\')');
    params.push(linkId);
    await getAdapter().execute(
      `UPDATE notebook_share_links SET ${updates.join(", ")} WHERE id = ?`,
      params,
    );
  },

  async disableAllByNotebookAsync(notebookId: string): Promise<void> {
    await getAdapter().execute(`UPDATE notebook_share_links SET enabled = 0, "updatedAt" = datetime('now')
      WHERE "notebookId" = ? AND enabled = 1`, [notebookId]);
  },

  async createAsync(input: {
    id: string; notebookId: string; token: string; role: string; expiresAt: string | null;
    maxUses?: number | null; createdBy: string;
  }): Promise<void> {
    await getAdapter().execute(`INSERT INTO notebook_share_links
      (id, "notebookId", token, role, enabled, "expiresAt", "maxUses", "useCount", "createdBy")
      VALUES (?, ?, ?, ?, 1, ?, ?, 0, ?)`,
      [input.id, input.notebookId, input.token, input.role, input.expiresAt, input.maxUses ?? null, input.createdBy]);
  },
};
