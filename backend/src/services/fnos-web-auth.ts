import { createHash, randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { getFnosAccount, getFnosGatewayIdentity } from "../lib/fnos-identity";
import { checkAndIncrementIpRate, extractClientIp } from "../lib/auth-security";

import { readFnosWebEntries } from "./fnos-web-config";

const cookieName = (origin: string) => origin.startsWith("https:") ? "__Host-nowen_web_login" : "nowen_web_login";
const TTL = 5 * 60_000;
const random = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const validSecret = (value: unknown): value is string => typeof value === "string" && /^[\w-]{43}$/.test(value);
export type WebApproval = { userId: string; uid: string; tokenVersion: number; role: string };
type Pending = { webOrigin: string; portalOrigin: string; callback: boolean; grant?: { code: string; approval: WebApproval; expires: number }; binding: string; proof: string; expires: number; approval?: WebApproval; lastProbeAt?: number; probe?: Promise<void> };

export function fnosWebOptions(origin?: string) {
  const entries = readFnosWebEntries();
  const entry = origin === undefined ? entries[0] : entries.find(row => row.webOrigin === origin);
  return entry ? {webOrigin:entry.webOrigin,portalOrigin:entry.portalOrigin} : null;
}

/** Browser-bound, single-use approval. NAS identity is accepted only from the private gateway. */
export function createFnosWebAuthRoutes(issueLogin: (approval: WebApproval, c: Context) => unknown) {
  const routes = new Hono();
  const pending = new Map<string, Pending>();
  const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 410 | 429 = 400) => c.json({ error: "网页登录授权无效或已过期，请重新登录", code: "WEB_AUTH_INVALID" }, status);
  const prune = () => { for (const [id, item] of pending) if (item.expires <= Date.now()) pending.delete(id); };
  routes.use("*", async (c, next) => { c.header("Cache-Control", "no-store"); c.header("Referrer-Policy", "no-referrer"); await next(); });
  routes.get("/options", c => { const options=fnosWebOptions(c.req.query("origin")); return c.json({enabled:!!options,...options}); });
  routes.post("/start", async c => {
    const options = fnosWebOptions(c.req.header("origin"));
    if (!options) return fail(c, readFnosWebEntries().length ? 403 : 404);
    if (c.req.header("origin") !== options.webOrigin || c.req.header("sec-fetch-site") === "cross-site") return fail(c, 403);
    if (checkAndIncrementIpRate(`web-login:${extractClientIp(c)}`)) return fail(c, 429);
    prune();
    if (pending.size >= 1000) return fail(c, 429);
    const binding = random();
    setCookie(c, cookieName(options.webOrigin), binding, { path: "/", httpOnly: true, sameSite: "Lax", secure: options.webOrigin.startsWith("https:"), maxAge: TTL / 1000 });
    const id = random(), proof = random();
    const body = await c.req.json().catch(() => ({}));
    const callback = body?.flow === "callback";
    // Cross-host entries always require the callback binding; legacy cookie probing
    // is retained solely for the original same-host clients.
    if (!callback && new URL(options.webOrigin).hostname !== new URL(options.portalOrigin).hostname) return fail(c, 400);
    pending.set(id, { ...options, callback, binding: hash(binding), proof: hash(proof), expires: Date.now() + TTL });
    return c.json({ id, proof, expiresIn: TTL / 1000, portalUrl: options.portalOrigin + "/", ...(callback ? { authorizeUrl: options.portalOrigin + "/app/nowen-note-private/api/auth/web/authorize?requestId=" + id } : {}) });
  });

  const active = (item: Pending) => fnosWebOptions(item.webOrigin)?.portalOrigin === item.portalOrigin;
  const getPending = (c: Context, id: unknown, proof?: unknown) => {
    prune();
    if (!validSecret(id)) return null;
    const item = pending.get(id);
    const binding = item ? getCookie(c, cookieName(item.webOrigin)) : undefined;
    if (!item || !active(item) || !validSecret(binding) || hash(binding) !== item.binding) return null;
    if (proof !== undefined && (!validSecret(proof) || hash(proof) !== item.proof)) return null;
    return item;
  };
  routes.post("/poll", async c => {
    const options = fnosWebOptions(c.req.header("origin"));
    if (!options || c.req.header("origin") !== options.webOrigin || c.req.header("sec-fetch-site") === "cross-site") return fail(c, 403);
    const body = await c.req.json().catch(() => ({}));
    if (!body || typeof body !== "object") return fail(c);
    // Missing proof must not turn into an unprotected status query.
    if (!validSecret(body.proof)) return fail(c, 403);
    const item = getPending(c, body.id, body.proof);
    if (!item) return fail(c, 410);
    if (item.webOrigin !== options.webOrigin) return fail(c, 403);
    if (!item.approval && !item.callback) {
      if (!item.probe && Date.now() - (item.lastProbeAt || 0) >= 1000) {
        item.lastProbeAt = Date.now();
        // Validate the browser's existing NAS session through the normal gateway.
        // Only that private listener can populate approval; never trust the HTTP body
        // or client identity headers. Cookies stay on this NAS and are never stored.
        item.probe = (async () => {
          try {
            const response = await fetch(`${options.portalOrigin}/app/nowen-note-private/api/auth/web/authorize?requestId=${body.id}`, {
              headers: { Cookie: c.req.header("cookie") || "", Accept: "application/json" },
              redirect: "error", signal: AbortSignal.timeout(4000),
            });
            await response.body?.cancel();
          } catch { /* No valid NAS session yet; the ordinary portal restores it. */ }
        })().finally(() => { delete item.probe; });
      }
      await item.probe;
    }
    if (pending.get(body.id) !== item) return fail(c, 410);
    if (item.expires <= Date.now()) { pending.delete(body.id); return fail(c, 410); }
    if (!item.approval) return c.json({ status: "waiting" });
    pending.delete(body.id);
    try { return c.json({ status: "connected", login: issueLogin(item.approval, c) }); }
    catch { return fail(c, 403); }
  });
  routes.post("/cancel", async c => {
    const options = fnosWebOptions(c.req.header("origin"));
    if (!options || c.req.header("origin") !== options.webOrigin || c.req.header("sec-fetch-site") === "cross-site") return fail(c, 403);
    const body = await c.req.json().catch(() => ({}));
    if (!body || typeof body !== "object") return fail(c);
    if (!validSecret(body.proof) || getPending(c, body.id, body.proof)?.webOrigin !== options.webOrigin) return fail(c, 410);
    pending.delete(body.id);
    return c.json({ cancelled: true });
  });
  routes.get("/complete", c => {
    const id=c.req.query("requestId"), code=c.req.query("code");
    const item=getPending(c,id);
    if (!item?.callback || !validSecret(code) || !item.grant || item.grant.expires<=Date.now() || hash(code)!==item.grant.code) return fail(c,410);
    item.approval=item.grant.approval; delete item.grant;
    c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
    c.header("X-Content-Type-Options","nosniff");
    c.header("X-Frame-Options","SAMEORIGIN");
    return c.html("<!doctype html><html lang=zh-CN><meta charset=utf-8><title>飞牛授权完成</title><p>已完成飞牛授权，请返回笔记页面。</p></html>");
  });
  routes.get("/authorize", async c => {
    const identity = getFnosGatewayIdentity(c);
    if (!identity) return fail(c, 401);
    prune();
    const id=c.req.query("requestId"), candidate=validSecret(id) ? pending.get(id) : undefined;
    if (candidate?.callback) {
      if (!active(candidate) || candidate.approval) return fail(c,410);
      // A NAS-authenticated navigation creates a short-lived code, never a login.
      // Only the original note-origin HttpOnly binding can redeem it. Sending an
      // attacker-created authorization link to another browser cannot approve it.
      try {
        const user=getFnosAccount(identity);
        if (candidate.grant && candidate.grant.approval.uid!==identity.uid) return fail(c,403);
        const code=random();
        candidate.grant={code:hash(code),expires:Date.now()+60000,approval:{userId:user.id,uid:identity.uid,tokenVersion:user.tokenVersion??0,role:user.role}};
        return c.redirect(candidate.webOrigin+"/api/auth/web/complete?requestId="+id+"&code="+code,302);
      } catch { return fail(c,403); }
    }
    const options=fnosWebOptions(candidate?.webOrigin);
    if (!options) return fail(c,401);
    if (c.req.header("sec-fetch-site") === "cross-site") return fail(c, 403);
    const item=getPending(c,id);
    if (!item) return fail(c, 410);
    if (item.approval && item.approval.uid !== identity.uid) return fail(c, 403);
    try {
      // The same browser explicitly started this login from the independent page.
      // Its HttpOnly binding and private poll proof prevent login CSRF or code theft.
      if (!item.approval) {
        const user = getFnosAccount(identity);
        item.approval = { userId: user.id, uid: identity.uid, tokenVersion: user.tokenVersion ?? 0, role: user.role };
      }
      return c.json({ authorized: true });
    } catch { return fail(c, 403); }
  });
  return routes;
}
