import { useEffect, useRef, useState } from "react";
import { Loader2, Server } from "lucide-react";
import { getServerUrl } from "@/lib/api";
import { getResolvedApiBaseUrl } from "@/lib/serverUrl";
import { storeAuthTokens } from "@/lib/authSession";

type Attempt = { id: string; proof: string; portalUrl: string; expiresIn: number; authorizeUrl?: string };

export default function FnosWebLogin({ onLogin, onAvailable, disabled = false }: { onLogin: (token: string, user: any) => void; onAvailable: (available: boolean) => void; disabled?: boolean }) {
  const [available, setAvailable] = useState(false);
  const [frameUrl, setFrameUrl] = useState("");
  const portalOrigin = useRef("");
  const lastProbe = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<Attempt | null>(null);
  const popup = useRef<Window | null>(null);
  const epoch = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onLoginRef = useRef(onLogin);
  onLoginRef.current = onLogin;
  const base = `${getResolvedApiBaseUrl(getServerUrl())}/auth/web`;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(base + path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "飞牛授权失败，请重新登录");
    return data;
  };
  useEffect(() => {
    const controller = new AbortController();
    void fetch(base + "/options?origin=" + encodeURIComponent(window.location.origin), { credentials: "same-origin", signal: controller.signal }).then(response => response.ok ? response.json() : null).then(data => {
      if (controller.signal.aborted) return;
      const enabled = !!data?.enabled && data.webOrigin === window.location.origin;
      portalOrigin.current = enabled ? data.portalOrigin : "";
      setAvailable(enabled); onAvailable(enabled);
    }).catch(() => { /* Ordinary deployments do not offer NAS authorization. */ });
    return () => {
      controller.abort(); epoch.current++; clearTimeout(timer.current);
      const pending = attempt.current; attempt.current = null;
      if (pending) void post("/cancel", pending).catch(() => {});
      popup.current?.close();
    };
  }, [base, onAvailable]);

  const cancel = () => {
    epoch.current++; clearTimeout(timer.current);
    const pending = attempt.current; attempt.current = null;
    if (pending) void post("/cancel", pending).catch(() => {});
    popup.current?.close(); setFrameUrl(""); setBusy(false);
  };
  const start = async () => {
    if (busy) return;
    const current = ++epoch.current;
    setError(""); setBusy(true);
    popup.current = window.open("about:blank", "nowen-fnos-web-login", "popup,width=1000,height=800");
    if (!popup.current) { setError("请允许弹窗后重新点击飞牛授权登录"); setBusy(false); return; }
    try {
      const pending = await post("/start", { flow: "callback" }) as Attempt;
      if (current !== epoch.current) { void post("/cancel", pending).catch(() => {}); return; }
      attempt.current = pending;
      const target = new URL(pending.portalUrl);
      if (target.origin !== portalOrigin.current || target.pathname !== "/" || target.search || target.hash || target.username || target.password) throw new Error("飞牛登录地址不匹配");
      if (pending.authorizeUrl) {
        const authorize = new URL(pending.authorizeUrl);
        if (authorize.origin !== target.origin || authorize.pathname !== "/app/nowen-note-private/api/auth/web/authorize" || authorize.searchParams.get("requestId") !== pending.id || [...authorize.searchParams.keys()].some(key => key !== "requestId") || authorize.hash || authorize.username || authorize.password) throw new Error("飞牛授权地址不匹配");
        lastProbe.current = Date.now(); setFrameUrl(authorize.href);
      }
      const deadline = Date.now() + pending.expiresIn * 1000;
      let portalOpened = false;
      const poll = async () => {
        if (current !== epoch.current) return;
        try {
          if (Date.now() >= deadline) throw new Error("飞牛授权已过期，请重新登录");
          const result = await post("/poll", pending);
          if (current !== epoch.current) return;
          if (result.status === "connected") {
            if (!result.login?.token || !result.login.user?.id) throw new Error("飞牛授权结果无效");
            attempt.current = null; popup.current?.close();
            storeAuthTokens({ token: result.login.token, refreshToken: result.login.refreshToken ?? null });
            setFrameUrl(""); setBusy(false); onLoginRef.current(result.login.token, result.login.user); return;
          }
          if (popup.current?.closed) throw new Error("已取消飞牛授权，可重新登录");
          if (!portalOpened) { portalOpened = true; popup.current?.location.replace(target.href); }
          if (pending.authorizeUrl && Date.now() - lastProbe.current >= 3000) {
            lastProbe.current = Date.now();
            setFrameUrl(pending.authorizeUrl + "&probe=" + lastProbe.current);
          }
          timer.current = setTimeout(() => void poll(), 1000);
        } catch (error) { if (current === epoch.current) { cancel(); setError(error instanceof Error ? error.message : "飞牛授权失败"); } }
      };
      void poll();
    } catch (error) { if (current === epoch.current) { cancel(); setError(error instanceof Error ? error.message : "飞牛授权失败"); } }
  };
  const continueAuthorization = () => {
    if (attempt.current?.authorizeUrl) popup.current?.location.replace(attempt.current.authorizeUrl);
  };
  if (!available) return null;
  return <div className="contents">
    {frameUrl && <iframe key={frameUrl} title="飞牛登录状态确认" src={frameUrl} referrerPolicy="no-referrer" className="hidden" aria-hidden="true" />}
    <button type="button" disabled={busy || disabled} onClick={() => void start()} className="order-2 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">{busy ? <Loader2 size={16} className="animate-spin" /> : <Server size={16} />}{busy ? "等待飞牛登录…" : "飞牛授权登录"}</button>
    {busy ? <div className="order-3 col-span-2 flex items-center justify-between gap-3 text-xs text-zinc-500"><span>请在弹窗中完成飞牛登录；若未自动返回，点击“已登录，继续授权”</span><div className="flex shrink-0 gap-3">{frameUrl && <button type="button" onClick={continueAuthorization} className="text-indigo-600">已登录，继续授权</button>}<button type="button" onClick={cancel} className="text-indigo-600">取消</button></div></div> : <p className="order-3 col-span-2 text-xs leading-5 text-zinc-500">账号密码用于笔记独立账号；飞牛账号请选择授权登录。</p>}
    {error && <p role="alert" className="order-4 col-span-2 text-sm text-red-600">{error}</p>}
  </div>;
}
