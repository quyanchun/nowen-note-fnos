import {randomUUID,createHash} from "node:crypto";
import {z} from "zod";
import {getDb} from "../db/schema";
import {CaptureError,captureInput,getCapture,presentCapture,retryCapture,submitCapture,type CaptureInput} from "./captures";
import {clipboardSubmissionSchema,getClipboardSettings,initClipboardIntegration} from "./clipboard-integration";
import {undoCapture,prepareCaptureUndo} from "./capture-undo";
import {clipboardQualityFilter} from "./clipboard-quality";

function entry(userId:string,requestId:string) {
  initClipboardIntegration();const db=getDb();
  if(!db.prepare("SELECT 1 FROM users WHERE id=? AND isDisabled=0").get(userId))throw new CaptureError("CAPTURE_FORBIDDEN","账号不可用",403);
  const row=db.prepare(`SELECT s.*,a.forcedJobId FROM (
    SELECT requestId,jobId,originalInput,1 AS filtered FROM clipboard_submissions WHERE userId=? AND requestId=?
    UNION ALL SELECT requestId,NULL,originalInput,0 FROM clipboard_rejections WHERE userId=? AND requestId=?
  ) s LEFT JOIN clipboard_log_actions a ON a.userId=? AND a.requestId=s.requestId WHERE a.hiddenAt IS NULL LIMIT 1`).get(userId,requestId,userId,requestId,userId) as {jobId:string|null;originalInput:string|null;forcedJobId:string|null;filtered:number}|undefined;
  if(!row)throw new CaptureError("CAPTURE_NOT_FOUND","收集记录不存在或已删除",404);return row;
}
export function deleteClipboardLog(userId:string,requestId:string) {
  entry(userId,requestId);getDb().prepare(`INSERT INTO clipboard_log_actions(userId,requestId,hiddenAt) VALUES(?,?,datetime('now'))
    ON CONFLICT(userId,requestId) DO UPDATE SET hiddenAt=excluded.hiddenAt`).run(userId,requestId);
  return {deleted:true};
}
function manualInput(userId:string,requestId:string,originalInput:string|null,job:ReturnType<typeof getCapture>|null,content?:string) {
  if(job && (!originalInput || content!==undefined)) {
    const {aiFilterPrompt,...source}=JSON.parse(job.input);
    return captureInput.parse({...source,requestId,content:content??source.content,
      organize:content===undefined&&source.organize,minFolderDepth:1,autoCollect:false});
  }
  if(!originalInput && content===undefined)throw new CaptureError("CAPTURE_ORIGINAL_MISSING","这条旧记录未保留完整原文，请补充原文后再收集。",409);
  const settings=getClipboardSettings(userId).settings;
  const source=originalInput?clipboardSubmissionSchema.parse(JSON.parse(originalInput)):null;
  return captureInput.parse({requestId,content:content??source?.content,organize:content===undefined&&(source?.organize??settings.organize),
    instruction:[settings.instruction,source?.instruction].filter(Boolean).join("\n").slice(0,2000),
    systemPrompt:settings.systemPrompt||undefined,notebookId:source?.notebookId||settings.notebookId||undefined,noteId:source?.noteId,
    images:source?.images,minFolderDepth:1,autoCollect:false});
}
function queueManualCapture(userId:string,requestId:string,input:CaptureInput,replacesJobId:string|null=null) {
  const db=getDb(),actor={userId,tokenId:null};
  const {job}=submitCapture(actor,input);
  db.prepare("UPDATE capture_jobs SET forceCollect=1,replacesJobId=? WHERE id=?").run(replacesJobId,job.id);
  db.prepare(`INSERT INTO clipboard_log_actions(userId,requestId,forcedJobId) VALUES(?,?,?)
    ON CONFLICT(userId,requestId) DO UPDATE SET forcedJobId=excluded.forcedJobId`).run(userId,requestId,job.id);
  return presentCapture(getCapture(actor,job.id));
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
    const input=manualInput(userId,`manual-${randomUUID()}`,row.originalInput,existing);
    return queueManualCapture(userId,requestId,input);
  })();
}
export async function undoClipboardLog(userId:string,requestId:string) {
  const row=entry(userId,requestId),id=row.forcedJobId||row.jobId;
  if(!id)throw new CaptureError("CAPTURE_NOT_COMPLETED","这条内容尚未收集，无需撤销",409);
  return undoCapture({userId,tokenId:null},id);
}

export const editClipboardLogSchema=z.object({
  jobId:z.string().min(1).max(160).nullable(),requestId:z.string().min(1).max(120),content:captureInput.shape.content,
}).strict();
export function getClipboardLogContent(userId:string,requestId:string) {
  const row=entry(userId,requestId),id=row.forcedJobId||row.jobId;
  if(!id&&row.filtered)return {jobId:null,content:row.originalInput?clipboardSubmissionSchema.parse(JSON.parse(row.originalInput)).content:""};
  if(!id)throw new CaptureError("CAPTURE_EDIT_UNAVAILABLE","此记录不能编辑",409);
  const job=getCapture({userId,tokenId:null},id);
  if(!["completed","filtered"].includes(job.status)||job.undoneAt)throw new CaptureError("CAPTURE_EDIT_UNAVAILABLE","只有成功或已过滤的收集记录可以编辑",409);
  return {jobId:job.id,content:JSON.parse(job.input).content as string};
}
export async function editClipboardLog(userId:string,requestId:string,value:z.infer<typeof editClipboardLogSchema>) {
  const parsed=editClipboardLogSchema.safeParse(value);
  if(!parsed.success)throw new CaptureError("CAPTURE_INVALID_INPUT","请填写完整内容，最多32000字符",400);
  if(clipboardQualityFilter(parsed.data.content)?.sensitive)throw new CaptureError("CAPTURE_CONTEXT_REQUIRED","请先补充账号或密码所属的服务，再提交收集",409);
  const input=parsed.data,actor={userId,tokenId:null};
  const operationId=`edit-${createHash("sha256").update(JSON.stringify([requestId,input.jobId,input.requestId])).digest("hex")}`;
  return getDb().transaction(()=>{
    const row=entry(userId,requestId),id=row.forcedJobId||row.jobId;
    const job=id?getCapture(actor,id):null;
    if(job?.requestId===operationId) {
      if(JSON.parse(job.input).content!==input.content)throw new CaptureError("CAPTURE_REQUEST_CONFLICT","同一请求不能提交不同内容",409);
      return presentCapture(job);
    }
    if((job?.id??null)!==input.jobId)throw new CaptureError("CAPTURE_EDIT_CONFLICT","收集记录已变化，请重新打开编辑",409);
    if(job?job.status==="filtered":row.filtered) {
      const next=manualInput(userId,operationId,row.originalInput,job,input.content);
      return queueManualCapture(userId,requestId,next);
    }
    if(!job||job.status!=="completed"||job.undoneAt)throw new CaptureError("CAPTURE_EDIT_UNAVAILABLE","只有成功或已过滤的收集记录可以编辑",409);
    const {aiFilterPrompt,...source}=JSON.parse(job.input);
    const next=captureInput.parse({...source,requestId:operationId,content:input.content,organize:true,autoCollect:true});
    // Validate now, but preserve the original until a replacement is ready to commit.
    prepareCaptureUndo(actor,job.id);
    return queueManualCapture(userId,requestId,next,job.id);
  })();
}
