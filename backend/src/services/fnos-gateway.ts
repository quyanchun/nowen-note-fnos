import { createServer, type IncomingMessage } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";
import { parseFnosIdentity, markFnosGatewayRequest, getFnosAccount, getLinkedFnosUid } from "../lib/fnos-identity";
import { verifyLoginToken, verifyRefreshToken } from "../lib/auth-security";
import { attachRealtimeServer } from "./realtime";
import { looksLikeApiToken, resolveApiToken } from "../lib/api-tokens";
import { getDb } from "../db/schema";
import { authenticateClipboard, isClipboardCapabilityRoute } from "./clipboard-integration";

export const FNOS_PREFIX = "/app/nowen-note-private";
function localPath(url: URL): string | null {
  if (url.pathname !== FNOS_PREFIX && !url.pathname.startsWith(FNOS_PREFIX + "/")) return null;
  return url.pathname.slice(FNOS_PREFIX.length) || "/";
}
function jsonError(status: number, code: string): Response {
  return Response.json({ error: "飞牛登录状态无效，请重新打开桌面入口", code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function dispatchFnosGateway(request: Request, app: Hono): Promise<Response> {
  const url = new URL(request.url);
  const pathname = localPath(url);
  if (pathname === null) return jsonError(404, "FNOS_PATH_REQUIRED");
  const identity = parseFnosIdentity(request.headers);
  if (!identity) return jsonError(401, "FNOS_IDENTITY_REQUIRED");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site") return jsonError(403, "FNOS_ORIGIN_REJECTED");
    if (origin) {
      try { if (new URL(origin).host !== url.host || !/^https?:$/.test(new URL(origin).protocol)) return jsonError(403, "FNOS_ORIGIN_REJECTED"); }
      catch { return jsonError(403, "FNOS_ORIGIN_REJECTED"); }
    }
  }
  try {
    const headers = new Headers(request.headers);
    if (pathname.startsWith("/api/")) {
      const matchesIdentity = (userId: string) => {
        const uid = getLinkedFnosUid(userId);
        if (uid === null) return true; // Independent note accounts use their own credentials.
        if (uid !== identity.uid) return false;
        getFnosAccount(identity); // Apply current NAS roles and disabled-account checks.
        return true;
      };
      if (pathname === "/api/auth/refresh") {
        const body = await request.clone().json().catch(() => null) as { refreshToken?: string } | null;
        const refreshed = verifyRefreshToken(body?.refreshToken || "");
        if (!refreshed || !matchesIdentity(refreshed.userId)) return jsonError(401, "FNOS_IDENTITY_MISMATCH");
      }
      const bearer = headers.get("authorization");
      // A late save from a previous NAS user must fail, never run as the new user.
      if (bearer && pathname !== "/api/auth/fnos") {
        const raw = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
        let payload;
        if (raw.startsWith("ncc_") && isClipboardCapabilityRoute(pathname, request.method)) {
          try { payload = authenticateClipboard(raw); }
          catch { return jsonError(401, "FNOS_IDENTITY_MISMATCH"); }
        } else {
          payload = looksLikeApiToken(raw) ? resolveApiToken(getDb(), raw, undefined, { trackUsage: false }) : verifyLoginToken(raw);
        }
        if (!payload || !matchesIdentity(payload.userId)) return jsonError(401, "FNOS_IDENTITY_MISMATCH");
      }
      // NAS authentication is explicit: never mint or inject a note token here.
    }
    // The prefix is routing, not an authority signal; only this listener marks identity.
    url.pathname = pathname;
    const init: RequestInit & { duplex?: "half" } = { method: request.method, headers, signal: request.signal };
    if (request.method !== "GET" && request.method !== "HEAD") { init.body = request.body; init.duplex = "half"; }
    const forwarded = new Request(url, init);
    markFnosGatewayRequest(forwarded, identity);
    const response = await app.fetch(forwarded);
    if (!pathname.startsWith("/api/")) return response;
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "private, no-store");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  } catch (error) {
    if ((error as Error).message === "FNOS_ACCOUNT_DISABLED") return jsonError(403, "ACCOUNT_DISABLED");
    console.error("[fnos] gateway request failed");
    return jsonError(500, "FNOS_AUTH_FAILED");
  }
}

function prepareGatewayUpgrade(req: IncomingMessage): boolean {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = localPath(url);
    const headers = new Headers();
    for (const name of ["x-trim-userid", "x-trim-username", "x-trim-isadmin"]) {
      const value = req.headers[name]; if (typeof value === "string") headers.set(name, value);
    }
    const identity = parseFnosIdentity(headers);
    if (!identity || pathname !== "/ws") return false;
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== url.host) return false;
    if (url.searchParams.get("probe") !== "1") {
      const payload = verifyLoginToken(url.searchParams.get("token") || "");
      if (!payload) return false;
      const uid = getLinkedFnosUid(payload.userId);
      if (uid !== null) {
        if (uid !== identity.uid) return false;
        getFnosAccount(identity);
      }
    }
    req.url = pathname + url.search;
    return true;
  } catch { return false; }
}

export function startFnosGateway(app: Hono) {
  const socketPath = process.env.NOWEN_FNOS_SOCKET;
  if (!socketPath) return null;
  if (!path.isAbsolute(socketPath)) throw new Error("FNOS socket must use an absolute path");
  if (fs.existsSync(socketPath)) {
    if (!fs.lstatSync(socketPath).isSocket()) throw new Error("Refusing to replace a non-socket FNOS path");
    fs.unlinkSync(socketPath);
  }
  const server = createServer(getRequestListener((request) => dispatchFnosGateway(request, app)));
  attachRealtimeServer(server, prepareGatewayUpgrade);
  server.listen(socketPath, () => {
    // Root's fnOS gateway can connect; other application users cannot forge identity.
    fs.chmodSync(socketPath, 0o600);
    console.log("[fnos] private gateway socket ready");
  });
  return server;
}
