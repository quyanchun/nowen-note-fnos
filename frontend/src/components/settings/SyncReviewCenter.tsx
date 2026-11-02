import {useCallback,useEffect,useRef,useState} from "react";
import {ArrowRight,Check,ChevronDown,FolderCheck,History,Loader2,RefreshCw,Sparkles,Undo2} from "lucide-react";
import {fetchSyncReview,runSmartSyncReview,applySyncReviewPlan,undoSyncReview,fetchSyncReviewVersions,recoverSyncReviewCopy,type SyncReviewResponse,type SyncReviewItem} from "@/lib/syncLocalApi";
import {ConflictCenter} from "./ConflictCenter";
import {parseServerTime} from "@/lib/dateTime";

const empty:SyncReviewResponse={items:[],consistent:0,total:0,history:[]};
const time=(value:string)=>parseServerTime(value)?.toLocaleString()||value;
function DifferenceText({text,other}:{text:string;other:string}) {
  const common=new Set(other.split("\n").map(line=>line.trim()));
  return <>{text.split("\n").map((line,index)=><span key={index}>{line.trim()&&!common.has(line.trim())?<mark className="rounded bg-amber-200/60 text-inherit dark:bg-amber-500/20">{line}</mark>:line}{"\n"}</span>)}</>;
}
export default function SyncReviewCenter({refreshKey=0,onResolved}:{refreshKey?:number;onResolved?:()=>void}) {
  const [data,setData]=useState(empty),[loading,setLoading]=useState(true),[busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[tab,setTab]=useState<"pending"|"history">("pending");
  const [expanded,setExpanded]=useState<string|null>(null),[plan,setPlan]=useState<{id:string;title:string;reason:string;content:string}|null>(null);
  const [versions,setVersions]=useState<{title:string;before:string;remote:string;after:string}|null>(null);
  const [loaded,setLoaded]=useState(false);const epoch=useRef(0),busyRef=useRef(false);
  const reload=useCallback(async()=>{
    const key=++epoch.current;
    try {const result=await fetchSyncReview();if(key===epoch.current){setData(result);setLoaded(true);setError("");}}
    catch(e){if(key===epoch.current)setError(e instanceof Error?e.message:"暂时无法读取同步状态，可重试");}
    finally {if(key===epoch.current)setLoading(false);}
  },[]);
  useEffect(()=>{void reload();return()=>{epoch.current++;};},[reload,refreshKey]);
  const act=async(key:string,fn:()=>Promise<unknown>,success:string)=>{
    if(busyRef.current)return;busyRef.current=true;setBusy(key);setError("");setNotice("");
    try {await fn();await reload();setNotice(success);onResolved?.();}
    catch(e){const message=e instanceof Error?e.message:"暂时未完成，原始版本已保留，可重试";await reload();setError(message);}
    finally {busyRef.current=false;setBusy(null);}
  };
  const smart=async(id?:string)=>act(id||"smart",async()=>{
    const result=await runSmartSyncReview(id);
    if(result.errors?.length)throw new Error(`已处理可确定的项目；${result.errors.map(e=>`${e.title}：${e.message}`).join("；")}`);
  },"智能处理已完成。需要上传的修改将继续同步；处理记录中可以查看原文并撤销内容变更。");
  const analyze=async(item:SyncReviewItem)=>{
    if(busyRef.current)return;busyRef.current=true;setBusy(item.id);setError("");
    try {const result=await runSmartSyncReview(item.id,true);if(result.plan)setPlan(result.plan);}
    catch(e){setError(e instanceof Error?e.message:"分析未完成，可重试");}
    finally {busyRef.current=false;setBusy(null);}
  };
  const button="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50";
  const pending=data.items.length;
  return <section className="space-y-4" aria-label="智能同步处理">
    <div className="flex items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 text-base font-semibold"><FolderCheck size={18} className="text-primary"/>智能同步处理</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">先自动核对，再合并两端信息。改写的笔记保留处理前版本，可撤销。</p></div><button type="button" aria-label="刷新同步处理" disabled={!!busy} onClick={()=>void reload()} className={button}><RefreshCw size={14}/></button></div>
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">{loading&&!loaded?"正在核对两端状态…":data.connected===false?"尚未连接同步服务":pending?`${pending} 项需要智能处理`:data.consistent?"当前内容已一致":"暂无需要处理的项目"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{data.connected===false?data.message||"连接上方同步服务后，这里会显示两端核对结果。":data.consistent?`${data.consistent} 条历史记录已一致，可自动归档。`:"已一致的记录会自动核对，不必逐条选择本机或云端。"}</p></div><button type="button" disabled={!!busy||!loaded||!data.total} onClick={()=>void smart()} className={button+" border-primary bg-primary text-primary-foreground hover:bg-primary/90"}>{busy==="smart"?<Loader2 size={14} className="animate-spin"/>:<Sparkles size={14}/>} {busy==="smart"?"正在智能处理…":"一键智能处理"}</button></div>
    </div>
    {error?<div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive"><p>{error}</p><button type="button" disabled={!!busy} onClick={()=>void reload()} className="mt-2 underline underline-offset-2">重新核对状态</button></div>:null}
    {notice?<p role="status" className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Check size={14} className="mt-0.5 shrink-0 text-emerald-600"/>{notice}</p>:null}
    <div role="tablist" aria-label="同步处理记录" className="flex gap-5 border-b text-sm"><button role="tab" aria-selected={tab==="pending"} onClick={()=>setTab("pending")} className={`border-b-2 pb-2 ${tab==="pending"?"border-primary font-medium text-primary":"border-transparent text-muted-foreground"}`}>待处理 {pending||""}</button><button role="tab" aria-selected={tab==="history"} onClick={()=>setTab("history")} className={`flex items-center gap-1.5 border-b-2 pb-2 ${tab==="history"?"border-primary font-medium text-primary":"border-transparent text-muted-foreground"}`}><History size={14}/>处理记录</button></div>
    {tab==="pending"?<div className="space-y-3">{data.items.map(item=><article key={item.id} className="rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.state==="trash"?"回收站目录":item.state==="waiting"?"历史记录待核对":item.state==="content"?"笔记内容差异":"所在位置不同"}</p></div><button type="button" disabled={!!busy} onClick={()=>void ((item.state==="content"||item.state==="structure")?smart(item.id):smart())} className={button}>{busy===item.id?<Loader2 size={13} className="animate-spin"/>:<Sparkles size={13}/>}智能处理</button></div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{item.reason}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs"><button type="button" onClick={()=>setExpanded(expanded===item.id?null:item.id)} className="inline-flex items-center gap-1 text-primary">{expanded===item.id?"收起差异":"查看具体差异"}<ChevronDown size={13}/></button>{item.state==="content"&&!item.protected?<button type="button" disabled={!!busy} onClick={()=>void analyze(item)} className="text-primary">先看合并建议<ArrowRight size={12} className="ml-1 inline"/></button>:null}</div>
      {expanded===item.id?<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{(["local","remote"] as const).map(side=><div key={side} className="min-w-0 rounded-lg bg-muted/40 p-3"><p className="text-xs font-medium">{side==="local"?"此设备当前版本":"服务端当前版本"}</p><p className="mt-1 break-words text-xs text-muted-foreground">{item[side].location}</p>{item[side].updatedAt?<p className="mt-1 text-[11px] text-muted-foreground">更新于 {time(item[side].updatedAt!)}</p>:null}<pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-6">{item[side].text?<DifferenceText text={item[side].text} other={item[side==="local"?"remote":"local"].text}/>:"目录内容未改动"}</pre>{!item.protected&&item[side].exists&&["note","knowledge_tree_node","attachment_organization"].includes(item.type)?<button type="button" disabled={!!busy} className={button+" mt-3"} onClick={()=>void act(item.id,()=>runSmartSyncReview(item.id,false,side),"已采用所选版本，处理前内容已留存，可在处理记录中撤销。")}>使用此{item.type==="note"?"版本":"位置"}</button>:null}</div>)}</div>:null}
    </article>)}{!pending&&loaded?<p className="py-4 text-center text-xs text-muted-foreground">{data.consistent?"没有需要你逐项判断的内容差异。点击智能处理即可核对历史记录。":"两端没有需要处理的冲突。"}</p>:null}</div>:<div className="space-y-3">{data.history.map(item=><article key={item.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.state==="undone"?"已撤销":item.kind==="ai-merge"?"AI 已合并":item.kind==="maintenance"?"状态已修复":item.kind==="placement"?"目录位置已修复":item.kind.startsWith("keep-")?"已采用选定版本":"已合并两端内容"} · {time(item.createdAt)}</p></div>{item.kind!=="maintenance"?<div className="flex gap-2"><button type="button" disabled={!!busy} className={button} onClick={()=>void act(item.id,async()=>setVersions(await fetchSyncReviewVersions(item.id)),"已打开留存版本")}>查看留存版本</button>{item.kind!=="placement"?<button type="button" disabled={!!busy} className={button} onClick={()=>void act(item.id,()=>recoverSyncReviewCopy(item.id),"已将处理前原文另存为笔记，当前内容保留。")}>取回原文副本</button>:null}{item.state==="applied"?<button type="button" disabled={!!busy} onClick={()=>void act(item.id,()=>undoSyncReview(item.id),"已恢复处理前的本机版本，并重新排队同步。后续新增编辑会受到保护。")} className={button}><Undo2 size={13}/>撤销这次处理</button>:null}</div>:null}</div><p className="mt-3 text-xs leading-5 text-muted-foreground">{item.reason}</p></article>)}{!data.history.length?<p className="py-5 text-center text-xs text-muted-foreground">智能处理后的结果和可撤销版本会显示在这里。</p>:null}</div>}
    {data.legacyCount?<details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm">其他同步记录（{data.legacyCount}）</summary><div className="mt-4"><ConflictCenter deviceId={null} refreshKey={refreshKey} onResolved={()=>{void reload();onResolved?.();}} legacyOnly/></div></details>:null}
    {plan?<div role="dialog" aria-label="合并建议" className="rounded-xl border border-primary/30 bg-muted/20 p-4"><h4 className="text-sm font-semibold">{plan.title} · 合并建议</h4><p className="mt-2 text-xs leading-5 text-muted-foreground">{plan.reason}</p><pre className="my-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 font-sans text-sm leading-6">{plan.content}</pre><div className="flex gap-2"><button disabled={!!busy} className={button+" bg-primary text-primary-foreground"} onClick={()=>void act(plan.id,async()=>{await applySyncReviewPlan(plan.id);setPlan(null);},"已按建议合并，可在处理记录中撤销。")}>按建议合并</button><button disabled={!!busy} className={button} onClick={()=>setPlan(null)}>暂不处理</button></div></div>:null}
    {versions?<div role="dialog" aria-label="留存版本" className="rounded-xl border p-4"><div className="flex justify-between gap-3"><h4 className="text-sm font-semibold">{versions.title} · 留存版本</h4><button className="text-xs text-muted-foreground" onClick={()=>setVersions(null)}>关闭</button></div>{([["处理前此设备原文",versions.before],["当时服务端原文",versions.remote],["合并后的内容",versions.after]] as const).map(([label,text])=><div key={label} className="mt-3"><p className="text-xs font-medium">{label}</p><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-sans text-xs leading-6">{text}</pre></div>)}</div>:null}
  </section>;
}
