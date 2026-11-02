import { getDb } from "../db/schema";

const KEY = "fnos_web_login_entries";
export interface FnosWebEntry { name: string; webOrigin: string; portalOrigin: string }
function origin(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) throw new Error("请填写完整的 HTTP 或 HTTPS 根地址");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("请填写有效的完整 HTTP 或 HTTPS 地址"); }
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("地址只能包含协议、主机和端口，不能包含路径、凭据或参数");
  return url.origin;
}
export function normalizeFnosWebEntries(value: unknown): FnosWebEntry[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("最多配置 8 个登录入口");
  const seen = new Set<string>();
  return value.map(row => {
    if (!row || typeof row !== "object" || typeof row.name !== "string" || !row.name.trim() || row.name.trim().length > 40) throw new Error("入口名称须为 1 到 40 个字符");
    const webOrigin = origin(row.webOrigin), portalOrigin = origin(row.portalOrigin);
    if (webOrigin === portalOrigin || seen.has(webOrigin)) throw new Error("笔记地址不能重复，也不能与 NAS 授权地址相同");
    if (webOrigin.startsWith("https:") && !portalOrigin.startsWith("https:")) throw new Error("HTTPS 笔记入口须配置 HTTPS NAS 授权地址");
    seen.add(webOrigin);
    return { name: row.name.trim(), webOrigin, portalOrigin };
  });
}
export function readFnosWebEntries(): FnosWebEntry[] {
  const stored = getDb().prepare("SELECT value FROM system_settings WHERE key=?").get(KEY) as {value:string}|undefined;
  if (stored) { try { return normalizeFnosWebEntries(JSON.parse(stored.value)); } catch { return []; } }
  let entries: FnosWebEntry[] = [];
  try { entries = normalizeFnosWebEntries(JSON.parse(process.env.NOWEN_WEB_LOGIN_ENTRIES || "[]")); } catch { /* Invalid environment entries stay disabled. */ }
  try {
    const legacy = normalizeFnosWebEntries([{name:"局域网",webOrigin:process.env.NOWEN_WEB_PUBLIC_URL,portalOrigin:process.env.NOWEN_FNOS_PORTAL_URL}])[0];
    // Preserve the legacy same-host behavior, including old clients' fixed-origin check.
    if (new URL(legacy.webOrigin).hostname === new URL(legacy.portalOrigin).hostname && new URL(legacy.webOrigin).protocol === new URL(legacy.portalOrigin).protocol && !entries.some(row=>row.webOrigin===legacy.webOrigin)) entries.unshift(legacy);
  } catch { /* Ordinary deployments have no NAS entry. */ }
  return entries;
}
export function writeFnosWebEntries(value: unknown): FnosWebEntry[] {
  const entries = normalizeFnosWebEntries(value);
  getDb().prepare("INSERT INTO system_settings(key,value,updatedAt) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt").run(KEY,JSON.stringify(entries));
  return entries;
}
