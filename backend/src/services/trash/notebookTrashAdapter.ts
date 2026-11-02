import type Database from "better-sqlite3";
import { resolveKnowledgeNodeAccess } from "../knowledgeCapabilities.js";
import { KnowledgeTreeError } from "../knowledgeTreeCore.js";

/** Delete only an empty, authorized tombstone; never rely on notebook FK cascades. */
export function permanentlyDeleteNotebook(db: Database.Database, nodeId: string, userId: string): void {
  db.transaction(() => {
    const node = db.prepare("SELECT resourceId, isDeleted, deletedAt FROM knowledge_tree_nodes WHERE id = ? AND resourceType = 'notebook'")
      .get(nodeId) as { resourceId: string; isDeleted: number; deletedAt: string | null } | undefined;
    if (!node || !resolveKnowledgeNodeAccess(nodeId, userId, db, { includeDeleted: true }).capabilities.canDelete) {
      throw new KnowledgeTreeError("TRASH_DELETE_FORBIDDEN", 403, "没有永久删除文件夹的权限");
    }
    const folder = db.prepare("SELECT isDeleted FROM notebooks WHERE id = ?").get(node.resourceId) as { isDeleted: number } | undefined;
    if (!node.isDeleted || !folder?.isDeleted) throw new KnowledgeTreeError("TRASH_ITEM_NOT_FOUND", 409, "文件夹已恢复，不能永久删除");
    if (db.prepare(`SELECT 1 FROM knowledge_tree_nodes WHERE parentId = ?
      UNION ALL SELECT 1 FROM notebooks WHERE parentId = ?
      UNION ALL SELECT 1 FROM notes WHERE notebookId = ? LIMIT 1`).get(nodeId, node.resourceId, node.resourceId)) {
      throw new KnowledgeTreeError("TRASH_CONTAINER_NOT_EMPTY", 409, "文件夹仍包含内容，不能永久删除");
    }
    const before = (db.prepare("SELECT COALESCE(MAX(rowid), 0) AS value FROM sync_outbox").get() as { value: number }).value;
    db.prepare("DELETE FROM notebooks WHERE id = ? AND isDeleted = 1").run(node.resourceId);
    // The legacy notebook delete means soft deletion. Capture permanent intent on
    // the negotiated tree protocol instead; an older server safely rejects it.
    const captured = db.prepare(`UPDATE sync_outbox SET payload = ? WHERE rowid > ?
      AND entityType = 'knowledge_tree_node' AND entityId = ? AND operation = 'delete'`)
      .run(JSON.stringify({ purge: true, baseDeletedAt: node.deletedAt }), before, nodeId);
    if (captured.changes) {
      db.prepare(`DELETE FROM sync_outbox WHERE rowid > ? AND entityType = 'notebook'
        AND entityId = ? AND operation = 'delete'`).run(before, node.resourceId);
    } else if ((db.prepare("SELECT enabled FROM sync_v2_should_enqueue").get() as { enabled: number })?.enabled) {
      throw new KnowledgeTreeError("TRASH_SYNC_UPGRADE_REQUIRED", 409, "请先完成知识树同步，再永久删除文件夹");
    }
  }).immediate();
}
