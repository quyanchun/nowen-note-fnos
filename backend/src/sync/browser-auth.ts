import { createHash, randomBytes } from "node:crypto";
import { fetchFnosSession } from "./fnos-session";
import { fetchSyncRemote } from "./certificate-trust";

const PREFIX = "/app/nowen-note-private";
const DEVICE_PREFIX = "/nowen-note-device";
const random = () => randomBytes(32).toString("base64url");
interface Pending {
  owner: string; id: string; state: string; verifier: string; serverUrl: string; expiresAt: number;
  status: "waiting" | "exchanging" | "connected" | "failed";
  desktopLogin?: boolean; error?: string; result?: unknown; transport?: "fnos-session";
}
const pending = new Map<string, Pending>();

export function normalizeFnosServer(input: string): URL {
  const url = new URL(input.trim());
  const privateHttp = url.protocol === "http:" && /^(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(url.hostname);
  if ((url.protocol !== "https:" && !privateHttp) || url.username || url.password || url.search || url.hash
    || !["/", PREFIX, PREFIX + "/", DEVICE_PREFIX, DEVICE_PREFIX + "/"].includes(url.pathname)) {
    throw new Error("请输入 NAS 的 HTTPS 地址，或局域网 HTTP 地址；支持 /app/nowen-note-private/ 前缀");
  }
  return url;
}

export async function beginBrowserAuthorization(owner: string, input: string, deviceName: string, desktopLogin = false) {
  const server = normalizeFnosServer(input);
  let serverUrl = server.origin + DEVICE_PREFIX;
  const probe = await fetchSyncRemote(`${serverUrl}/health`, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  const metadata = await probe.json().catch(() => null) as any;
  const nativeSession = !probe.ok || metadata?.service !== "nowen-note-device" || metadata?.protocol !== 1;
  if (nativeSession && !process.env.NOWEN_FNOS_BRIDGE_TOKEN) throw new Error("请更新桌面客户端以使用 NAS 应用网关");
  if (nativeSession) serverUrl = server.origin + PREFIX;
  for (const [key, value] of pending) if (value.expiresAt <= Date.now() || value.owner === owner) pending.delete(key);
  if (pending.size >= 20) throw new Error("等待授权的设备过多，请稍后重试");
  const item: Pending = { owner, id: random(), state: random(), verifier: random(), serverUrl, expiresAt: Date.now() + 5 * 60_000, status: "waiting", desktopLogin };
  const target = new URL(PREFIX + "/client-authorize", server.origin);
  target.search = new URLSearchParams({
    challenge: createHash("sha256").update(item.verifier).digest("base64url"), state: item.state,
    device: deviceName.replace(/[\x00-\x1f]/g, "").slice(0, 80) || "Nowen Note 客户端",
  }).toString();
  if (nativeSession) item.transport = "fnos-session";
  pending.set(item.id, item);
  if (nativeSession) return { requestId: item.id, state: item.state, expiresAt: item.expiresAt, transport: item.transport };
  return { requestId: item.id, expiresAt: item.expiresAt, authorizationUrl: target.toString() };
}

export function browserAuthorizationStatus(owner: string, requestId: string) {
  const item = pending.get(requestId);
  if (!item || item.owner !== owner || item.expiresAt <= Date.now()) throw new Error("授权请求已失效，请重新发起");
  return { status: item.status, error: item.error, result: item.result };
}
export function cancelBrowserAuthorization(owner: string, requestId: string) {
  const item = pending.get(requestId);
  if (item?.owner === owner) pending.delete(requestId);
}

export async function finishBrowserAuthorization<T>(owner: string, input: { code?: unknown; state?: unknown }, activate: (serverUrl: string, token: string, remoteUserId: string, options?: { desktopLogin?: boolean; remoteUser?: any; isCancelled?: () => boolean }) => T) {
  if (typeof input.state !== "string" || typeof input.code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.code)) throw new Error("授权回调无效");
  const item = [...pending.values()].find(value => value.owner === owner && value.state === input.state);
  if (!item || item.status !== "waiting" || item.expiresAt <= Date.now()) throw new Error("授权请求不存在或已处理，请重新发起");
  item.status = "exchanging";
  try {
    const response = await fetchSyncRemote(`${item.serverUrl}/token`, {
      method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ code: input.code, verifier: item.verifier }),
    });
    const result = await response.json().catch(() => null) as any;
    if (!response.ok || !/^nnd_[A-Za-z0-9_-]{43}$/.test(result?.token || "") || typeof result?.user?.id !== "string" || !result.user.id) throw new Error("NAS 拒绝了此次授权，请重新发起");
    if (pending.get(item.id) !== item || item.expiresAt <= Date.now()) throw new Error("授权已取消或过期");
    item.result = await activate(item.serverUrl, result.token, result.user.id, { desktopLogin: item.desktopLogin, remoteUser: result.user, isCancelled: () => pending.get(item.id) !== item });
    item.status = "connected";
    item.verifier = "";
    return item.result;
  } catch {
    item.verifier = "";
    item.status = "failed";
    item.error = "客户端连接未完成，请检查 NAS 地址、证书和授权状态后重新授权";
    throw new Error(item.error);
  }
}

export async function finishNativeAuthorization<T>(owner: string, input: { requestId?: unknown; state?: unknown }, deviceId: string,
  activate: (serverUrl: string, token: string, remoteUserId: string, options?: { refreshToken: string; transport: "fnos-session"; desktopLogin?: boolean; remoteUser?: any; isCancelled?: () => boolean }) => T) {
  const item = typeof input.requestId === "string" ? pending.get(input.requestId) : null;
  if (!item || item.owner !== owner || item.state !== input.state || item.transport !== "fnos-session" || item.status !== "waiting" || item.expiresAt <= Date.now()) throw new Error("授权请求已失效");
  item.status = "exchanging";
  try {
    const response = await fetchFnosSession(`${item.serverUrl}/api/auth/fnos`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId }), signal: AbortSignal.timeout(10_000),
    });
    const login = await response.json() as any;
    if (!response.ok || typeof login.token !== "string" || !login.token || typeof login.refreshToken !== "string" || !login.refreshToken || typeof login.user?.id !== "string" || !login.user.id) throw new Error("NAS 登录尚未完成");
    if (pending.get(item.id) !== item || item.expiresAt <= Date.now()) throw new Error("授权已取消或过期");
    item.result = await activate(item.serverUrl, login.token, login.user.id, { refreshToken: login.refreshToken, transport: "fnos-session", desktopLogin: item.desktopLogin, remoteUser: login.user, isCancelled: () => pending.get(item.id) !== item });
    item.status = "connected";
    return item.result;
  } catch {
    item.status = "failed"; item.error = "NAS 授权未完成，请重新登录";
    throw new Error(item.error);
  }
}
