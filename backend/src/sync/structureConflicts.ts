import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { countUnresolvedConflicts, listUnresolvedConflicts, recordConflict, resolveConflict } from "./conflict";
import { readAssetMetadata } from "./assetOrganization";
import { countPendingMutations, enqueueMutation } from "./outbox";
import type { SyncOutboxRow } from "./types";
import { SyncError } from "./errors";
import type { SyncRemoteClient, RemoteSnapshotPage } from "./remote";
import { SYNC_V2_ASSET_ENTITY_TYPES, type SyncNegotiatedEntityType } from "./types";

const TREE_FIELDS = ["id", "workspaceId", "resourceType", "resourceId", "nodeType", "parentId", "sortOrder", "isDeleted", "deletedAt"];
const ASSET_FIELDS = ["id", "kind", "resourceId", "name", "parentId", "folderId", "deleted", "trashedAt", "originalFolderId"];

export function sameCurrentStructure(type: string, local: Record<string, unknown>, remote: Record<string, unknown>): boolean {
  return (type === "knowledge_tree_node" ? TREE_FIELDS : ASSET_FIELDS)
    .every(key => (local[key] ?? null) === (remote[key] ?? null));
}

/** A current, account-bound snapshot; this never acknowledges the sync cursor. */
export async function readReviewSnapshot(client: SyncRemoteClient, remoteUserId: string, includeNotes = false) {
  const subscription = { entityTypes: SYNC_V2_ASSET_ENTITY_TYPES, deviceId: `structure-check-${randomUUID()}` };
  const remote = new Map<string, Record<string, unknown>>();
  let cursor: string | null = null, sequence = 0;
  for (let page = 0; ; page++) {
    if (page >= 2000) throw new SyncError("SERVER_ERROR", "结构核对分页超过上限，未修改任何记录");
    const value: RemoteSnapshotPage<SyncNegotiatedEntityType> = await client.snapshot(cursor, sequence, 500, "personal", subscription);
    if (value.scopeKey !== "personal" || (page > 0 && value.snapshotSequence !== sequence)) {
      throw new SyncError("SERVER_ERROR", "结构快照范围或版本变化，请重试");
    }
    sequence = value.snapshotSequence;
    for (const item of value.items) {
      if (["notebook", "knowledge_tree_node", "attachment_organization", ...(includeNotes ? ["note"] : [])].includes(item.entityType)
        && (item.payload.userId !== remoteUserId || item.payload.workspaceId != null)) {
        throw new SyncError("SCOPE_FORBIDDEN", "结构快照账号或空间不匹配，已停止核对");
      }
      remote.set(`${item.entityType}\0${item.entityId}`, (["notebook", "knowledge_tree_node", "attachment_organization"].includes(item.entityType) || includeNotes && item.entityType === "note") ? item.payload : {id:item.entityId});
    }
    cursor = value.nextCursor;
    if (!cursor) break;
  }
  // A paged snapshot is not a transaction. Refuse to act if anything changed while reading it.
  const latest = await client.plan(0, "personal");
  if (latest.scopeKey !== "personal" || latest.serverSequence !== sequence) {
    throw new SyncError("VERSION_CONFLICT", "服务端在核对期间有新修改，请刷新后重试");
  }
  return remote;
}

/** Recheck current state; never replay an old snapshot, change content, dequeue, or ACK. */
export async function reconcileStructureConflicts(options: {
  db: Database.Database; profileId: string; localUserId: string; remoteUserId: string;
  client: SyncRemoteClient; assertCurrent: () => void;
  retryLegacyTrash?: boolean; deviceId?: string;
}) {
  const { db, profileId, localUserId, remoteUserId, client } = options;
  options.assertCurrent();
  const remote = await readReviewSnapshot(client, remoteUserId);
  options.assertCurrent();
  return db.transaction(() => {
    options.assertCurrent();
    let resolved = 0, requeued = 0;
    if (options.retryLegacyTrash && options.deviceId) {
      const queued = db.prepare(`SELECT * FROM sync_outbox WHERE profileId=? AND scopeKey='personal'
        AND entityType='knowledge_tree_node' AND status IN ('pending','inflight','failed') ORDER BY rowid`).all(profileId) as SyncOutboxRow[];
      const groups = new Map<string, SyncOutboxRow[]>();
      for (const row of queued) groups.set(row.entityId, [...groups.get(row.entityId) || [], row]);
      for (const [entityId, rows] of groups) {
        const latest = rows.at(-1)!;
        if (!rows.some(row=>row.status==="failed"&&row.lastError==="MISSING_DEPENDENCY") || !entityId.startsWith("notebook:")) continue;
        const payloads = rows.map(row => JSON.parse(row.payload || "{}"));
        if (payloads.some(p => p.purge || p.lifecycle) || latest.operation === "upsert" && payloads.at(-1).isDeleted !== 1) continue;
        const local = db.prepare("SELECT * FROM knowledge_tree_nodes WHERE id=? AND userId=? AND workspaceId IS NULL").get(entityId, localUserId) as Record<string, unknown> | undefined;
        const other = remote.get(`knowledge_tree_node\0${entityId}`);
        const resource = local && db.prepare("SELECT * FROM notebooks WHERE id=? AND userId=? AND workspaceId IS NULL").get(local.resourceId, localUserId) as Record<string, unknown> | undefined;
        const remoteResource = local && remote.get(`notebook\0${local.resourceId}`);
        const businessFields = ["id", "name", "parentId", "description", "icon", "color", "sortOrder", "isDeleted", "deletedAt"];
        if (!local || !other || local.isDeleted !== 1 || other.isDeleted !== 1 || !resource || !remoteResource
          || resource.isDeleted !== 1 || remoteResource.isDeleted !== 1
          || remoteResource.userId !== remoteUserId
          || !businessFields.every(key => (resource[key] ?? null) === (remoteResource[key] ?? null))) continue;
        const prepared=payloads.at(-1)!;
        if(latest.operation==="upsert"&&sameCurrentStructure("knowledge_tree_node",prepared,local)
          &&(prepared.baseParentId??null)===(other.parentId??null)&&prepared.baseSortOrder===other.sortOrder&&prepared.baseIsDeleted===other.isDeleted) {
          for(const conflict of listUnresolvedConflicts(db,profileId))if(conflict.scopeKey==="personal"&&conflict.entityType==="knowledge_tree_node"&&conflict.entityId===entityId){resolveConflict(db,conflict.id);resolved++;}
          continue;
        }
        // Explicitly keep today's local trash placement, without turning old projection deletes into resource purges.
        // Preserve every old intent in history AND Outbox until a normal applied/duplicate ACK supersedes it.
        const archive = recordConflict(db, {profileId,scopeKey:"personal",entityType:"knowledge_tree_node",entityId,
          basePayload:{legacyOutbox:rows},localPayload:local,remotePayload:other});
        resolveConflict(db, archive);
        enqueueMutation(db, {profileId,deviceId:options.deviceId,scopeKey:"personal",entityType:"knowledge_tree_node",entityId,
          operation:"upsert",payload:{...local,userId:remoteUserId,baseParentId:other.parentId ?? null,baseSortOrder:other.sortOrder,
            baseIsDeleted:other.isDeleted,baseDeletedAt:other.deletedAt ?? null}});
        for (const conflict of listUnresolvedConflicts(db,profileId)) {
          if (conflict.scopeKey === "personal" && conflict.entityType === "knowledge_tree_node" && conflict.entityId === entityId) {
            resolveConflict(db, conflict.id); resolved++;
          }
        }
        requeued++;
      }
    }
    for (const row of listUnresolvedConflicts(db, profileId)) {
      if (row.scopeKey !== "personal" || !["knowledge_tree_node", "attachment_organization"].includes(row.entityType)) continue;
      // Old owner values may differ only by this Profile's verified local/remote binding.
      const historical = [row.localPayload, row.remotePayload].filter(Boolean).map(raw => JSON.parse(raw!));
      if (historical.some(p => p.userId && ![localUserId, remoteUserId].includes(p.userId))) continue;
      const local = row.entityType === "knowledge_tree_node"
        ? db.prepare(`SELECT * FROM knowledge_tree_nodes WHERE id=? AND userId=? AND workspaceId IS NULL`)
          .get(row.entityId, localUserId) as Record<string, unknown> | undefined
        : readAssetMetadata(db, row.entityId, localUserId);
      const other = remote.get(`${row.entityType}\0${row.entityId}`);
      let equal = !!local && !!other && sameCurrentStructure(row.entityType, local, other);
      if (!local && !other) {
        // Missing projections alone do not prove deletion of the business resource.
        const [kind, ...id] = row.entityId.split(":");
        const table = { notebook: "notebooks", note: "notes", mindmap: "mindmaps", file: "attachments", folder: "attachment_folders" }[kind];
        const resourceType = kind === "file" ? "attachment" : kind;
        equal = !!table && !remote.has(`${resourceType}\0${id.join(":")}`)
          && !db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id.join(":"))
          && !db.prepare(`SELECT 1 FROM sync_outbox WHERE profileId=? AND scopeKey=? AND entityType=? AND entityId=?
            AND status IN ('pending','inflight','failed')`).get(profileId, row.scopeKey, row.entityType, row.entityId);
      }
      if (equal) { resolveConflict(db, row.id); resolved++; }
    }
    return { resolved, requeued, remaining: countUnresolvedConflicts(db, profileId), pendingMutations: countPendingMutations(db, profileId) };
  })();
}
