import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";
import { getDb } from "../db/schema";
import { invalidateUserAuthCache } from "./auth-security";

export interface FnosIdentity { uid: string; username: string; isAdmin: boolean }
// Only the dedicated Unix-socket listener may mark a Request as gateway-authenticated.
// HTTP headers on the ordinary TCP listener never populate this map.
const identities = new WeakMap<Request, FnosIdentity>();
export function markFnosGatewayRequest(request: Request, identity: FnosIdentity): void { identities.set(request, identity); }
export function getFnosGatewayIdentity(c: Context): FnosIdentity | undefined { return identities.get(c.req.raw); }

export function parseFnosIdentity(headers: Headers): FnosIdentity | null {
  const uid = headers.get("x-trim-userid") || "";
  const username = headers.get("x-trim-username") || "";
  const admin = headers.get("x-trim-isadmin");
  if (!/^(0|[1-9][0-9]{0,9})$/.test(uid) || Number(uid) > 2147483647
    || !username.trim() || username.length > 128 || /[\x00-\x1f\x7f]/.test(username)
    || (admin !== "true" && admin !== "false")) return null;
  return { uid, username, isAdmin: admin === "true" };
}

/** Lookup only: opening a page must never provision a NAS account. */
export function getLinkedFnosUid(userId: string): string | null {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fnos_identities'").get()) return null;
  return (db.prepare("SELECT uid FROM fnos_identities WHERE userId = ?").get(userId) as { uid: string } | undefined)?.uid ?? null;
}

export function getFnosAccount(identity: FnosIdentity) {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS fnos_identities (
    uid TEXT PRIMARY KEY, userId TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
  )`);
  return db.transaction(() => {
    const link = db.prepare("SELECT userId FROM fnos_identities WHERE uid = ?").get(identity.uid) as { userId: string } | undefined;
    let id = link?.userId;
    if (!id) {
      id = uuid();
      const base = `fnos_${identity.uid}`;
      // Never link an existing local account by username or email.
      const username = db.prepare("SELECT 1 FROM users WHERE username = ?").get(base) ? `${base}_${id.slice(0, 8)}` : base;
      db.prepare("INSERT INTO users (id, username, passwordHash, role, displayName) VALUES (?, ?, ?, ?, ?)")
        .run(id, username, bcrypt.hashSync(randomBytes(48).toString("base64"), 10), identity.isAdmin ? "admin" : "user", identity.username);
      db.prepare("INSERT INTO fnos_identities (uid, userId) VALUES (?, ?)").run(identity.uid, id);
      // NAS workspaces start empty; do not recreate the example notes the owner cleared.
      db.prepare("INSERT OR IGNORE INTO user_onboarding_state (userId, version, status) VALUES (?, 1, 'existing')").run(id);
    }
    const user = db.prepare("SELECT id, username, email, avatarUrl, displayName, role, createdAt, tokenVersion, isDisabled FROM users WHERE id = ?")
      .get(id) as { id: string; username: string; email: string | null; avatarUrl: string | null; displayName: string; role: string; createdAt: string; tokenVersion: number; isDisabled: number };
    if (!user || user.isDisabled) throw new Error("FNOS_ACCOUNT_DISABLED");
    const role = identity.isAdmin ? "admin" : "user";
    if (user.role !== role || user.displayName !== identity.username) {
      db.prepare("UPDATE users SET role = ?, displayName = ?, updatedAt = datetime('now') WHERE id = ?").run(role, identity.username, id);
      user.role = role; user.displayName = identity.username;
      invalidateUserAuthCache(id);
    }
    return user;
  })();
}
