import "./setup-db-isolation.js";
import assert from "node:assert/strict";
import test from "node:test";

await import("../src/runtime/knowledge-tree-migration-bootstrap.js");
const { getDb, closeDb } = await import("../src/db/schema.js");
const { createKnowledgeChild, deleteKnowledgeNode, restoreKnowledgeNode } = await import("../src/services/knowledgeTree.js");
const { permanentlyDeleteNotebook } = await import("../src/services/trash/notebookTrashAdapter.js");
const { applyKnowledgeTreeStructureMutation: apply } = await import("../src/sync/knowledgeTreeStructure.js");
const { applyRemoteChanges } = await import("../src/sync/applyLocal.js");
const { applyMutation } = await import("../src/sync/apply.js");
const { createProfile, switchActiveProfile } = await import("../src/sync/profile.js");
const { ensureDevice } = await import("../src/sync/device.js");
const { markKnowledgeTreeSyncReady } = await import("../src/sync/knowledgeTreeReadiness.js");
const { runChangeFeedSuppressed } = await import("../src/sync/suppression.js");
const db = getDb();
test.after(() => closeDb());
db.prepare("INSERT INTO users (id, username, passwordHash) VALUES ('owner', 'owner', 'hash'), ('other', 'other', 'hash')").run();
const profile = createProfile(db, { name: "Test", serverUrl: "https://sync.test" });
switchActiveProfile(db, profile.id);
db.prepare("UPDATE sync_profiles SET bootstrapStatus = 'ready' WHERE id = ?").run(profile.id);
ensureDevice(db, { profileId: profile.id, platform: "test" });
markKnowledgeTreeSyncReady(db, profile.id, "personal");
const create = (title: string, parentId: string | null = null) => createKnowledgeChild({ actorUserId: "owner", workspaceId: null, parentId, nodeType: "folder", title, db });
const trash = (id: string) => deleteKnowledgeNode({ actorUserId: "owner", nodeId: id, mode: "subtree", db });
const restore = (id: string) => restoreKnowledgeNode({ actorUserId: "owner", nodeId: id, db });
const absent = (id: string) => assert.equal(db.prepare("SELECT 1 FROM notebooks WHERE id = ?").get(id), undefined);
const clearTestQueue = () => db.prepare("DELETE FROM sync_outbox").run();

test("folder purge captures explicit intent atomically and preserves older pending mutations", () => {
  const folder = create("Capture");
  trash(folder.id);
  const old = db.prepare("SELECT mutationId, payload FROM sync_outbox ORDER BY rowid").all();
  permanentlyDeleteNotebook(db, folder.id, "owner");
  absent(folder.resourceId);
  const mutations = db.prepare("SELECT mutationId, entityType, operation, payload FROM sync_outbox ORDER BY rowid").all() as Array<{mutationId:string;entityType:string;operation:string;payload:string}>;
  assert.deepEqual(mutations.slice(0, old.length).map(({mutationId,payload})=>({mutationId,payload})), old);
  assert.equal(mutations.length, old.length + 1);
  assert.equal(mutations.at(-1)?.entityType, "knowledge_tree_node");
  assert.equal(mutations.at(-1)?.operation, "delete");
  assert.equal(JSON.parse(mutations.at(-1)!.payload).purge, true);
  assert.ok(JSON.parse(mutations.at(-1)!.payload).baseDeletedAt);
});

test("server purge removes the business resource and projection, supports replay and rejects stale or protected folders", () => {
  const folder = create("Server");
  trash(folder.id);
  const baseDeletedAt = (db.prepare("SELECT deletedAt FROM knowledge_tree_nodes WHERE id = ?").get(folder.id) as {deletedAt:string}).deletedAt;
  const input = {userId:"owner",workspaceId:null,entityType:"knowledge_tree_node" as const,entityId:folder.id,operation:"delete" as const,payload:{purge:true,baseDeletedAt},mutationId:"purge-server",deviceId:"test-device"};
  restore(folder.id);
  assert.throws(()=>apply(db,input),(e:{code:string})=>e.code === "VERSION_CONFLICT");
  trash(folder.id);
  input.payload.baseDeletedAt=(db.prepare("SELECT deletedAt FROM knowledge_tree_nodes WHERE id = ?").get(folder.id) as {deletedAt:string}).deletedAt;
  assert.throws(()=>apply(db,{...input,payload:{purge:true,baseDeletedAt:"stale"}}),(e:{code:string})=>e.code === "VERSION_CONFLICT");
  const child=create("Protected child");
  db.prepare("UPDATE notebooks SET parentId = ? WHERE id = ?").run(folder.resourceId,child.resourceId);
  assert.throws(()=>apply(db,input),(e:{code:string})=>e.code === "MISSING_DEPENDENCY");
  assert.ok(db.prepare("SELECT 1 FROM notebooks WHERE id = ?").get(child.resourceId));
  db.prepare("UPDATE notebooks SET parentId = NULL WHERE id = ?").run(child.resourceId);
  clearTestQueue();
  const execute = () => db.transaction(()=>runChangeFeedSuppressed(db,()=>applyMutation(db,input)))();
  assert.equal(execute().status,"applied");
  assert.equal(execute().status,"duplicate");
  absent(folder.resourceId);
  assert.equal(db.prepare("SELECT 1 FROM knowledge_tree_nodes WHERE id = ?").get(folder.id),undefined);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get() as {n:number}).n,0);
});

test("pull applies physical folder deletion without echo and preserves pending child content", () => {
  const parent=create("Pull parent");
  const child=create("Pull child",parent.id);
  trash(parent.id);
  clearTestQueue();
  const item=(id:string)=>({entityType:"notebook" as const,entityId:id,operation:"delete" as const});
  assert.throws(()=>applyRemoteChanges(db,[item(parent.resourceId)],{userId:"owner"}),(e:{code:string})=>e.code === "MISSING_DEPENDENCY");
  assert.ok(db.prepare("SELECT 1 FROM notebooks WHERE id = ?").get(child.resourceId));
  const before = (db.prepare("SELECT COUNT(*) AS n FROM sync_changes_v2").get() as {n:number}).n;
  applyRemoteChanges(db,[item(child.resourceId),item(parent.resourceId)],{userId:"owner"});
  absent(child.resourceId); absent(parent.resourceId);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sync_changes_v2").get() as {n:number}).n,before);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get() as {n:number}).n,0);
  const pending=create("Pending edit");
  const result=applyRemoteChanges(db,[item(pending.resourceId)],{userId:"owner"});
  assert.equal(result.skipped,1);
  assert.equal(result.pendingConflicts.length,1);
  assert.ok(db.prepare("SELECT 1 FROM notebooks WHERE id = ?").get(pending.resourceId));
});


test("coalesced purge retries retain the newly confirmed child-first order", async () => {
  const { coalesceMutations } = await import("../src/sync/push.js");
  const row = (entityId: string, mutationId: string, purge = false) => ({
    id: mutationId, mutationId, profileId: profile.id, scopeKey: "personal", deviceId: "device",
    entityType: "knowledge_tree_node" as const, entityId, operation: "delete" as const,
    baseVersion: null, payload: purge ? JSON.stringify({purge:true}) : null,
    status: "pending" as const, retryCount: 0, lastAttemptAt: null, lastError: null, createdAt: "2026-10-29",
  });
  const batch=coalesceMutations([row("parent","old-parent"),row("child","old-child"),row("child","new-child",true),row("parent","new-parent",true)]);
  assert.deepEqual(batch.map(item=>item.entityId),["child","parent"]);
  assert.deepEqual(batch[1].supersededIds,["old-parent"]);
});

test("pull preserves pending tree placement when the folder receives a remote purge", () => {
  const folder=create("Local placement");
  clearTestQueue();
  db.prepare("UPDATE knowledge_tree_nodes SET sortOrder = sortOrder + 1 WHERE id = ?").run(folder.id);
  const result=applyRemoteChanges(db,[{entityType:"notebook",entityId:folder.resourceId,operation:"delete"}],{userId:"owner"});
  assert.equal(result.skipped,1);
  assert.ok(db.prepare("SELECT 1 FROM knowledge_tree_nodes WHERE id = ?").get(folder.id));
  assert.ok(db.prepare("SELECT 1 FROM sync_outbox WHERE entityId = ?").get(folder.id));
});

test("unnegotiated tree capture rolls back physical deletion and preserves the original queue", async () => {
  const { resetKnowledgeTreeSyncReadiness } = await import("../src/sync/knowledgeTreeReadiness.js");
  const folder=create("Upgrade guard");
  trash(folder.id);
  const before=db.prepare("SELECT * FROM sync_outbox ORDER BY rowid").all();
  resetKnowledgeTreeSyncReadiness(db,profile.id,"personal");
  assert.throws(()=>permanentlyDeleteNotebook(db,folder.id,"owner"),(e:{code:string})=>e.code === "TRASH_SYNC_UPGRADE_REQUIRED");
  assert.ok(db.prepare("SELECT 1 FROM notebooks WHERE id = ?").get(folder.resourceId));
  assert.ok(db.prepare("SELECT 1 FROM knowledge_tree_nodes WHERE id = ?").get(folder.id));
  assert.deepEqual(db.prepare("SELECT * FROM sync_outbox ORDER BY rowid").all(),before);
  markKnowledgeTreeSyncReady(db,profile.id,"personal");
  assert.throws(()=>permanentlyDeleteNotebook(db,folder.id,"other"),(e:{code:string})=>e.code === "TRASH_DELETE_FORBIDDEN");
});
