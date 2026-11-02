import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

interface NotebookShareJoinViewProps {
  token: string;
}

type ShareInfo = Awaited<ReturnType<typeof api.getNotebookShareInfo>>;

export default function NotebookShareJoinView({ token }: NotebookShareJoinViewProps) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const hasToken = !!localStorage.getItem("nowen-token");
    if (!hasToken) {
      setNeedsLogin(true);
      setLoading(false);
      return;
    }
    api.getNotebookShareInfo(token)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch((err: any) => {
        if (cancelled) return;
        if (err?.status === 401) setNeedsLogin(true);
        else setError(err?.message || "分享链接不可用");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const join = async () => {
    setJoining(true);
    try {
      await api.joinNotebookShareLink(token);
      toast.success("已加入共享笔记本");
      window.location.assign("/");
    } catch (err: any) {
      if (err?.status === 401) {
        setNeedsLogin(true);
      } else {
        toast.error(err?.message || "加入失败");
      }
    } finally {
      setJoining(false);
    }
  };

  const loginUrl = `/login?redirect=${encodeURIComponent(`/notebook-share/${token}`)}`;

  return (
    <div className="min-h-screen bg-app-bg text-tx-primary flex items-center justify-center px-4">
      <div className="w-full max-w-sm border border-app-border bg-app-surface rounded-lg p-5 shadow-sm">
        <div className="text-sm text-tx-tertiary mb-2">共享笔记本</div>
        {loading ? (
          <div className="text-sm text-tx-secondary">正在加载...</div>
        ) : needsLogin ? (
          <>
            <h1 className="text-lg font-semibold mb-2">登录后加入共享笔记本</h1>
            <p className="text-sm text-tx-secondary mb-4">这个链接会把笔记本加入到你的账号中。</p>
            <Button className="w-full" onClick={() => window.location.assign(loginUrl)}>
              去登录
            </Button>
          </>
        ) : error ? (
          <>
            <h1 className="text-lg font-semibold mb-2">链接不可用</h1>
            <p className="text-sm text-tx-secondary">{error}</p>
          </>
        ) : info ? (
          <>
            <h1 className="text-lg font-semibold mb-1 truncate">
              {info.icon || "📒"} {info.name}
            </h1>
            <p className="text-sm text-tx-secondary mb-4">
              {info.ownerDisplayName || info.ownerUsername} 分享给你，权限为
              {info.role === "editor" ? "可编辑" : "只读"}。
            </p>
            <Button className="w-full" onClick={join} disabled={joining}>
              {joining ? "正在加入..." : "加入笔记本"}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
