import {getDb} from "../db/schema";
import {CaptureError,getCapture,initCaptures,type CaptureActor} from "./captures";
import {registerCaptureReceipt} from "./capture-receipt";
import {projectMarkdownForUser} from "../lib/markdownUserContent";
import {encryptedBlocksInContent,isEncryptedNoteFormat} from "../lib/encryptedNotes";
import {canViewNoteThroughFolderPasswords} from "../lib/knowledgeTreePasswordAccess";
import {notifySyncChanged} from "../sync/notify";

type Note=Record<string,any>;
const visible=(note:Note)=>note.contentFormat==="markdown"?projectMarkdownForUser(note.content):note.content;
const changed=()=>new CaptureError("CAPTURE_UNDO_CONFLICT","笔记在收集后已有其他修改，无法安全撤销；当前内容已保留。",409);
function remainingContent(before:Note,after:Note,current:Note):string {
  if(current.contentFormat!==after.contentFormat)throw changed();
  if(current.content===after.content||visible(current)===visible(after))return before.content;
  // A later append is independent: remove this capture's range, keeping the subsequent tail.
  if(current.content.startsWith(after.content))return before.content+current.content.slice(after.content.length);
  if(current.contentFormat==="tiptap-json")try {
    const a=JSON.parse(after.content),b=JSON.parse(before.content),c=JSON.parse(current.content);
    if(Array.isArray(a.content)&&Array.isArray(b.content)&&Array.isArray(c.content)
      &&JSON.stringify(c.content.slice(0,a.content.length))===JSON.stringify(a.content))return JSON.stringify({...c,content:[...b.content,...c.content.slice(a.content.length)]});
  }catch{/* Refuse to guess a changed document. */}
  throw changed();
}
function legacyBefore(note:Note,result:any,plan:any,jobId:string):Note|null {
  if(note.version!==result.version||note.notebookId!==result.notebookId)throw changed();
  if(result.action==="create") {
    if(note.id!==jobId||note.title!==plan?.title||visible(note)!==result.content)throw changed();
    return null;
  }
  const addition=String(result.content||"");if(!addition)throw changed();
  if(["markdown","plaintext"].includes(note.contentFormat)) {
    const positions=[0,...[...note.content.matchAll(/\n\n/g)].map(m=>m.index!+2)];
    const candidates=positions.filter(pos=>visible({...note,content:note.content.slice(pos)})===addition);
    if(candidates.length===1)return {...note,content:note.content.slice(0,Math.max(0,candidates[0]-2))};
  }
  if(note.contentFormat==="html") {
    const escaped=addition.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const tail=escaped.split(/\n\s*\n/).map(text=>`<p>${text.replace(/\n/g,"<br>")}</p>`).join("");
    if(note.content.endsWith(tail))return {...note,content:note.content.slice(0,-tail.length)};
  }
  throw new CaptureError("CAPTURE_UNDO_UNAVAILABLE","这条旧记录没有完整撤销快照，无法安全还原；笔记保持不变。",409);
}
export async function undoCapture(actor:CaptureActor,id:string) {
  initCaptures();const db=getDb(),job=getCapture(actor,id);
  if(job.undoneAt)return {undone:true,noteId:JSON.parse(job.result!).noteId};
  if(job.status!=="completed"||!job.result)throw new CaptureError("CAPTURE_NOT_COMPLETED","只有已成功收集的内容可以撤销",409);
  const result=JSON.parse(job.result),current=db.prepare("SELECT * FROM notes WHERE id=? AND userId=? AND workspaceId IS NULL").get(result.noteId,actor.userId) as Note|undefined;
  if(!current||current.isTrashed||current.isLocked||isEncryptedNoteFormat(current.contentFormat)
    ||!canViewNoteThroughFolderPasswords(db,current.id,new Set())||encryptedBlocksInContent(current.content,current.contentFormat).length)throw new CaptureError("CAPTURE_TARGET_FORBIDDEN","笔记已删除、锁定或受保护，未执行撤销",409);
  const snapshot=job.undoSnapshot?JSON.parse(job.undoSnapshot):null;
  const before=snapshot?.before??(snapshot?null:legacyBefore(current,result,job.plan?JSON.parse(job.plan):null,job.id));
  const after=snapshot?.after||current;
  let body:Record<string,unknown>;
  if(result.action==="create") {
    if(visible(current)!==visible(after)||["title","notebookId","contentFormat"].some(key=>current[key]!==after[key])
      ||db.prepare("SELECT 1 FROM knowledge_tree_nodes WHERE parentId=? LIMIT 1").get(`note:${current.id}`))throw changed();
    if(snapshot?.attachmentIds) {
      const attachments=db.prepare("SELECT id FROM attachments WHERE noteId=? ORDER BY id").all(current.id) as {id:string}[];
      if(JSON.stringify(attachments.map(a=>a.id))!==JSON.stringify(snapshot.attachmentIds))throw changed();
    }
    body={isTrashed:1,version:current.version};
  }else body={content:remainingContent(before!,after,current),version:current.version};
  const request=new Request(`http://nowen.internal/${encodeURIComponent(current.id)}`,{method:"PUT",headers:{"Content-Type":"application/json","X-User-Id":actor.userId},body:JSON.stringify(body)});
  registerCaptureReceipt(request,()=>{
    const updated=db.prepare("UPDATE capture_jobs SET undoneAt=datetime('now'),updatedAt=datetime('now') WHERE id=? AND userId=? AND undoneAt IS NULL AND status='completed'").run(id,actor.userId);
    if(!updated.changes)throw new CaptureError("CAPTURE_ALREADY_UNDONE","此项已撤销",409);
  },false,()=>{
    const latest=db.prepare("SELECT content,contentFormat,version FROM notes WHERE id=? AND userId=?").get(current.id,actor.userId) as Note;
    if(!latest||latest.version!==current.version||latest.content!==current.content||latest.contentFormat!==current.contentFormat)throw changed();
    if(getCapture(actor,id).undoneAt)throw new CaptureError("CAPTURE_ALREADY_UNDONE","此项已撤销",409);
  });
  const router=(await import("../routes/notes")).default;
  const response=await router.fetch(request);
  if(!response.ok) {
    if(getCapture(actor,id).undoneAt)return {undone:true,noteId:current.id};
    const error=await response.json().catch(()=>({})) as any;
    throw new CaptureError(error.code||"CAPTURE_UNDO_FAILED",error.error||"撤销未完成，当前内容已保留，可重试",response.status);
  }
  if(!getCapture(actor,id).undoneAt)throw new CaptureError("CAPTURE_UNDO_FAILED","撤销确认缺失，请刷新状态",500);
  notifySyncChanged(db,actor.userId,"personal");return {undone:true,noteId:current.id};
}
