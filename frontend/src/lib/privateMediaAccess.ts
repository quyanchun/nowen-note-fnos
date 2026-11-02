import { getBaseUrl } from "./api.impl";
import { fetchWithAuthRefresh, getAccessToken } from "./authSession";

const PATH = /\/(?:task-attachments|diary\/attachments)\/[0-9a-f-]{36}$/i;
const cache = new Map<string, { url: string; expiresAt: number }>();
const pending = new Map<string, Promise<string>>();

// Refresh rotates the JWT but retains the account/session. This is only a cache key;
// the server remains responsible for verifying every credential and capability.
function sessionKey(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.userId && payload.jti) return `${payload.userId}|${payload.jti}`;
  } catch { /* Test clients and legacy tokens use the full credential as their key. */ }
  return token;
}

function mediaUrl(raw: string): URL | null {
  try {
    const base = new URL(getBaseUrl(), window.location.href);
    const url = new URL(raw, window.location.href);
    // Never send a login credential to a URL supplied by note content or a remote page.
    if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`) || !PATH.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}

export function isPrivateMediaUrl(raw: string): boolean {
  const url = mediaUrl(raw);
  return Boolean(url && url.searchParams.get("access") !== "1");
}

export async function resolvePrivateMediaUrl(raw: string, refresh = false): Promise<string> {
  const url = mediaUrl(raw);
  const token = getAccessToken();
  if (!url || !token || url.searchParams.get("access") === "1") return raw;
  const session = sessionKey(token);
  const key = `${url.origin}${url.pathname}|${session}`;
  const existing = cache.get(key);
  if (!refresh && existing && existing.expiresAt > Date.now() + 30_000) {
    const signed = new URL(existing.url);
    for (const [name, value] of url.searchParams) if (name !== "mediaAccess") signed.searchParams.set(name, value);
    return signed.toString();
  }
  if (!refresh && url.searchParams.has("mediaAccess") && !existing) return raw;
  let promise = pending.get(key);
  if (!promise) {
    const access = new URL(url);
    access.search = "?access=1";
    promise = (async () => {
      const response = await fetchWithAuthRefresh(access.toString(), { headers: { Authorization: `Bearer ${token}` } }, getBaseUrl());
      if (!response.ok) throw new Error(`Private media access denied (${response.status})`);
      const result = await response.json() as { url: string; expiresAt: number };
      if (sessionKey(getAccessToken() || "") !== session) throw new Error("Media session changed");
      const capability = new URL(result.url, `${url.origin}/`);
      // The API returns an /api path; preserve the real deployment's reverse-proxy prefix.
      if (capability.origin !== url.origin) throw new Error("Invalid media capability origin");
      capability.pathname = url.pathname;
      if (!Number.isFinite(result.expiresAt) || !capability.searchParams.has("mediaAccess")) throw new Error("Invalid media capability");
      const signed = capability.toString();
      cache.set(key, { url: signed, expiresAt: result.expiresAt });
      return signed;
    })();
    pending.set(key, promise);
  }
  try {
    const signed = new URL(await promise);
    for (const [name, value] of url.searchParams) if (name !== "mediaAccess") signed.searchParams.set(name, value);
    return signed.toString();
  } finally { pending.delete(key); }
}

export function rewritePrivateMediaElement(element: Element, refresh = false): void {
  if (element.closest('[contenteditable="true"], .ProseMirror')) return;
  for (const attribute of ["src", "href", "poster"]) {
    const raw = element.getAttribute(attribute);
    if (!raw || !isPrivateMediaUrl(raw)) continue;
    void resolvePrivateMediaUrl(raw, refresh).then((signed) => {
      if (element.getAttribute(attribute) === raw && signed !== raw) element.setAttribute(attribute, signed);
    }).catch(() => { /* Keep access failures closed; never substitute a public URL. */ });
  }
}

export function resetPrivateMediaAccess(): void { cache.clear(); pending.clear(); }
if (typeof window !== "undefined") {
  window.addEventListener("nowen:token-changed", resetPrivateMediaAccess);
  window.addEventListener("nowen:server-url-changed", resetPrivateMediaAccess);
}
