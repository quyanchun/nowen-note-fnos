import type Database from "better-sqlite3";
import type { MiddlewareHandler } from "hono";
import { getDb } from "../db/schema";
import { isLocalFirstSyncV2Enabled } from "./flag";
import { notifySyncChanged } from "./notify";
let wake: (() => void) | null = null;
export function setLocalSyncWakeup(listener: (() => void) | null) { wake = listener; }
export function committedSequence(db: Database.Database): number {
  return Number((db.prepare("SELECT MAX(sequence) AS sequence FROM sync_changes_v2").get() as { sequence: number | null }).sequence || 0);
}
/** Call after the business transaction commits; rollbacks produce no notifications. */
export function notifyCommittedWrites(db: Database.Database, after: number): void {
  try {
    const changes = db.prepare(`SELECT userId,workspaceId,entityType,entityId FROM sync_changes_v2
      WHERE sequence>? GROUP BY userId,workspaceId,entityType,entityId`).all(after) as {userId:string;workspaceId:string|null;entityType:string;entityId:string}[];
    const scopes = new Map(changes.map(row => [JSON.stringify([row.userId,row.workspaceId]),row]));
    for (const row of scopes.values()) notifySyncChanged(db,row.userId,row.workspaceId?`workspace:${row.workspaceId}`:"personal");
    if (changes.length) wake?.();
    // Ordinary REST writers already publish their own note/list events.
  } catch { /* A missed hint never changes the committed data; periodic sync retries. */ }
}
export const syncWriteNotificationMiddleware: MiddlewareHandler = async (c,next) => {
  if (!isLocalFirstSyncV2Enabled() || !["POST","PUT","PATCH","DELETE"].includes(c.req.method)
    || c.req.path.startsWith("/api/sync/")) { await next(); return; }
  const db=getDb(),before=committedSequence(db);
  await next();
  if(c.res.status>=200 && c.res.status<300) notifyCommittedWrites(db,before);
};
