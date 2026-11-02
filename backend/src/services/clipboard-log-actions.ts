import {randomUUID} from "node:crypto";
import {getDb} from "../db/schema";
import {CaptureError,captureInput,getCapture,presentCapture,retryCapture,submitCapture} from "./captures";
import {clipboardSubmissionSchema,getClipboardSettings,initClipboardIntegration} from "./clipboard-integration";
import {undoCapture} from "./capture-undo";

function entry(userId:string,requestId:string) {
  initClipboardIntegration();const db=getDb();
  if(!db.prepare("SELECT 1 FROM users WHERE id=? AND isDisabled=0").get(userId))throw new CaptureError("CAPTURE_FORBIDDEN","账号不可用",403);
  const row=db.prepare(`SELECT s.*,a.forcedJobId FROM (
    SELECT requestId,jobId,originalInput FROM clipboard_submissions WHERE userId=? AND requestId=?
    UNION ALL SELECT requestId,NULL,originalInput FROM clipboard_rejections WHERE userId=? AND requestId=?
  ) s LEFT JOIN clipboard_log_actions a ON a.userId=? AND a.requestId=s.requestId WHERE a.hiddenAt IS NULL LIMIT 1`).get(userId,requestId,userId,requestId,userId) as {jobId:string|null;originalInput:string|null;forcedJobId:string|null}|undefined;
  if(!row)throw new CaptureError("CAPTURE_NOT_FOUND","日志不存在或已删除",404);return row;
}
export function deleteClipboardLog(userId:string,requestId:string) {
  entry(userId,requestId);getDb().prepare(`INSERT INTO clipboard_log_actions(userId,requestId,hiddenAt) VALUES(?,?,datetime('now'))
    ON CONFLICT(userId,requestId) DO UPDATE SET hiddenAt=excluded.hiddenAt`).run(userId,requestId);
  return {deleted:true};
}
export function forceClipboardLog(userId:string,requestId:string) {
  return getDb().transaction(()=>{
    const row=entry(userId,requestId),actor={userId,tokenId:null};
    const existing=row.forcedJobId||row.jobId?getCapture(actor,(row.forcedJobId||row.jobId)!):null;
    if(existing&&!existing.undoneAt) {
      if(row.forcedJobId&&["queued","processing"].includes(existing.status))return presentCapture(existing);
      if(row.forcedJobId&&existing.status==="failed")return presentCapture(retryCapture(actor,existing.id));
      if(!["filtered","failed"].includes(existing.status))throw new CaptureError("CAPTURE_FORCE_UNAVAILABLE","这条内容已收集或正在处理，不会重复收集",409);
    }
    const settings=getClipboardSettings(userId).settings;
    let input;
    if(row.originalInput) {
      const source=clipboardSubmissionSchema.parse(JSON.parse(row.originalInput));
      input=captureInput.parse({requestId:`manual-${randomUUID()}`,content:source.content,organize:source.organize??settings.organize,
        instruction:[settings.instruction,source.instruction].filter(Boolean).join("\n").slice(0,2000),
        systemPrompt:settings.systemPrompt||undefined,notebookId:source.notebookId||settings.notebookId||undefined,noteId:source.noteId,images:source.images,minFolderDepth:1});
    }else if(existing) {
      const {aiFilterPrompt,...source}=JSON.parse(existing.input);
      input=captureInput.parse({...source,requestId:`manual-${randomUUID()}`,minFolderDepth:1});
    }else throw new CaptureError("CAPTURE_ORIGINAL_MISSING","这条旧日志只保留了预览，无法强制收集完整内容；请重新提交原文。",409);
    const result=submitCapture(actor,input);getDb().prepare("UPDATE capture_jobs SET forceCollect=1 WHERE id=?").run(result.job.id);
    getDb().prepare(`INSERT INTO clipboard_log_actions(userId,requestId,forcedJobId) VALUES(?,?,?)
      ON CONFLICT(userId,requestId) DO UPDATE SET forcedJobId=excluded.forcedJobId`).run(userId,requestId,result.job.id);
    return presentCapture(getCapture(actor,result.job.id));
  })();
}
export async function undoClipboardLog(userId:string,requestId:string) {
  const row=entry(userId,requestId),id=row.forcedJobId||row.jobId;
  if(!id)throw new CaptureError("CAPTURE_NOT_COMPLETED","这条内容尚未收集，无需撤销",409);
  return undoCapture({userId,tokenId:null},id);
}
