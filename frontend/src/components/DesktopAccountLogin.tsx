import { useEffect, useRef, useState } from "react";
import { BookOpen, Loader2, Server, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { setServerUrl } from "@/lib/api";
import { storeAuthTokens } from "@/lib/authSession";
import type { User } from "@/types";

type Login = { token: string; refreshToken?: string; user: User; serverUrl: string };
export default function DesktopAccountLogin({onLogin,onUnavailable}: {onLogin:(token:string,user:User)=>void;onUnavailable:()=>void}) {
  const {t}=useTranslation();
  const bridge=(window as any).nowenDesktop.accountLogin;
  const [method,setMethod]=useState<"nas"|"password">("nas");
  const [serverUrl,setAddress]=useState("");
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [ticket,setTicket]=useState("");
  const [code,setCode]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [requestId,setRequestId]=useState<string|null>(null);
  const epoch=useRef(0);
  const k=(key:string)=>t(`desktopAccountLogin.${key}`);
  useEffect(()=>{ let alive=true; void bridge.info().then((info:any)=>{
    if(!alive)return; if(info.available===false){onUnavailable();return;}
    if(info.serverUrl) {
      setMethod(/\/app\/nowen-note-private\/?$/.test(info.serverUrl) ? "nas" : "password");
      setAddress(info.serverUrl.replace(/\/app\/nowen-note-private\/?$/,""));
    }
  }); return()=>{alive=false;epoch.current++;}; },[]);
  const complete=(login:Login)=>{
    if(!login.token||!login.user?.id||!/^http:\/\/127\.0\.0\.1:\d+$/.test(login.serverUrl)) throw new Error(k("failed"));
    setServerUrl(login.serverUrl);
    storeAuthTokens({token:login.token,refreshToken:login.refreshToken??null});
    localStorage.removeItem("nowen-prefer-cloud");
    onLogin(login.token,login.user);
  };
  useEffect(()=>{
    if(!requestId)return;
    let stopped=false; let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{
        const result=await bridge.status(requestId); if(stopped)return;
        if(result.error||result.status==="failed")throw new Error(result.error||k("failed"));
        if(result.status==="connected"){complete(result.login);return;}
        timer=setTimeout(()=>void poll(),700);
      }catch(err){if(!stopped){setError(err instanceof Error?err.message:k("failed"));setBusy(false);setRequestId(null);}}
    };
    void poll(); return()=>{stopped=true;clearTimeout(timer);};
  },[requestId]);
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault(); if(busy)return;
    const attempt=++epoch.current;setBusy(true);setError("");
    try{
      const address=/^https?:\/\//i.test(serverUrl.trim())?serverUrl.trim():"https://"+serverUrl.trim();
      const result=await bridge.start({method,serverUrl:address,username,password,ticket,code});
      if(attempt!==epoch.current)return;
      if(result.error)throw new Error(result.error);
      if(result.requiresTwoFactor){setTicket(result.ticket);setBusy(false);return;}
      if(result.requestId){setRequestId(result.requestId);return;}
      setPassword("");complete(result);
    }catch(err){if(attempt===epoch.current){setError(err instanceof Error?err.message:k("failed"));setBusy(false);}}
  };
  const cancel=async()=>{
    epoch.current++; if(requestId)await bridge.cancel(requestId);
    setRequestId(null);setBusy(false);setError("");
  };
  const input="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-zinc-700 dark:bg-zinc-900";
  return <main className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 flex items-center justify-center p-6">
    <section className="w-full max-w-md rounded-3xl border border-zinc-200/80 bg-white p-8 shadow-xl shadow-zinc-200/40 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
      <div className="mb-7 flex items-center gap-3"><div className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950"><BookOpen size={26}/></div><div><h1 className="text-xl font-semibold">Nowen Note</h1><p className="mt-1 text-sm text-zinc-500">{k("subtitle")}</p></div></div>
      <div role="tablist" aria-label={k("methods")} className="mb-6 flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
        {(["nas","password"] as const).map(value=><button key={value} role="tab" aria-selected={method===value} disabled={busy} onClick={()=>{setMethod(value);setError("");setTicket("");}} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${method===value?"bg-white text-blue-600 shadow-sm dark:bg-zinc-700":"text-zinc-500"}`}>
          {value==="nas"?<Server size={16}/>:<UserRound size={16}/>} {k(value)}
        </button>)}
      </div>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">{k("server")}<input className={input+" mt-2"} aria-label={k("server")} autoComplete="url" placeholder="https://nas.example.com" value={serverUrl} onChange={e=>setAddress(e.target.value)} required disabled={busy||!!ticket}/></label>
        {method==="password"&&!ticket&&<><label className="block text-sm font-medium">{k("username")}<input className={input+" mt-2"} autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required disabled={busy}/></label><label className="block text-sm font-medium">{k("secret")}<input className={input+" mt-2"} type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required disabled={busy}/></label></>}
        {ticket&&<label className="block text-sm font-medium">{k("code")}<input className={input+" mt-2"} autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} required disabled={busy}/></label>}
        {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60" disabled={busy} type="submit">{busy&&<Loader2 size={17} className="animate-spin"/>}{busy?k("waiting"):k(method==="nas"?"authorize":"login")}</button>
        {requestId&&<button type="button" className="w-full text-sm text-zinc-500" onClick={()=>void cancel()}>{k("cancel")}</button>}
      </form>
      <p className="mt-6 text-xs leading-5 text-zinc-500">{k("description")}</p>
    </section>
  </main>;
}
