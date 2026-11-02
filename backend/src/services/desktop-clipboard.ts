import { getDb } from "../db/schema";
import { getActiveProfile } from "../sync/profile";
import { getRemoteCredential, scopedFetch } from "../sync/credentials";
import { CaptureError } from "./captures";
import { type ClipboardSettings } from "./clipboard-integration";

export const isDesktopClipboard = () => !!process.env.ELECTRON_USER_DATA && !!process.env.NOWEN_FNOS_BRIDGE_TOKEN;
const required = () => new CaptureError("DESKTOP_NAS_REQUIRED", "请先在桌面客户端连接并登录笔记服务，再配置剪贴板集成", 409);

function profileFor(localUserId?: string) {
  if (!isDesktopClipboard()) throw required();
  const profile = getActiveProfile(getDb());
  const credential = profile && getRemoteCredential(profile.id);
  if (!profile || !credential || !credential.localUserId
    || !credential.remoteUserId || credential.serverUrl !== profile.serverUrl
    || credential.remoteUserId !== profile.remoteUserId || (localUserId && credential.localUserId !== localUserId)
    || !getDb().prepare("SELECT 1 FROM users WHERE id=? AND isDisabled=0").get(credential.localUserId)) throw required();
  const url = new URL(profile.serverUrl);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || credential.transport === "fnos-session" && url.pathname !== "/app/nowen-note-private") throw required();
  return { profile, credential };
}

async function management(localUserId: string, suffix = "", method = "GET", body?: unknown) {
  const { profile } = profileFor(localUserId);
  let response:Response;
  try { response = await scopedFetch(profile.id, profile.serverUrl)(`${profile.serverUrl}/api/clipboard-settings${suffix}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
  }); } catch(error) {
    const cause=error as {name?:string;message?:string;cause?:{code?:string}};
    console.warn("[desktop clipboard] management failed",{name:cause.name,code:cause.cause?.code,message:cause.message?.replace(/https?:\/\/[^\s]+/g,"[service]").slice(0,180)});
    throw new CaptureError("DESKTOP_NAS_NETWORK", "当前服务连接未完成，请重试；操作结果请刷新日志确认",502);
  }
  const data = await response.json().catch(() => null) as any;
  if (!response.ok || !data) throw new CaptureError(data?.code || "DESKTOP_NAS_UNAVAILABLE",
    response.status === 401 || response.status === 403 ? "NAS 授权已失效，请在桌面客户端重新授权"
      : response.status === 404 ? `笔记服务入口未找到（HTTP 404），${getRemoteCredential(profile.id)?.transport === "fnos-session" ? "请检查飞牛应用中心是否已启用笔记应用" : "请检查笔记服务地址和部署版本"}`
      : data?.error || (suffix.startsWith("/logs") ? "无法读取服务端收集日志" : "无法读取服务端剪贴板设置"),
    response.status === 401 || response.status === 403 ? 409 : response.status >= 500 ? 502 : 400);
  if (profileFor(localUserId).profile.id !== profile.id) throw required();
  return data;
}

export async function desktopClipboardSettings(localUserId: string) {
  const { profile } = profileFor(localUserId);
  const [state, response] = await Promise.all([
    management(localUserId),
    scopedFetch(profile.id, profile.serverUrl)(`${profile.serverUrl}/api/notebooks`, { signal: AbortSignal.timeout(15000) }),
  ]);
  const folders = await response.json().catch(() => null) as any;
  if (!response.ok || !Array.isArray(folders)) throw new CaptureError("DESKTOP_NAS_UNAVAILABLE", "无法读取 NAS 文件夹", 502);
  if (profileFor(localUserId).profile.id !== profile.id) throw required();
  return { ...state, delivery: "desktop", serverUrl: profile.serverUrl,
    serverEndpoint: state.endpoint || profile.serverUrl + "/api/clipboard/captures",
    endpoint: state.endpoint || profile.serverUrl + "/api/clipboard/captures",
    folders: folders.filter(folder => !folder.workspaceId).map(folder => ({ id: folder.id, name: folder.name })) };
}

export async function saveDesktopClipboardSettings(localUserId: string, settings: ClipboardSettings) {
  await management(localUserId, "", "PUT", settings);
  return desktopClipboardSettings(localUserId);
}

export async function copyDesktopClipboardToken(localUserId: string, rotate = false) {
  const context = profileFor(localUserId);
  const value = await management(localUserId, rotate ? "/token/rotate" : "/token", "POST", {});
  if (!/^ncc_[A-Za-z0-9_-]{43}$/.test(value.token || "")) throw new CaptureError("DESKTOP_NAS_UNAVAILABLE", "NAS 返回的专用 Token 无效", 502);
  const current = profileFor(localUserId);
  if (current.profile.id !== context.profile.id) throw required();
  return { token: value.token };
}

export async function revokeDesktopClipboardToken(localUserId: string) {
  await management(localUserId, "/token", "DELETE");
  return { success: true };
}

export const desktopClipboardLogs = (userId:string,offset:number) => management(userId,`/logs?offset=${offset}`);

export const desktopClipboardLogAction=(userId:string,requestId:string,action:"delete"|"force"|"undo")=>management(userId,`/logs/${encodeURIComponent(requestId)}${action==="delete"?"":`/${action}`}`,action==="delete"?"DELETE":"POST",action==="delete"?undefined:{});
