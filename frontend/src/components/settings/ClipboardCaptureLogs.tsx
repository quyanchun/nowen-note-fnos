import { useEffect, useRef, useState } from "react";
import { Trash2, Download, Undo2, Loader2, Pencil, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clipboardIntegrationApi, type ClipboardLog,type ClipboardRecordFilter } from "@/lib/clipboardIntegration";
import { api,getCurrentWorkspace,setCurrentWorkspace,getServerUrl } from "@/lib/api";
import { getAccessToken } from "@/lib/authSession";
import { getOfflineQueueStorageKey } from "@/lib/offlineScope";
import { pushNoteAppPath } from "@/lib/noteDeepLink";
import type { Note } from "@/types";
import { toast } from "@/lib/toast";

export default function ClipboardCaptureLogs({onOpenNote,serverUrl}:{onOpenNote?:(note:Note)=>void;serverUrl?:string}={}) {
  const {i18n}=useTranslation();
  const zh=i18n.language.startsWith("zh");
  const [rows,setRows]=useState<ClipboardLog[]>([]),[offset,setOffset]=useState(0),[more,setMore]=useState(false);
  const [filter,setFilter]=useState<ClipboardRecordFilter>("all");
  const [acting,setActing]=useState<string|null>(null);
  const actionLock=useRef(false);
  const [editing,setEditing]=useState<{id:string;jobId:string|null;requestId:string;content:string;scope:string;filtered:boolean}|null>(null);
  const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{
    let disposed=false;setBusy(true);setError("");
    clipboardIntegrationApi.logs(offset,filter).then(result=>{if(!disposed){setRows(result.items);setMore(result.hasMore);}})
      .catch(e=>{if(!disposed)setError(e.message);}).finally(()=>{if(!disposed)setBusy(false);});
    return()=>{disposed=true;};
  },[offset,revision,filter]);
  useEffect(()=>{
    if(!rows.some(row=>row.status==="queued"||row.status==="processing"))return;
    const timer=setInterval(()=>setRevision(value=>value+1),5000);
    return()=>clearInterval(timer);
  },[rows]);
  const action=async(row:ClipboardLog,kind:"delete"|"force"|"undo")=>{
    if(actionLock.current)return;actionLock.current=true;setActing(`${row.requestId}:${kind}`);setError("");
    try {
      await (kind==="delete"?clipboardIntegrationApi.deleteLog(row.requestId):kind==="force"?clipboardIntegrationApi.forceLog(row.requestId):clipboardIntegrationApi.undoLog(row.requestId));
      toast.success(kind==="delete"?(zh?"记录已删除，笔记内容不变":"Record deleted; note unchanged"):kind==="force"?(zh?"已绕过过滤并重新排队，处理后会显示归档位置":"Filters bypassed; queued for filing"):(zh?"已撤销本次收集；原有目录和图片文件保留":"Collection undone; folders and image files retained"));
      if(kind==="force"&&filter==="filtered"){setFilter("all");setOffset(0);}
      if(kind==="delete"&&rows.length===1&&offset)setOffset(x=>Math.max(0,x-30));else setRevision(x=>x+1);
    }catch(e){toast.error(e instanceof Error?e.message:zh?"操作未完成，可重试":"Action failed; retry available");}
    finally{actionLock.current=false;setActing(null);}
  };
  const edit=async(row:ClipboardLog)=>{
    if(actionLock.current)return;actionLock.current=true;setActing(row.requestId+":edit");setError("");
    const scope=getOfflineQueueStorageKey();
    try {
      const source=await clipboardIntegrationApi.logContent(row.requestId);
      if(scope!==getOfflineQueueStorageKey())throw new Error(zh?"账号或服务器已切换，请重试":"Account or server changed; retry");
      setEditing({id:row.requestId,...source,scope,filtered:row.status==="filtered",requestId:crypto.randomUUID()});
    }
    catch(e){toast.error(e instanceof Error?e.message:String(e));}
    finally {actionLock.current=false;setActing(null);}
  };
  const saveEdited=async()=>{
    if(!editing||actionLock.current)return;
    if(editing.scope!==getOfflineQueueStorageKey()){setEditing(null);toast.error(zh?"账号或服务器已切换，请重试":"Account or server changed; retry");return;}
    actionLock.current=true;setActing(editing.id+":edit");setError("");
    try {
      await clipboardIntegrationApi.editLog(editing.id,{jobId:editing.jobId,requestId:editing.requestId,content:editing.content});
      if(filter==="filtered"){setFilter("all");setOffset(0);}
      setEditing(null);toast.success(editing.filtered?(zh?"已排队收集修改后的原文":"Edited text queued for collection"):(zh?"已排队重新整理":"Queued for reorganization"));setRevision(x=>x+1);
    }
    catch(e){toast.error(e instanceof Error?e.message:String(e));}
    finally {actionLock.current=false;setActing(null);}
  };
  const openNote=async(row:ClipboardLog)=>{
    if(!row.noteId||actionLock.current)return;actionLock.current=true;setActing(row.requestId+":open");setError("");
    const token=getAccessToken(),server=getServerUrl();
    try {
      const note=await api.getNote(row.noteId);
      if(token!==getAccessToken()||server!==getServerUrl())throw new Error(zh?"账号或服务器已切换，请重试":"Account or server changed; retry");
      if(note.isTrashed)throw new Error(zh?"笔记已进入回收站":"Note is in Trash");
      if((getCurrentWorkspace()||null)!==(note.workspaceId||null)){setCurrentWorkspace(note.workspaceId||"");window.dispatchEvent(new CustomEvent("nowen:workspace-changed",{detail:{workspaceId:note.workspaceId||null}}));}
      pushNoteAppPath(note.id);onOpenNote?.(note);
    }catch(e){
      if((e as {status?:number})?.status===404&&serverUrl&&token===getAccessToken()&&server===getServerUrl()){
        try {const target=new URL(serverUrl);if(!["https:","http:"].includes(target.protocol)||target.username||target.password)throw e;target.pathname=target.pathname.replace(/\/+$/,"")+"/notes/"+encodeURIComponent(row.noteId);target.search="";target.hash="";window.open(target.href,"_blank","noopener,noreferrer");}
        catch{toast.error(e instanceof Error?e.message:String(e));}
      }else toast.error(e instanceof Error?e.message:String(e));
    }
    finally{actionLock.current=false;setActing(null);}
  };
  const status=(value:string)=>({undone:zh?"已撤销":"Undone",completed:zh?"成功":"Saved",failed:zh?"失败":"Failed",filtered:zh?"已过滤":"Filtered",queued:zh?"排队中":"Queued",processing:zh?"处理中":"Processing"})[value]||value;
  const reason=(code:string|null)=>/^CAPTURE_IMAGE_HTTP_\d{3}$/.test(code||"")
    ? (zh?`图片模型接口返回 HTTP ${code!.slice(-3)}`:`Image model returned HTTP ${code!.slice(-3)}`)
    : ({
    CAPTURE_INVALID_PLAN:zh?"AI归档方案无效，原文已保留":"Invalid filing plan; original retained",
    CAPTURE_TARGET_FORBIDDEN:zh?"目标已删除、加密或不在授权范围内":"Target deleted, protected or outside permission",
    CAPTURE_AI_TIMEOUT:zh?"AI处理超时，可重试":"AI timed out; retry available",
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
  return <section aria-label={zh?"收集记录":"Collection records"} className="space-y-3">
    <div className="flex items-center justify-between gap-3 text-sm">
      <div role="group" aria-label={zh?"记录状态":"Record status"} className="flex gap-1 rounded-lg bg-app-hover p-1">
        {(["all","completed","filtered"] as const).map(value=><button key={value} type="button" aria-pressed={filter===value} disabled={busy||!!acting||!!editing} onClick={()=>{setFilter(value);setOffset(0);}} className={`rounded-md px-3 py-1.5 text-xs ${filter===value?"bg-app-surface text-accent-primary shadow-sm":"text-tx-secondary"}`}>{value==="all"?(zh?"全部":"All"):value==="completed"?(zh?"成功":"Saved"):(zh?"已过滤":"Filtered")}</button>)}
      </div>
      <button type="button" disabled={busy||!!acting} onClick={()=>setRevision(x=>x+1)} className="text-accent-primary">{zh?"刷新":"Refresh"}</button>
    </div>
    {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
    {busy&&<p role="status" className="text-sm text-tx-secondary">{zh?"加载中…":"Loading…"}</p>}
    {!busy&&!error&&!rows.length&&<p className="py-8 text-center text-sm text-tx-secondary">{zh?"暂无收集记录":"No collection records"}</p>}
    {rows.map(row=><article key={row.requestId} className="relative space-y-1 rounded-lg border border-app-border p-3 text-sm">
      <div className="flex justify-between gap-3"><span className={row.status==="failed"?"text-red-500":row.status==="completed"?"text-emerald-600":"text-tx-secondary"}>{status(row.status)}</span><time className="text-xs text-tx-tertiary">{row.createdAt?new Date(row.createdAt.replace(" ","T")+(row.createdAt.includes("Z")?"":"Z")).toLocaleString():"—"}</time></div>
      {row.preview&&(row.status!=="filtered"||row.canForce)&&<p className="line-clamp-2 break-words text-tx-primary">{row.preview}</p>}
      {editing?.id===row.requestId&&<div className="space-y-2 py-2">
        <textarea aria-label={zh?"编辑原文":"Edit original text"} placeholder={editing.filtered?(zh?"粘贴或输入要收集的内容":"Paste or enter content to collect"):undefined} value={editing.content} maxLength={32000} rows={7} disabled={!!acting} onChange={e=>setEditing({...editing,content:e.target.value})} className="w-full rounded-md border border-app-border bg-app-surface p-2 text-sm"/>
        <div className="flex gap-2"><button type="button" disabled={!!acting||!editing.content.trim()} onClick={()=>void saveEdited()} className="rounded-md bg-accent-primary px-3 py-1.5 text-xs text-white disabled:opacity-50">{editing.filtered?(zh?"强制收集":"Force collect"):(zh?"重新整理":"Reorganize")}</button><button type="button" disabled={!!acting} onClick={()=>setEditing(null)} className="rounded-md border border-app-border px-3 py-1.5 text-xs">{zh?"取消":"Cancel"}</button></div>
      </div>}
      {row.path&&<p className="break-words text-xs text-tx-secondary">{row.action==="append"?(zh?"追加至：":"Appended to: "):(zh?"新建于：":"Created in: ")}{row.path}</p>}
      {row.status!=="filtered"&&row.code&&<p className="text-xs text-tx-secondary" title={row.code}>{row.errorMessage||reason(row.code)}</p>}
      {!!row.imageCount&&<p className="text-xs text-tx-secondary">{zh?`已保存 ${row.imageCount} 张图片`:`${row.imageCount} image(s) saved`}</p>}
      {row.status!=="filtered"&&row.warnings?.map(warning=><p key={warning} className="text-xs text-amber-600">{reason(warning)}</p>)}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-xs text-tx-tertiary">{row.sourceApp}</span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1" role="group" aria-label={zh?"记录操作":"Record actions"}>
          {row.status==="completed"&&row.noteId&&<button type="button" aria-label={zh?"打开笔记":"Open note"} title={zh?"打开笔记":"Open note"} disabled={!!acting||busy||!!editing} onClick={()=>void openNote(row)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-tx-secondary hover:bg-app-hover"><FileText size={14}/></button>}
          {row.status==="completed"&&row.canEdit&&<button type="button" aria-label={zh?"编辑":"Edit"} title={zh?"编辑原文":"Edit original text"} disabled={!!acting||busy||!!editing} onClick={()=>void edit(row)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-tx-secondary hover:bg-app-hover"><Pencil size={14}/></button>}
          {row.status==="filtered"&&row.canEdit&&<button type="button" aria-label={zh?"编辑后收集":"Edit and collect"} disabled={!!acting||busy||!!editing} onClick={()=>void edit(row)} className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs text-accent-primary hover:bg-app-hover disabled:opacity-50"><Pencil size={14}/>{zh?"编辑后收集":"Edit and collect"}</button>}
          {([{kind:"delete",Icon:Trash2,label:zh?"删除":"Delete",enabled:true,tip:zh?"删除此记录，不删除笔记":"Delete this record only"},
            {kind:"force",Icon:Download,label:zh?"强制收集":"Force collect",enabled:row.canForce,tip:row.status==="filtered"?(row.canForce?(zh?"直接收集":"Collect directly"):(zh?"请先编辑内容":"Edit the content first")):row.canForce?(zh?"重新整理归档":"File again"):undefined},
            {kind:"undo",Icon:Undo2,label:zh?"撤销":"Undo",enabled:row.canUndo,tip:zh?"撤回本次新建或追加；后续修改会受保护":"Undo this creation or append; protect later edits"}] as const).map(({kind,Icon,label,enabled,tip})=>{
              const showLabel=kind==="force"&&row.status==="filtered";
              return <span key={kind} title={tip}><button type="button" aria-label={label} disabled={!!acting||busy||!!editing||!enabled} onClick={()=>void action(row,kind)} className={`inline-flex h-7 items-center justify-center rounded-md transition-colors hover:bg-app-hover disabled:cursor-not-allowed disabled:opacity-30 ${showLabel?"gap-1 px-2 text-xs":"w-7"} ${kind==="delete"?"text-tx-tertiary hover:text-red-500":"text-tx-secondary hover:text-accent-primary"}`}>
                {acting===`${row.requestId}:${kind}`?<Loader2 size={14} className="animate-spin"/>:<Icon size={14}/>}{showLabel&&label}</button></span>;
            })}
        </div>
      </div>
    </article>)}
    <div className="flex justify-between text-sm"><button type="button" disabled={busy||!!acting||!offset} onClick={()=>setOffset(x=>Math.max(0,x-30))}>{zh?"上一页":"Previous"}</button><button type="button" disabled={busy||!!acting||!more} onClick={()=>setOffset(x=>x+30)}>{zh?"下一页":"Next"}</button></div>
  </section>;
}
