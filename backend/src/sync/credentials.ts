/**
 * 远端同步凭据存储。
 *
 * 为什么不放数据库：
 * - 数据库会被备份、导出、迁移到其他设备。Access Token 跟着走等于凭据泄漏；
 * - 用户换机恢复备份后，旧 token 多半已失效，反而要额外写"恢复后清 token"逻辑；
 * - 凭据是**设备本地**的运行时状态，与知识库内容不是同一生命周期。
 *
 * 因此落在数据目录下的独立文件，权限 0600，与 Desktop 本地账号密钥
 * (.local_account_secret) 的处理方式保持一致。
 *
 * 安全约束：
 * - 本模块是唯一读写 token 的地方，其他模块只能拿到构造好的 client；
 * - token 绝不进入任何日志（[sync-v2] 日志用白名单字段，天然挡住）。
 */

import fs from "node:fs";
import path from "node:path";

import { SyncError } from "./errors";
import { SyncRemoteClient } from "./remote";
import { SyncBlobClient } from "./blob";
import type { RemoteCredentials } from "./remote";
import { fetchFnosSession } from "./fnos-session";
import { fetchSyncRemote } from "./certificate-trust";

const DATA_DIR = process.env.ELECTRON_USER_DATA || path.join(process.cwd(), "data");
const CREDENTIALS_FILE = path.join(DATA_DIR, ".sync_credentials.json");

interface StoredCredential {
  profileId: string;
  serverUrl: string;
  token: string;
  /** 远端用户标识，仅用于展示与校验，不参与鉴权。 */
  remoteUserId?: string | null;
  localUserId?: string;
  updatedAt: string;
  refreshToken?: string;
  transport?: "fnos-session" | "direct";
}

type CredentialFile = Record<string, StoredCredential>;

function readFile(): CredentialFile {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CredentialFile;
    }
  } catch {
    // 文件不存在或损坏：视为"尚未授权"。
    // 这里绝不能抛错——凭据缺失只应导致同步暂停，不能让 Backend 起不来。
  }
  return {};
}

function writeFile(data: CredentialFile): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${CREDENTIALS_FILE}.tmp`;
  // 原子写：崩在中途也不会留下半截 JSON 导致下次读不出任何凭据。
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, CREDENTIALS_FILE);
  try {
    fs.chmodSync(CREDENTIALS_FILE, 0o600);
  } catch {
    // Windows 上 chmod 基本无效，忽略即可。
  }
}

/** 保存某个 Profile 的远端凭据。同一 Profile 重复保存会覆盖旧 token。 */
export function saveRemoteCredential(input: {
  profileId: string;
  serverUrl: string;
  token: string;
  remoteUserId?: string | null;
  refreshToken?: string;
  transport?: "fnos-session" | "direct";
  localUserId?: string;
}): void {
  const data = readFile();
  data[input.profileId] = {
    profileId: input.profileId,
    serverUrl: input.serverUrl.replace(/\/+$/, ""),
    token: input.token,
    localUserId: input.localUserId,
    remoteUserId: input.remoteUserId ?? null,
    ...(input.transport ? { transport: input.transport, refreshToken: input.refreshToken } : {}),
    updatedAt: new Date().toISOString(),
  };
  writeFile(data);
}

/** 读取某个 Profile 的凭据；未授权返回 null。 */
export function getRemoteCredential(profileId: string): StoredCredential | null {
  const data = readFile();
  const found = data[profileId];
  if (!found || typeof found.token !== "string" || !found.token) return null;
  return found;
}

/**
 * 删除某个 Profile 的凭据。
 *
 * 用于关闭同步与切换服务器。**只清凭据**，本地笔记、附件、
 * 未同步 Outbox、冲突记录一个字都不动（RULE 4）。
 */
export function clearRemoteCredential(profileId: string): void {
  const data = readFile();
  if (!(profileId in data)) return;
  delete data[profileId];
  writeFile(data);
}

/** 是否已为该 Profile 授权。UI 用它区分"未连接"与"令牌过期"。 */
export function hasRemoteCredential(profileId: string): boolean {
  return getRemoteCredential(profileId) !== null;
}

/**
 * 按 Profile 构造远端客户端。
 *
 * 返回 null 表示尚未授权 —— 调用方应把这理解为"同步暂停"，
 * 而不是错误：本地读写始终正常（RULE 2）。
 */
export function createRemoteClientForProfile(
  profileId: string,
  serverUrl: string,
): SyncRemoteClient | null {
  const stored = getRemoteCredential(profileId);
  if (!stored) return null;
  const credentials: RemoteCredentials = {
    // 以 Profile 表里的地址为准：用户可能改过地址而凭据文件还是旧的。
    serverUrl: serverUrl.replace(/\/+$/, ""),
    token: stored.token,
  };
  return new SyncRemoteClient(credentials, { fetchImpl: scopedFetch(profileId, serverUrl) });
}

/**
 * 构造附件二进制通道客户端。
 *
 * 与 createRemoteClientForProfile 分开而不是合成一个对象：
 * 两条通道的超时、并发、重试语义完全不同（JSON 请求秒级，附件可能要一分钟），
 * 混在一起会让其中一方被迫接受另一方的参数。
 */
export function createBlobClientForProfile(
  profileId: string,
  serverUrl: string,
): SyncBlobClient | null {
  const stored = getRemoteCredential(profileId);
  if (!stored) return null;
  return new SyncBlobClient({
    fetchImpl: scopedFetch(profileId, serverUrl),
    serverUrl: serverUrl.replace(/\/+$/, ""),
    credential: {
      serverUrl: serverUrl.replace(/\/+$/, ""),
      token: stored.token,
    },
  });
}

const refreshes = new Map<string, Promise<StoredCredential>>();
export async function freshRemoteCredential(profileId: string, serverUrl: string): Promise<StoredCredential> {
  const stored = getRemoteCredential(profileId);
  if (!stored || stored.serverUrl !== serverUrl.replace(/\/+$/, "")) throw new Error("NAS profile credential mismatch");
  if (stored.transport !== "fnos-session" && !stored.refreshToken) return stored;
  let expires = 0;
  try { expires = JSON.parse(Buffer.from(stored.token.split(".")[1], "base64url").toString()).exp * 1000; } catch {}
  if (expires > Date.now() + 60_000) return stored;
  let refreshing = refreshes.get(profileId);
  if (!refreshing) {
    refreshing = (async () => {
      const response = await (stored.transport === "fnos-session" ? fetchFnosSession : fetchSyncRemote)(`${stored.serverUrl}/api/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: stored.refreshToken }), signal: AbortSignal.timeout(10_000) });
      const value = await response.json() as any;
      let userId;
      try { userId = JSON.parse(Buffer.from(value.token.split(".")[1], "base64url").toString()).userId; } catch {}
      const current = getRemoteCredential(profileId);
      if (!response.ok || !value.token || userId !== stored.remoteUserId || current?.token !== stored.token || current?.serverUrl !== stored.serverUrl || current?.localUserId !== stored.localUserId) throw new SyncError(response.status >= 500 ? "NETWORK_UNAVAILABLE" : "AUTH_EXPIRED", "同步服务授权已失效，请重新登录");
      saveRemoteCredential({ ...stored, token: value.token, refreshToken: value.refreshToken || stored.refreshToken });
      return getRemoteCredential(profileId)!;
    })().finally(() => refreshes.delete(profileId));
    refreshes.set(profileId, refreshing);
  }
  return refreshing;
}
export function scopedFetch(profileId: string, serverUrl: string): typeof fetch {
  return async (input, init) => {
    let stored: StoredCredential;
    try { stored = await freshRemoteCredential(profileId, serverUrl); }
    catch (error) {
      if (error instanceof SyncError && error.code === "AUTH_EXPIRED") return Response.json({ code: "AUTH_EXPIRED" }, { status: 401 });
      throw error;
    }
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!target.startsWith(stored.serverUrl + "/")) throw new Error("NAS request outside profile");
    const headers = new Headers(init?.headers); headers.set("Authorization", `Bearer ${stored.token}`);
    return (stored.transport === "fnos-session" ? fetchFnosSession : fetchSyncRemote)(input, { ...init, headers });
  };
}
