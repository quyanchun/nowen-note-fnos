import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { getBaseUrl } from "@/lib/api";
import { fetchWithAuthRefresh, getAccessToken } from "@/lib/authSession";
type Entry = { name: string; webOrigin: string; portalOrigin: string };
export default function FnosWebLoginSettings() {
  const [entries,setEntries]=useState<Entry[]>([]);
  const [available,setAvailable]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const request=async(body?:unknown)=>{
    const response=await fetchWithAuthRefresh(getBaseUrl()+"/settings/fnos-web-login",{method:body===undefined?"GET":"PUT",headers:{"Content-Type":"application/json",Authorization:"Bearer "+getAccessToken()},...(body===undefined?{}:{body:JSON.stringify(body)})},getBaseUrl());
    const result=await response.json();if(!response.ok)throw new Error(result.error||"读取登录入口失败");return result;
  };
  useEffect(()=>{let cancelled=false;void request().then(data=>{if(!cancelled){setEntries(data.entries);setAvailable(data.available);}}).catch(()=>{});return()=>{cancelled=true;};},[]);
  if(!available)return null;
  const edit=(index:number,key:keyof Entry,value:string)=>{setEntries(rows=>rows.map((row,i)=>i===index?{...row,[key]:value}:row));setMessage("");setError("");};
  const save=async()=>{setBusy(true);setError("");setMessage("");try{const data=await request({entries});setEntries(data.entries);setMessage("登录入口已保存，新登录立即生效");}catch(error){setError(error instanceof Error?error.message:"保存失败");}finally{setBusy(false);}};
  return <section aria-label="飞牛网页登录" className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-700">
    <h3 className="text-base font-semibold">飞牛网页登录</h3>
    <p className="mt-1 text-xs leading-5 text-zinc-500">按访问地址自动选择 NAS 授权入口。局域网和公网可共用同一 NAS 授权地址，也可分别配置；地址包含协议及端口，不包含路径。修改仅影响新的网页登录，现有客户端同步不变。</p>
    <div className="mt-4 space-y-3">{entries.map((row,index)=><div key={index} className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
      <div className="flex items-center gap-2"><label className="flex-1 text-xs">入口名称<input disabled={busy} aria-label={`入口名称 ${index+1}`} value={row.name} onChange={event=>edit(index,"name",event.target.value)} maxLength={40} className="mt-1 w-full rounded border border-zinc-200 bg-transparent p-2 dark:border-zinc-600" /></label><button type="button" aria-label={`删除入口 ${index+1}`} disabled={busy} onClick={()=>setEntries(rows=>rows.filter((_,i)=>i!==index))} className="p-2 text-zinc-500 hover:text-red-500"><Trash2 size={16}/></button></div>
      <label className="block text-xs">笔记访问地址<input disabled={busy} aria-label={`笔记访问地址 ${index+1}`} value={row.webOrigin} onChange={event=>edit(index,"webOrigin",event.target.value)} placeholder="https://note.example.com" className="mt-1 w-full rounded border border-zinc-200 bg-transparent p-2 dark:border-zinc-600" /></label>
      <label className="block text-xs">NAS 授权地址<input disabled={busy} aria-label={`NAS 授权地址 ${index+1}`} value={row.portalOrigin} onChange={event=>edit(index,"portalOrigin",event.target.value)} placeholder="https://nas.example.com" className="mt-1 w-full rounded border border-zinc-200 bg-transparent p-2 dark:border-zinc-600" /></label>
    </div>)}</div>
    <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy||entries.length>=8} onClick={()=>setEntries(rows=>[...rows,{name:"",webOrigin:"",portalOrigin:""}])} className="flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-600"><Plus size={15}/>添加入口</button><button type="button" disabled={busy} onClick={()=>void save()} className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50"><Save size={15}/>{busy?"保存中…":"保存登录入口"}</button></div>
    {message&&<p role="status" className="mt-3 text-xs text-green-600">{message}</p>}{error&&<p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
  </section>;
}
