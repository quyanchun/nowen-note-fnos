/**
 * Phase 2: 笔记级实时协作 Hook
 *
 * 职责：
 *   1. 订阅当前 noteId 对应的 WebSocket 房间
 *   2. 汇总 Presence（别人在看/编辑）
 *   3. 暴露"远程更新"事件，让 EditorPane 决定是静默拉取还是提示用户
 *   4. 提供 setEditing() 给编辑器：进入/退出编辑态时软锁广播
 *
 * 消费约定：
 *   - presenceUsers：不包含自己；按 editing > 在看 > userId 排序
 *   - isSomeoneEditing：除自己外是否有人正在编辑（软锁提示）
 *   - onRemoteUpdate：注册一个回调，当房间内有 note:updated 且不是自己触发时触发
 *   - onRemoteDelete：同上，当笔记被删除时触发
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { realtime } from "@/lib/realtime";
import { api } from "@/lib/api";

const SELF_USERID_CACHE_KEY = "nowen-self-userid";

/**
 * 取当前登录用户 id（带缓存），用于从 presence 中过滤自己。
 *
 * 三级兜底（从快到慢）：
 *   1. realtime.getSelfUserId()：WS "connected" 帧携带的 userId，连上即知，零延迟
 *   2. localStorage[SELF_USERID_CACHE_KEY]：上一次登录缓存
 *   3. /api/me：纯 HTTP 兜底（通常不会走到，因为 1 / 2 已经覆盖）
 *
 * 为什么不直接 /api/me：
 *   早期只走 /api/me，首次登录或清缓存后会有"selfUserId=null"的窗口期；
 *   这段窗口内收到自己触发的 presence / note:updated 会被当成别人处理，
 *   误弹 "XX 正在编辑 / XX 更新了笔记"横幅。
 */
function useSelfUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(() => {
    const fromWs = realtime.getSelfUserId();
    if (fromWs) return fromWs;
    try {
      return localStorage.getItem(SELF_USERID_CACHE_KEY);
    } catch {
      return null;
    }
  });

  // 订阅 realtime 的 "open"：WS 刚连上就会收到 connected 帧把 selfUserId 填好，
  // 这里 open 事件触发时去同步一次，免得用户提前渲染、后才连上 WS 拿到 userId。
  useEffect(() => {
    const sync = () => {
      const id = realtime.getSelfUserId();
      if (id) setUserId((prev) => prev ?? id);
    };
    sync();
    const off = realtime.on("open", sync);
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    if (userId) return;
    let cancelled = false;
    api
      .getMe()
      .then((me: any) => {
        if (cancelled) return;
        if (me?.id) {
          try { localStorage.setItem(SELF_USERID_CACHE_KEY, me.id); } catch {}
          setUserId(me.id);
        }
      })
      .catch(() => {
        /* 静默失败，offline/未登录场景 */
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return userId;
}

export interface PresenceUser {
  userId: string;
  username: string;
  connectionId: string;
  editing: boolean;
}

export interface UseRealtimeNoteOptions {
  /** 笔记 ID，null 表示未聚焦（会解除订阅） */
  noteId: string | null;
  /**
   * 当前登录用户的 userId，用于从 presence 中过滤自己。
   * 若不传则 hook 会自动通过 /api/me 拉取（有 localStorage 缓存）
   */
  selfUserId?: string | null;
  /** 收到远程更新事件（仅别人触发）—— 返回闭包捕获 actorUserId/version */
  onRemoteUpdate?: (payload: {
    noteId: string;
    version: number;
    updatedAt: string;
    title?: string;
    contentText?: string;
    actorUserId?: string;
  }) => void;
  /** 收到远程删除（放入回收站或永久删除） */
  onRemoteDelete?: (payload: {
    noteId: string;
    actorUserId?: string;
    actorConnectionId?: string | null;
    trashed?: boolean;
  }) => void;
}

export function useRealtimeNote({
  noteId,
  selfUserId: externalSelfUserId,
  onRemoteUpdate,
  onRemoteDelete,
}: UseRealtimeNoteOptions) {
  const fallbackSelf = useSelfUserId();
  const selfUserId = externalSelfUserId ?? fallbackSelf;

  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(realtime.isOpen());

  // 用 ref 维持最新回调引用，避免 useEffect 因回调变化而反复订阅
  const onRemoteUpdateRef = useRef(onRemoteUpdate);
  const onRemoteDeleteRef = useRef(onRemoteDelete);
  onRemoteUpdateRef.current = onRemoteUpdate;
  onRemoteDeleteRef.current = onRemoteDelete;

  // 连接管理
  useEffect(() => {
    realtime.connect();
    const offOpen = realtime.on("open", () => setIsConnected(true));
    const offClose = realtime.on("close", () => setIsConnected(false));
    return () => {
      offOpen();
      offClose();
    };
  }, []);

  // 房间订阅 + Presence + 消息分发
  useEffect(() => {
    if (!noteId) {
      // 离开房间
      realtime.setPresence(null, false);
      setPresenceUsers([]);
      return;
    }

    const room = `note:${noteId}`;
    realtime.subscribe(room);
    // 进入房间：先声明"在看但未编辑"，编辑器真正 focus 时再 setEditing(true)
    realtime.setPresence(noteId, false);

    const offPresence = realtime.on("presence", (msg: any) => {
      if (msg.noteId !== noteId) return;
      // cursorUpdate 是轻量事件，不重写 users 列表（Phase 2 先忽略 cursor UI）
      if (msg.cursorUpdate) return;
      const users: PresenceUser[] = Array.isArray(msg.users) ? msg.users : [];
      // 过滤掉自己：
      //   1) userId 匹配（同一用户所有标签页都算自己，UI 里不出现"你自己"）
      //   2) connectionId 匹配（selfUserId 还未就绪时兜底，至少排除本连接）
      // 两路并集，确保不会漏。
      const myConnectionId = realtime.getConnectionId();
      const filtered = users.filter((u) => {
        if (selfUserId && u.userId === selfUserId) return false;
        if (myConnectionId && u.connectionId === myConnectionId) return false;
        return true;
      });
      // 排序：editing 优先
      filtered.sort((a, b) => {
        if (a.editing !== b.editing) return a.editing ? -1 : 1;
        return a.username.localeCompare(b.username);
      });
      setPresenceUsers(filtered);
    });

    const offUpdate = realtime.on("note:updated", (msg: any) => {
      if (msg.noteId !== noteId) return;
      // 只排除“同一个 WebSocket 连接”的回声；不能按 userId 过滤，否则同一账号
      // 的 PC/手机互相看不到更新。服务端正常会按 X-Connection-Id 排除发起连接，
      // 这里再做一层兜底。
      const myConnectionId = realtime.getConnectionId();
      if (myConnectionId && msg.actorConnectionId === myConnectionId) return;
      onRemoteUpdateRef.current?.(msg);
    });

    const offDelete = realtime.on("note:deleted", (msg: any) => {
      if (msg.noteId !== noteId) return;
      const myConnectionId = realtime.getConnectionId();
      if (myConnectionId && msg.actorConnectionId === myConnectionId) return;
      onRemoteDeleteRef.current?.(msg);
    });

    return () => {
      offPresence();
      offUpdate();
      offDelete();
      realtime.unsubscribe(room);
      // Presence：若仍停留在其他笔记上，后续 effect 会重新设置；
      // 切到空时显式清掉
      realtime.setPresence(null, false);
      setPresenceUsers([]);
    };
  }, [noteId, selfUserId]);

  /** 编辑器 focus/blur 时调用，广播软锁 */
  const setEditing = useCallback(
    (editing: boolean) => {
      if (!noteId) return;
      realtime.setEditing(noteId, editing);
    },
    [noteId],
  );

  const isSomeoneEditing = presenceUsers.some((u) => u.editing);

  return {
    presenceUsers,
    isConnected,
    isSomeoneEditing,
    setEditing,
  };
}
