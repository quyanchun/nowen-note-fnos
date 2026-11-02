import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Context, Hono } from "hono";
import { getDb } from "../db/schema";
import { getFnosAccount, getFnosGatewayIdentity, getLinkedFnosUid } from "../lib/fnos-identity";
import { signLoginToken } from "../lib/auth-security";
import { userSessionsRepository } from "../repositories";

export const DEVICE_PREFIX = "/nowen-note-device";
export const DEVICE_CALLBACK = "nowen-note-private://auth/callback";
const TTL = 5 * 60_000;
const SESSION_TTL = 30 * 86400_000;
const random = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
const validProof = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
interface Approval { uid: string; challenge: string; state: string; device: string; expires: number }
interface Grant { userId: string; uid: string; version: number; challenge: string; device: string; expires: number }
const approvals = new Map<string, Approval>();
const codes = new Map<string, Grant>();
const tickets = new Map<string, { token: string; expires: number }>();
const realtimeCredentials = new WeakMap<IncomingMessage, string>();
function prune<T extends { expires: number }>(map: Map<string, T>) {
  for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key);
  while (map.size >= 1000) map.delete(map.keys().next().value!);
}
function escape(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
function fail(status = 401, code = "DEVICE_AUTH_INVALID") {
  return Response.json({ error: "设备授权无效或已过期，请重新授权", code }, { status, headers: { "Cache-Control": "no-store" } });
}
function table() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS fnos_device_tokens (
    tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sessionId TEXT NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    tokenVersion INTEGER NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

/** This page only accepts identities marked by the private Unix-socket gateway. */
export async function deviceAuthorizationPage(c: Context): Promise<Response> {
  const identity = getFnosGatewayIdentity(c);
  if (!identity || !process.env.NOWEN_FNOS_SOCKET) return fail();
  const nonce = random();
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
  const render = (body: string) => c.html(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权 Nowen Note 客户端</title><style>body{font:16px system-ui;background:#f6f7fa;color:#202735;margin:0;padding:10vh 24px}main{max-width:460px;margin:auto;background:white;padding:32px;border-radius:16px}h1{font-size:24px}p{line-height:1.7}button,a{display:inline-block;background:#1677ff;color:white;padding:12px 20px;border:0;border-radius:8px;text-decoration:none;font:inherit}small{color:#667085}</style><main>${body}</main></html>`);
  if (c.req.method === "GET") {
    const { challenge, state, device } = c.req.query();
    if (!validProof(challenge) || !validProof(state) || !device?.trim() || device.length > 80 || /[\x00-\x1f]/.test(device)) return fail(400);
    prune(approvals);
    approvals.set(nonce, { uid: identity.uid, challenge, state, device, expires: Date.now() + TTL });
    return render(`<h1>授权这台电脑同步笔记</h1><p>飞牛用户：<strong>${escape(identity.username)}</strong><br>设备：<strong>${escape(device)}</strong></p><p>允许该设备同步此账号可访问的笔记和附件。无需向客户端提供飞牛密码。</p><form method="post"><input type="hidden" name="nonce" value="${nonce}"><button type="submit">授权并打开客户端</button></form><p><small>可在笔记的“账号安全”中撤销设备会话。不想授权可直接关闭此页。</small></p>`);
  }
  if (c.req.method !== "POST") return fail(405);
  const origin = c.req.header("origin");
  if (!origin || new URL(origin).host !== new URL(c.req.url).host || c.req.header("sec-fetch-site") === "cross-site") return fail(403);
  const form = await c.req.parseBody();
  const approval = typeof form.nonce === "string" ? approvals.get(form.nonce) : null;
  if (!approval || approval.expires <= Date.now() || approval.uid !== identity.uid) return fail(403);
  approvals.delete(form.nonce as string);
  const user = getFnosAccount(identity);
  const code = random();
  prune(codes);
  codes.set(hash(code), { ...approval, userId: user.id, version: user.tokenVersion ?? 0 });
  const callback = `${DEVICE_CALLBACK}?${new URLSearchParams({ code, state: approval.state })}`;
  return render(`<h1>授权已确认</h1><p>请在浏览器提示中打开 Nowen Note。若没有自动弹出，点击下面的按钮。</p><a href="${escape(callback)}">打开 Nowen Note</a><p><small>完成连接后即可关闭此页。</small></p><script nonce="${nonce}">location.href=${JSON.stringify(callback).replaceAll("<", "\\u003c")}</script>`);
}

/** Opaque device credentials are valid only on this narrow sync transport. */
export function resolveDeviceCredential(token: string) {
  if (!/^nnd_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  table();
  const db = getDb();
  const row = db.prepare(`SELECT d.userId, d.sessionId, d.tokenVersion, u.username, u.isDisabled,
    u.tokenVersion AS currentVersion, s.revokedAt, s.expiresAt
    FROM fnos_device_tokens d JOIN users u ON u.id = d.userId
    JOIN user_sessions s ON s.id = d.sessionId AND s.userId = d.userId WHERE d.tokenHash = ?`).get(hash(token)) as any;
  if (!row || row.isDisabled || row.revokedAt || row.tokenVersion !== (row.currentVersion ?? 0)
    || !row.expiresAt || Date.parse(row.expiresAt) <= Date.now() || getLinkedFnosUid(row.userId) === null) return null;
  // Active devices renew their own session; revocation and password changes still win.
  if (Date.parse(row.expiresAt) < Date.now() + SESSION_TTL - 3600_000) {
    userSessionsRepository.updateLastSeen(row.sessionId, "", new Date(Date.now() + SESSION_TTL).toISOString());
  }
  return row as { userId: string; username: string; currentVersion: number; sessionId: string };
}
function internalToken(user: NonNullable<ReturnType<typeof resolveDeviceCredential>>) {
  return signLoginToken({ userId: user.userId, username: user.username, tokenVersion: user.currentVersion ?? 0, jti: user.sessionId });
}

export async function dispatchDeviceGateway(request: Request, app: Hono): Promise<Response> {
  if (!process.env.NOWEN_FNOS_SOCKET) return fail(404);
  const url = new URL(request.url);
  if (!url.pathname.startsWith(DEVICE_PREFIX + "/")) return fail(404);
  const route = url.pathname.slice(DEVICE_PREFIX.length);
  if (route === "/health" && request.method === "GET") return Response.json({ service: "nowen-note-device", protocol: 1 });
  if (route === "/token" && request.method === "POST") {
    const body = await request.json().catch(() => null) as any;
    if (!validProof(body?.code) || !validProof(body?.verifier)) return fail();
    const grant = codes.get(hash(body.code));
    if (!grant || grant.expires <= Date.now() || hash(body.verifier) !== grant.challenge) return fail();
    codes.delete(hash(body.code));
    table();
    const db = getDb();
    const user = db.prepare("SELECT id, username, displayName, tokenVersion, isDisabled FROM users WHERE id = ?").get(grant.userId) as any;
    if (!user || user.isDisabled || (user.tokenVersion ?? 0) !== grant.version || getLinkedFnosUid(user.id) !== grant.uid) return fail();
    const token = `nnd_${random()}`, sessionId = randomUUID();
    db.transaction(() => {
      userSessionsRepository.create({ id: sessionId, userId: user.id, ip: "", userAgent: `Nowen Note · ${grant.device}`, deviceLabel: grant.device, expiresAt: new Date(Date.now() + SESSION_TTL).toISOString() });
      db.prepare("INSERT INTO fnos_device_tokens (tokenHash,userId,sessionId,tokenVersion) VALUES (?,?,?,?)").run(hash(token), user.id, sessionId, user.tokenVersion ?? 0);
    })();
    return Response.json({ token, user: { id: user.id, username: user.username, displayName: user.displayName } }, { headers: { "Cache-Control": "no-store" } });
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  const user = resolveDeviceCredential(token);
  if (!user) return fail();
  if (route === "/realtime-ticket" && request.method === "POST") {
    prune(tickets);
    const ticket = random(); tickets.set(hash(ticket), { token, expires: Date.now() + 30_000 });
    return Response.json({ ticket }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!/^\/api\/sync\/v2(?:\/|$)/.test(route) || /%|\\|\/\//.test(route)) return fail(404);
  url.pathname = route;
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (/^x-(trim-|user-id$|session-id$|auth-|api-)/i.test(name)) headers.delete(name);
  headers.set("authorization", `Bearer ${internalToken(user)}`);
  const init: RequestInit & { duplex?: "half" } = { method: request.method, headers, signal: request.signal, redirect: "error" };
  if (request.method !== "GET" && request.method !== "HEAD") { init.body = request.body; init.duplex = "half"; }
  return app.fetch(new Request(url, init));
}

/** Realtime uses a short, single-use ticket, never a persistent credential in a URL. */
export function prepareDeviceRealtimeRequest(req: IncomingMessage): boolean {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith(DEVICE_PREFIX + "/")) return true;
  if (!process.env.NOWEN_FNOS_SOCKET || url.pathname !== `${DEVICE_PREFIX}/ws`) return false;
  const ticket = url.searchParams.get("ticket") || "";
  const entry = tickets.get(hash(ticket)); tickets.delete(hash(ticket));
  if (!entry || entry.expires <= Date.now()) return false;
  const user = resolveDeviceCredential(entry.token);
  if (!user) return false;
  req.url = `/ws?token=${encodeURIComponent(internalToken(user))}`;
  realtimeCredentials.set(req, entry.token);
  return true;
}

export function deviceRealtimeAuthorization(req: IncomingMessage): (() => boolean) | undefined {
  const token = realtimeCredentials.get(req);
  return token ? () => resolveDeviceCredential(token) !== null : undefined;
}
