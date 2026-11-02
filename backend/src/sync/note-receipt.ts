import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
const hash=(content:string,format:string)=>createHash("sha256").update(format+"\0"+content).digest("hex");
function table(db:Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS sync_note_receipts(
    profileId TEXT NOT NULL,noteId TEXT NOT NULL,bodyHash TEXT NOT NULL,serverVersion INTEGER NOT NULL,
    source TEXT NOT NULL,PRIMARY KEY(profileId,noteId))`);
}
/** Record only a matching durable ACK or applied snapshot, never an aggregate sync timestamp. */
export function recordNoteReceipt(db:Database.Database,profileId:string,noteId:string,content:unknown,format:unknown,version:unknown,source:string) {
  if(typeof content!=="string"||typeof format!=="string"||!Number.isSafeInteger(version)||Number(version)<1)return;
  table(db);
  db.prepare(`INSERT INTO sync_note_receipts VALUES(?,?,?,?,?) ON CONFLICT(profileId,noteId)
    DO UPDATE SET bodyHash=excluded.bodyHash,serverVersion=excluded.serverVersion,source=excluded.source`)
    .run(profileId,noteId,hash(content,format),version,source);
}
export function readNoteReceipt(db:Database.Database,profileId:string,noteId:string) {
  const note=db.prepare("SELECT content,contentFormat,version FROM notes WHERE id=?").get(noteId) as {content:string;contentFormat:string;version:number}|undefined;
  const result=(phase:string,version:number|null=null)=>({phase,localRevision:note?.version??null,acknowledgedRevision:version});
  if(!note)return result("unverified");
  const conflict=db.prepare(`SELECT 1 FROM sync_conflicts WHERE profileId=? AND status='unresolved'
    AND ((entityType='note' AND entityId=?) OR (entityType='knowledge_tree_node' AND entityId=?)) LIMIT 1`).get(profileId,noteId,`note:${noteId}`);
  if(conflict)return result("conflict");
  const pending=db.prepare(`SELECT status,lastError FROM sync_outbox WHERE profileId=? AND entityType='note' AND entityId=?
    AND status IN ('pending','inflight','failed')`).all(profileId,noteId) as {status:string;lastError:string|null}[];
  if(pending.some(row=>row.status==="failed"||row.lastError))return result("error");
  if(pending.length)return result("pending");
  table(db);
  const receipt=db.prepare("SELECT bodyHash,serverVersion FROM sync_note_receipts WHERE profileId=? AND noteId=?").get(profileId,noteId) as {bodyHash:string;serverVersion:number}|undefined;
  return receipt && receipt.serverVersion===note.version && receipt.bodyHash===hash(note.content,note.contentFormat)
    ?result("confirmed",receipt.serverVersion):result("unverified");
}
