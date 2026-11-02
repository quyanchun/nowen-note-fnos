import "./setup-db-isolation.js";
import assert from "node:assert/strict";
import test from "node:test";
import "../src/runtime/knowledge-tree-migration-bootstrap.js";
import { getDb, closeDb } from "../src/db/schema.js";
import { createProfile, switchActiveProfile } from "../src/sync/profile.js";
import { recordConflict } from "../src/sync/conflict.js";
import { enqueueMutation } from "../src/sync/outbox.js";
import { reconcileStructureConflicts } from "../src/sync/structureConflicts.js";
const db = getDb();
db.prepare("INSERT INTO users(id,username,passwordHash) VALUES ('local','local','hash'),('other','other','hash')").run();
const profile = createProfile(db, { name: "direct", serverUrl: "https://notes.example", remoteUserId: "remote" });
const other = createProfile(db, { name: "other", serverUrl: "https://other.example", remoteUserId: "other" });
switchActiveProfile(db, profile.id);
const tree = (id: string) => db.prepare("SELECT id,userId,workspaceId,parentId,nodeType,resourceType,resourceId,sortOrder,isDeleted,deletedAt,createdAt,updatedAt FROM knowledge_tree_nodes WHERE id=?").get(`notebook:${id}`) as Record<string, unknown>;
for (const id of ["same", "move", "broken"]) db.prepare("INSERT INTO notebooks(id,userId,name) VALUES (?,'local',?)").run(id, id);
const snapshots = ["same", "move"].map(id => ({ entityType: "knowledge_tree_node", entityId: `notebook:${id}`, payload: { ...tree(id), userId: "remote", ...(id === "move" ? {sortOrder: 50} : {}) } }));
const equalId = recordConflict(db, { profileId: profile.id, entityType: "knowledge_tree_node", entityId: "notebook:same", localPayload: tree("same"), remotePayload: snapshots[0].payload });
const goneId = recordConflict(db, { profileId: profile.id, entityType: "knowledge_tree_node", entityId: "notebook:gone", remotePayload: {...snapshots[0].payload,id:"notebook:gone",resourceId:"gone"} });
const movedId = recordConflict(db, { profileId: profile.id, entityType: "knowledge_tree_node", entityId: "notebook:move", localPayload: tree("move"), remotePayload: snapshots[1].payload });
const otherId = recordConflict(db, { profileId: other.id, entityType: "knowledge_tree_node", entityId: "notebook:same", localPayload: tree("same"), remotePayload: snapshots[0].payload });
// Missing projection is not a deleted business resource.
const broken = tree("broken"); db.prepare("DELETE FROM knowledge_tree_nodes WHERE id=?").run(broken.id);
const brokenId = recordConflict(db, { profileId: profile.id, entityType: "knowledge_tree_node", entityId: String(broken.id), localPayload: broken });
enqueueMutation(db, {profileId:profile.id,deviceId:"device",entityType:"knowledge_tree_node",entityId:"notebook:same",operation:"delete"});
const fixture = (overrides: Record<string, unknown> = {}) => ({
  async snapshot() { return {scopeKey:"personal",snapshotSequence:42,nextCursor:null,items:snapshots}; },
  async plan() { return {scopeKey:"personal",serverSequence:42}; },
  ...overrides,
}) as any;
const options = {db,profileId:profile.id,localUserId:"local",remoteUserId:"remote",client:fixture(),assertCurrent:()=>{}};
const status = (id: string) => (db.prepare("SELECT status FROM sync_conflicts WHERE id=?").get(id) as any).status;

test("rechecks current structures, preserves queue/history and isolates Profile (DCC-003 DCC-004 DCC-006)", async () => {
  const beforeQueue = db.prepare("SELECT * FROM sync_outbox ORDER BY rowid").all();
  const beforePayloads = db.prepare("SELECT id,localPayload,remotePayload,basePayload FROM sync_conflicts ORDER BY id").all();
  const result = await reconcileStructureConflicts(options);
  assert.equal(result.resolved,2); assert.equal(result.remaining,2);
  assert.equal(status(equalId),"resolved"); assert.equal(status(goneId),"resolved");
  assert.equal(status(movedId),"unresolved"); assert.equal(status(brokenId),"unresolved"); assert.equal(status(otherId),"unresolved");
  assert.deepEqual(db.prepare("SELECT * FROM sync_outbox ORDER BY rowid").all(),beforeQueue);
  assert.deepEqual(db.prepare("SELECT id,localPayload,remotePayload,basePayload FROM sync_conflicts ORDER BY id").all(),beforePayloads);
  assert.equal((await reconcileStructureConflicts(options)).resolved,0);
});
test("explicit legacy retry preserves trash and old intents until the exact Push ACK (DCC-001 DCC-003 DCC-004 DCC-007)", async () => {
  const {coalesceMutations} = await import("../src/sync/push.js");
  const {applyMutation} = await import("../src/sync/apply.js");
  const {markMutationSynced} = await import("../src/sync/outbox.js");
  const {runWithOutboxSuppressed} = await import("../src/sync/context.js");
  db.prepare("INSERT INTO notebooks(id,userId,name) VALUES ('trash-parent','local','parent')").run();
  db.prepare("INSERT INTO notebooks(id,userId,name,parentId) VALUES ('trash-child','local','child','trash-parent'),('purge-intent','local','explicit purge',NULL)").run();
  db.prepare("UPDATE notebooks SET isDeleted=1,deletedAt='2026-10-29 03:46:38' WHERE id IN ('trash-parent','trash-child','purge-intent')").run();
  const desired = tree("trash-child");
  const resource = db.prepare("SELECT * FROM notebooks WHERE id='trash-child'").get() as any;
  const remoteTree = {...desired,userId:"remote"};
  db.prepare("UPDATE knowledge_tree_nodes SET parentId=NULL WHERE id=?").run(desired.id);
  for (let n=0;n<3;n++) enqueueMutation(db,{profileId:profile.id,deviceId:"device",entityType:"knowledge_tree_node",entityId:String(desired.id),operation:"delete"});
  enqueueMutation(db,{profileId:profile.id,deviceId:"device",entityType:"knowledge_tree_node",entityId:"notebook:purge-intent",operation:"delete",payload:{purge:true,baseDeletedAt:"2026-10-29 03:46:38"}});
  db.prepare("UPDATE sync_outbox SET status='failed',lastError='MISSING_DEPENDENCY'").run();
  const originalRows=db.prepare("SELECT * FROM sync_outbox WHERE entityId=? ORDER BY rowid").all(desired.id);
  const server=fixture({snapshot:async()=>({scopeKey:"personal",snapshotSequence:42,nextCursor:null,items:[...snapshots,
    {entityType:"knowledge_tree_node",entityId:desired.id,payload:remoteTree},
    {entityType:"notebook",entityId:resource.id,payload:{...resource,userId:"remote"}}]})});
  const result=await reconcileStructureConflicts({...options,client:server,retryLegacyTrash:true,deviceId:"device"});
  assert.equal(result.requeued,1);
  const rows=db.prepare("SELECT * FROM sync_outbox WHERE entityId=? ORDER BY rowid").all(desired.id) as any[];
  assert.deepEqual(rows.slice(0,-1),originalRows);assert.equal(rows.length,4);
  const merged=coalesceMutations(rows)[0];assert.equal(merged.operation,"upsert");assert.equal(merged.payload?.isDeleted,1);
  assert.equal(merged.payload?.parentId,null);assert.equal(merged.payload?.baseParentId,remoteTree.parentId);
  const archive=db.prepare("SELECT basePayload FROM sync_conflicts WHERE entityId=? AND status='resolved' ORDER BY rowid DESC LIMIT 1").get(desired.id) as any;
  assert.deepEqual(JSON.parse(archive.basePayload).legacyOutbox,originalRows);
  assert.equal((await reconcileStructureConflicts({...options,client:server,retryLegacyTrash:true,deviceId:"device"})).requeued,0);
  // Represent the remote pre-Push projection in this isolated fixture.
  runWithOutboxSuppressed(()=>{
    db.prepare("UPDATE knowledge_tree_nodes SET isDeleted=0 WHERE id='notebook:trash-parent'").run();
    db.prepare("UPDATE knowledge_tree_nodes SET parentId='notebook:trash-parent' WHERE id='notebook:trash-child'").run();
    db.prepare("UPDATE knowledge_tree_nodes SET isDeleted=1 WHERE id='notebook:trash-parent'").run();
  });
  const response=db.transaction(()=>applyMutation(db,{...merged,userId:"local",deviceId:"device",workspaceId:null}))();
  assert.equal(response.status,"applied");
  assert.deepEqual(db.prepare("SELECT * FROM notebooks WHERE id='trash-child'").get(),resource,"business resource is neither restored nor purged");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM sync_outbox WHERE entityId=?").get(desired.id) as any).n,4);
  if(response.status==="applied") for(const id of [merged.mutationId,...merged.supersededIds]) markMutationSynced(db,id);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM sync_outbox WHERE entityId=?").get(desired.id) as any).n,0);
  assert.ok(db.prepare("SELECT 1 FROM sync_outbox WHERE entityId='notebook:purge-intent'").get());
});
test("no reconciliation on concurrent server edits, foreign owners or connection changes (DCC-006)", async () => {
  for (const client of [fixture({plan:async()=>({scopeKey:"personal",serverSequence:43})}),fixture({snapshot:async()=>({scopeKey:"personal",snapshotSequence:42,nextCursor:null,items:[{...snapshots[0],payload:{...snapshots[0].payload,userId:"foreign"}}]})})]) {
    await assert.rejects(reconcileStructureConflicts({...options,client}));
    assert.equal(status(movedId),"unresolved");
  }
  let calls=0;
  await assert.rejects(reconcileStructureConflicts({...options,assertCurrent:()=>{if(++calls>1)throw new Error("profile changed");}}));
  assert.equal(status(movedId),"unresolved");
});
test.after(() => closeDb());
