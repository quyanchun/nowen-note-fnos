import './setup-db-isolation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {getDb,closeDb} from '../src/db/schema';
import {createProfile,switchActiveProfile} from '../src/sync/profile';
import {markKnowledgeTreeSyncReady} from '../src/sync/knowledgeTreeReadiness';
import {SyncEngine} from '../src/sync/engine';
import {enqueueMutation} from '../src/sync/outbox';
import {applyKnowledgeTreeChangesLocal} from '../src/sync/knowledgeTreeApplyLocal';
const db=getDb();test.after(()=>closeDb());
const tree=(id:string)=>db.prepare('SELECT * FROM knowledge_tree_nodes WHERE id=?').get(`notebook:${id}`) as any;
test('snapshot negotiation preserves prepared trash intentions and accepts nested trash without regenerating conflicts (DCC-003 DCC-004 DCC-007)',async()=>{
 db.prepare("INSERT INTO users(id,username,passwordHash) VALUES('review-local','review-local','x')").run();
 for(const id of ['parent','child','grandchild'])db.prepare("INSERT INTO notebooks(id,userId,name,isDeleted) VALUES(?,'review-local',?,1)").run(id,id);
 const profile=createProfile(db,{name:'review',serverUrl:'https://notes.test',remoteUserId:'review-remote'});switchActiveProfile(db,profile.id);markKnowledgeTreeSyncReady(db,profile.id);
 db.prepare("UPDATE sync_profiles SET bootstrapStatus='ready' WHERE id=?").run(profile.id);
 const child=tree('child'),grandchild=tree('grandchild'),other={...child,userId:'review-remote',parentId:'notebook:parent'};
 enqueueMutation(db,{profileId:profile.id,deviceId:'review-device',entityType:'knowledge_tree_node',entityId:child.id,operation:'upsert',payload:{...child,baseParentId:other.parentId,baseSortOrder:other.sortOrder,baseIsDeleted:other.isDeleted,baseDeletedAt:other.deletedAt}});
 const items=[...['parent','child','grandchild'].map(id=>({entityType:'notebook',entityId:id,payload:{...(db.prepare('SELECT * FROM notebooks WHERE id=?').get(id) as any),userId:'review-remote'}})),
 ...[tree('parent'),other,{...grandchild,parentId:child.id}].map(p=>({entityType:'knowledge_tree_node',entityId:p.id,payload:{...p,userId:'review-remote'}}))];
 let acked=0;const client={snapshot:async()=>({items,scopeKey:'personal',snapshotSequence:42,nextCursor:null}),ack:async()=>{acked++;}} as any;
 const engine=new SyncEngine({db,profileId:profile.id,userId:'review-local',deviceId:'review-device',client,intervalMs:0}) as any;engine.assetSubscribed=true;
 await engine.runSnapshotRebuild({scopeKey:'personal',workspaceId:null});
 assert.equal(tree('child').parentId,null,'pending explicit placement retained');assert.equal(tree('grandchild').parentId,child.id,'nested trash is valid');assert.equal(tree('grandchild').isDeleted,1);
 assert.equal(db.prepare("SELECT count(*) AS n FROM sync_conflicts WHERE status='unresolved'").get().n,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM sync_outbox').get().n,1,'snapshot ACK is not mutation ACK');assert.equal(acked,1);
 const active={...tree('grandchild'),isDeleted:0,deletedAt:null};
 assert.throws(()=>applyKnowledgeTreeChangesLocal(db,[{entityId:active.id,operation:'upsert',payload:active}],{userId:'review-local',workspaceId:null}),/父节点/,'active content still cannot move under trash');
});
