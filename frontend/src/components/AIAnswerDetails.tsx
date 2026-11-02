import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, FileText } from "lucide-react";
import type { ReliableDiagnostics, ReliableReference } from "@/lib/aiReliable";

export default function AIAnswerDetails({diagnostics,references,onReference,onClose}: {
 diagnostics?:ReliableDiagnostics;references?:ReliableReference[];onReference:(reference:ReliableReference)=>void;onClose:()=>void;
}) {
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const node=dialog.current;node?.showModal?.();return()=>{node?.close?.();previous?.focus();};},[]);
 return createPortal(<dialog ref={dialog} aria-labelledby="answer-details-title" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}} className="fixed left-1/2 top-1/2 m-0 w-[calc(100vw_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-app-border bg-app-surface p-0 text-tx-primary shadow-xl backdrop:bg-black/40">
  <div className="flex items-center justify-between border-b border-app-border p-4"><h2 id="answer-details-title" className="font-semibold">回答详情</h2><button type="button" aria-label="关闭回答详情" onClick={onClose} className="rounded p-1 hover:bg-app-hover"><X size={18}/></button></div>
  <div className="max-h-[75dvh] space-y-5 overflow-y-auto p-5 text-sm">
   {diagnostics ? <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 break-words text-xs"><dt className="text-tx-tertiary">对话模型</dt><dd>{diagnostics.provider} / {diagnostics.model}</dd><dt className="text-tx-tertiary">本次范围</dt><dd>{diagnostics.mode==="knowledge"?"知识库检索":diagnostics.mode==="current-note"?"当前整篇笔记":"选中文本"}{diagnostics.scope.notebookId ? " · 指定目录" : ""}</dd><dt className="text-tx-tertiary">时间</dt><dd>{new Date(diagnostics.generatedAt).toLocaleString()}</dd></dl> : <p className="text-xs text-tx-tertiary">该回答未记录检索详情，可查看已保存的参考来源。</p>}
   <section><h3 className="mb-2 text-sm font-medium">参考来源</h3>{references?.length ? <ul className="space-y-1">{references.map((reference,index)=><li key={`${reference.id}-${index}`}><button type="button" onClick={()=>onReference(reference)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-app-hover"><FileText size={13}/><span className="min-w-0 break-words">{reference.title}</span></button></li>)}</ul>:<p className="text-xs text-tx-tertiary">此回答没有引用来源。</p>}</section>
   {diagnostics && <details className="border-t border-app-border pt-3"><summary className="cursor-pointer text-xs text-tx-secondary">检索与索引详情</summary><div className="mt-3 space-y-2 text-xs text-tx-tertiary"><p>Embedding：{diagnostics.embeddingModel || "未配置"}</p><p>召回路径：{diagnostics.retrieval.join(" + ") || "无命中"}</p><p>上下文：{diagnostics.context.includedChars} / {diagnostics.context.originalChars} 字{diagnostics.context.truncated ? "（已截取）" : ""}</p><p>索引更新时间：{diagnostics.index.lastIndexedAt || "尚未建立"}</p>{diagnostics.hits.map((hit,index)=><div className="rounded-lg bg-app-hover p-2" key={`${hit.id}-${index}`}><p className="font-medium text-tx-primary">{hit.title}</p><p className="mt-1 whitespace-pre-wrap break-words">{hit.preview}</p></div>)}</div></details>}
  </div>
 </dialog>,document.body);
}
