import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { findProfileByServer } from "./profile";
import { getRemoteCredential } from "./credentials";

/** A server/account pair owns one local workspace; old desktop data is retained. */
export function bindDesktopAccount(db: Database.Database, serverUrl: string, remote: { id: string; username?: string; displayName?: string; role?: string }): string {
  db.exec(`CREATE TABLE IF NOT EXISTS desktop_account_links (
    serverUrl TEXT NOT NULL, remoteUserId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY(serverUrl,remoteUserId))`);
  return db.transaction(() => {
    const linked = db.prepare("SELECT userId FROM desktop_account_links WHERE serverUrl=? AND remoteUserId=?").get(serverUrl,remote.id) as { userId: string } | undefined;
    const profile = findProfileByServer(db,serverUrl,remote.id);
    const previous = profile ? getRemoteCredential(profile.id)?.localUserId : undefined;
    let userId = linked?.userId || previous;
    if (userId && !linked && db.prepare("SELECT 1 FROM desktop_account_links WHERE userId=?").get(userId)) userId=undefined;
    if (!userId) {
      userId=randomUUID();
      const username="account_"+createHash("sha256").update(serverUrl+"\0"+remote.id).digest("hex").slice(0,24);
      db.prepare("INSERT INTO users(id,username,passwordHash,role,displayName) VALUES(?,?,'!remote-only',?,?)")
        .run(userId,username,remote.role==="admin"?"admin":"user",remote.displayName||remote.username||"NAS 账号");
    }
    if (!db.prepare("SELECT 1 FROM users WHERE id=? AND isDisabled=0").get(userId)) throw new Error("此设备上的账号已禁用");
    db.prepare("INSERT OR IGNORE INTO desktop_account_links VALUES(?,?,?)").run(serverUrl,remote.id,userId);
    // Display the actual account, while retaining IDs, roles and every existing note.
    db.prepare("UPDATE users SET displayName=? WHERE id=?").run(remote.displayName||remote.username||"NAS 账号",userId);
    return userId;
  })();
}
