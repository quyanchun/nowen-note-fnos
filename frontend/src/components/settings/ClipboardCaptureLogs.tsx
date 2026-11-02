import { useEffect, useRef, useState } from "react";
import { Trash2, Download, Undo2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clipboardIntegrationApi, type ClipboardLog } from "@/lib/clipboardIntegration";

export default function ClipboardCaptureLogs() {
  const {i18n}=useTranslation();
  const zh=i18n.language.startsWith("zh");
  const [rows,setRows]=useState<ClipboardLog[]>([]),[offset,setOffset]=useState(0),[more,setMore]=useState(false);
  const [acting,setActing]=useState<string|null>(null),[notice,setNotice]=useState("");
  const actionLock=useRef(false);
  const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{
    let disposed=false;setBusy(true);setError("");
    clipboardIntegrationApi.logs(offset).then(result=>{if(!disposed){setRows(result.items);setMore(result.hasMore);}})
      .catch(e=>{if(!disposed)setError(e.message);}).finally(()=>{if(!disposed)setBusy(false);});
    return()=>{disposed=true;};
  },[offset,revision]);
  useEffect(()=>{
    if(!rows.some(row=>row.status==="queued"||row.status==="processing"))return;
    const timer=setInterval(()=>setRevision(value=>value+1),5000);
    return()=>clearInterval(timer);
  },[rows]);
  const action=async(row:ClipboardLog,kind:"delete"|"force"|"undo")=>{
    if(actionLock.current)return;actionLock.current=true;setActing(`${row.requestId}:${kind}`);setError("");setNotice("");
    try {
      await (kind==="delete"?clipboardIntegrationApi.deleteLog(row.requestId):kind==="force"?clipboardIntegrationApi.forceLog(row.requestId):clipboardIntegrationApi.undoLog(row.requestId));
      setNotice(kind==="delete"?(zh?"日志已删除，笔记内容不变":"Log deleted; note unchanged"):kind==="force"?(zh?"已绕过过滤并重新排队，处理后会显示归档位置":"Filters bypassed; queued for filing"):(zh?"已撤销本次收集；原有目录和图片文件保留":"Collection undone; folders and image files retained"));
      if(kind==="delete"&&rows.length===1&&offset)setOffset(x=>Math.max(0,x-30));else setRevision(x=>x+1);
    }catch(e){setError(e instanceof Error?e.message:zh?"操作未完成，可重试":"Action failed; retry available");}
    finally{actionLock.current=false;setActing(null);}
  };
  const status=(value:string)=>({undone:zh?"已撤销":"Undone",completed:zh?"成功":"Saved",failed:zh?"失败":"Failed",filtered:zh?"已过滤":"Filtered",queued:zh?"排队中":"Queued",processing:zh?"处理中":"Processing"})[value]||value;
  const reason=(code:string|null)=>/^CAPTURE_IMAGE_HTTP_\d{3}$/.test(code||"")
    ? (zh?`图片模型接口返回 HTTP ${code!.slice(-3)}`:`Image model returned HTTP ${code!.slice(-3)}`)
    : ({
    CAPTURE_INVALID_PLAN:zh?"AI归档方案无效，原文已保留":"Invalid filing plan; original retained",
    CAPTURE_TARGET_FORBIDDEN:zh?"目标已删除、加密或不在授权范围内":"Target deleted, protected or outside permission",
    CAPTURE_AI_TIMEOUT:zh?"AI处理超时，可重试":"AI timed out; retry available",
    AI_FILTERED:zh?"AI判断无需收集":"Skipped by AI",
    CAPTURE_UNCLEAR_PURPOSE:zh?"无法确认用途，已跳过；未创建目录或笔记":"Purpose unclear; skipped without creating folders or notes",
    IMAGE_FILTERED:zh?"图片被规则过滤":"Skipped by image rule",
    FILE_FILTERED:zh?"文件被规则过滤":"Skipped by file rule",
    CAPTURE_IMAGE_INVALID:zh?"图片格式无效，原文和任务已保留":"Invalid image; task retained",
    CAPTURE_IMAGE_DESCRIPTION_FAILED:zh?"图片识别失败，旧记录未保存具体原因；可重试":"Image recognition failed; older record has no detailed cause. Retry available",
    CAPTURE_IMAGE_TIMEOUT:zh?"图片模型请求超时，已自动重试一次":"Image model timed out after one automatic retry",
    CAPTURE_IMAGE_NETWORK:zh?"无法连接图片模型服务，已自动重试一次":"Image model connection failed after one automatic retry",
    CAPTURE_IMAGE_INVALID_RESPONSE:zh?"图片模型返回了无效响应":"Image model returned an invalid response",
    CAPTURE_IMAGE_EMPTY_RESPONSE:zh?"图片模型未返回可用描述":"Image model returned no usable description",
    CAPTURE_IMAGE_TRUNCATED_RESPONSE:zh?"图片模型输出被截断，增加额度重试后仍未完成":"Image output remained truncated after retrying with a higher token budget",
    CAPTURE_IMAGE_MODEL_UNAVAILABLE:zh?"多模态渠道不可用，请重新选择":"Multimodal channel unavailable",
    CAPTURE_IMAGE_SAVE_FAILED:zh?"图片未完整保存，可重试":"Image saving incomplete; retry available",
    MULTIMODAL_NOT_CONFIGURED:zh?"图片已保存，未配置多模态模型，保留原说明":"Image saved with original alt text; no multimodal model configured",
  })[code||""]||code;
  return <section aria-label={zh?"收集日志":"Collection log"} className="space-y-3">
    <div className="flex justify-between text-sm"><span className="text-tx-secondary">{zh?"当前账号的服务端收集记录":"Server collection history for this account"}</span><button type="button" disabled={busy||!!acting} onClick={()=>setRevision(x=>x+1)} className="text-accent-primary">{zh?"刷新":"Refresh"}</button></div>
    {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
    {notice&&<p role="status" className="text-sm text-emerald-600">{notice}</p>}
    {busy&&<p role="status" className="text-sm text-tx-secondary">{zh?"加载中…":"Loading…"}</p>}
    {!busy&&!error&&!rows.length&&<p className="py-8 text-center text-sm text-tx-secondary">{zh?"暂无收集记录":"No collection records"}</p>}
    {rows.map(row=><article key={row.requestId} className="relative space-y-1 rounded-lg border border-app-border p-3 text-sm">
      <div className="flex justify-between gap-3"><span className={row.status==="failed"?"text-red-500":row.status==="completed"?"text-emerald-600":"text-tx-secondary"}>{status(row.status)}</span><time className="text-xs text-tx-tertiary">{row.createdAt?new Date(row.createdAt.replace(" ","T")+(row.createdAt.includes("Z")?"":"Z")).toLocaleString():"—"}</time></div>
      <p className="line-clamp-2 break-words text-tx-primary">{row.preview}</p>
      {row.path&&<p className="break-words text-xs text-tx-secondary">{row.action==="append"?(zh?"追加至：":"Appended to: "):(zh?"新建于：":"Created in: ")}{row.path}</p>}
      {row.code&&<p className="text-xs text-tx-secondary" title={row.code}>{row.errorMessage||reason(row.code)}</p>}
      {!!row.imageCount&&<p className="text-xs text-tx-secondary">{zh?`已保存 ${row.imageCount} 张图片`:`${row.imageCount} image(s) saved`}</p>}
      {row.warnings?.map(warning=><p key={warning} className="text-xs text-amber-600">{reason(warning)}</p>)}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-xs text-tx-tertiary">{row.sourceApp}</span>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label={zh?"日志操作":"Log actions"}>
          {([{kind:"delete",Icon:Trash2,label:zh?"删除":"Delete",enabled:true,tip:zh?"删除此日志，不删除笔记":"Delete this log only"},
            {kind:"force",Icon:Download,label:zh?"强制收集":"Force collect",enabled:row.canForce,tip:row.canForce?(zh?"绕过规则和 AI 过滤，重新整理归档":"Bypass rules and AI filtering, then file again"):(["queued","processing","completed"].includes(row.status)?(zh?"已收集或正在处理，不重复提交":"Already saved or processing"):(zh?"旧记录未保留完整原文，请重新提交":"Original missing from this older record; submit again"))},
            {kind:"undo",Icon:Undo2,label:zh?"撤销":"Undo",enabled:row.canUndo,tip:zh?"撤回本次新建或追加；后续修改会受保护":"Undo this creation or append; protect later edits"}] as const).map(({kind,Icon,label,enabled,tip})=><span key={kind} title={tip}><button type="button" aria-label={label} disabled={!!acting||busy||!enabled} onClick={()=>void action(row,kind)} className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-bg-secondary disabled:cursor-not-allowed disabled:opacity-30 ${kind==="delete"?"text-tx-tertiary hover:text-red-500":"text-tx-secondary hover:text-accent-primary"}`}>
              {acting===`${row.requestId}:${kind}`?<Loader2 size={14} className="animate-spin"/>:<Icon size={14}/>}</button></span>)}
        </div>
      </div>
    </article>)}
    <div className="flex justify-between text-sm"><button type="button" disabled={busy||!!acting||!offset} onClick={()=>setOffset(x=>Math.max(0,x-30))}>{zh?"上一页":"Previous"}</button><button type="button" disabled={busy||!!acting||!more} onClick={()=>setOffset(x=>x+30)}>{zh?"下一页":"Next"}</button></div>
  </section>;
}
