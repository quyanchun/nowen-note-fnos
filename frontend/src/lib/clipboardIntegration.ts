import { getBaseUrl } from "./api";
import { fetchWithAuthRefresh, getAccessToken } from "./authSession";
import { createHttpRequestError } from "./httpError";
export interface ClipboardIntegrationSettings {
  integrationMode?: "nas" | "standalone"; standaloneUrl?: string;
  enabled: boolean; organize: boolean; notebookId: string; instruction: string; systemPrompt: string;
  minChars: number; includeKeywords: string[]; excludeKeywords: string[]; excludeApps: string[];
  excludeExtensions: string[]; filterFiles: boolean; filterImages: boolean; aiFilterEnabled: boolean; aiFilterPrompt: string;
}
export type ClipboardDelivery = "direct" | "desktop" | "desktop-required";
export type ClipboardRecordFilter="all"|"completed"|"filtered";
export interface ClipboardIntegrationState {
  settings: ClipboardIntegrationSettings; tokenSet: boolean; tokenEnabled?:boolean;tokenExpiresAt?:string|null;endpoint?: string | null;
  delivery?: ClipboardDelivery; serverUrl?: string; serverEndpoint?: string; folders?: Array<{id:string;name:string}>;
}
export interface ClipboardLog {
  requestId:string;jobId:string|null;status:string;code:string|null;preview:string;sourceApp:string;kind:string;
  path:string|null;noteId:string|null;action:string|null;createdAt:string|null;updatedAt:string|null;
  warnings?:string[];imageCount?:number|null;
  errorMessage?:string|null;canForce?:boolean;canUndo?:boolean;canEdit?:boolean;
}
async function request<T>(path = "", method = "GET", body?: unknown): Promise<T> {
  const response = await fetchWithAuthRefresh(`${getBaseUrl()}/clipboard-settings${path}`, {
    method, cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() || ""}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, getBaseUrl());
  const data = await response.json();
  if (!response.ok) throw createHttpRequestError(response, data, `HTTP ${response.status}`);
  return data;
}
export const clipboardIntegrationApi = {
  get: () => request<ClipboardIntegrationState>(),
  save: (settings: ClipboardIntegrationSettings) => request<ClipboardIntegrationState>("", "PUT", settings),
  token: (rotate = false) => request<{token:string}>(rotate ? "/token/rotate" : "/token", "POST"),
  revoke: () => request("/token", "DELETE"),
  setTokenEnabled:(enabled:boolean)=>request<ClipboardIntegrationState>("/token/status","PUT",{enabled}),
  deleteLog:(id:string)=>request(`/logs/${encodeURIComponent(id)}`,"DELETE"),
  forceLog:(id:string)=>request(`/logs/${encodeURIComponent(id)}/force`,"POST",{}),
  undoLog:(id:string)=>request(`/logs/${encodeURIComponent(id)}/undo`,"POST",{}),
  logContent:(id:string)=>request<{jobId:string|null;content:string}>(`/logs/${encodeURIComponent(id)}`),
  editLog:(id:string,input:{jobId:string|null;requestId:string;content:string})=>request(`/logs/${encodeURIComponent(id)}/edit`,"POST",input),
  logs: (offset=0,status:ClipboardRecordFilter="all") => request<{items:ClipboardLog[];hasMore:boolean}>(`/logs?offset=${offset}${status==="all"?"":"&status="+status}`),
};
export const clipboardSubmissionUrl = () => new URL(`${getBaseUrl()}/clipboard/captures`, window.location.href).href;

/** Pure address formatting: never sends credentials or changes the NAS profile. */
export function standaloneClipboardEndpoint(address: string): string {
  const url = new URL(address.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("请填写不含凭据、查询参数或片段的 HTTP/HTTPS 服务地址");
  if (/^\/app(?:\/|$)/.test(url.pathname)) throw new Error("该地址属于 NAS 网关，请选择 NAS 网关方式");
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/api\/clipboard\/captures$/, "") + "/api/clipboard/captures";
  return url.href;
}
