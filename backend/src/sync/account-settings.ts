import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { SyncError } from "./errors";

const KEYS = new Set([
  "ai_provider", "ai_api_url", "ai_api_key", "ai_custom_headers", "ai_model",
  "ai_embedding_profile_id", "ai_embedding_url", "ai_embedding_key", "ai_embedding_model",
  "ai_multimodal_profile_id", "ai_multimodal_model",
  "ai_profiles_v1", "ai_active_profile_id", "ai_manual_enabled",
  "speech_api_url", "speech_api_key", "speech_model", "speech_language", "speech_source",
  "speech_profile_id", "speech_custom_headers",
]);
export type AccountSettings = Record<string, string>;
const MULTIMODAL_KEYS = new Set(["ai_multimodal_profile_id", "ai_multimodal_model"]);
export function accountSettingsForClient(settings: AccountSettings, modelSettingsV2: boolean): AccountSettings {
  return modelSettingsV2 ? settings : Object.fromEntries(Object.entries(settings).filter(([key]) => !MULTIMODAL_KEYS.has(key)));
}
export function validateAccountSettings(value: unknown): AccountSettings {
  if (!value || typeof value !== "object" || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 262144) throw new Error("Invalid account settings");
  const entries = Object.entries(value);
  if (entries.some(([key, item]) => !KEYS.has(key) || typeof item !== "string")) throw new Error("Invalid account setting key or value");
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}
export const settingsHash = (value: AccountSettings) => createHash("sha256").update(JSON.stringify(validateAccountSettings(value))).digest("hex");
export function readAccountSettings(db: Database.Database, userId: string): AccountSettings {
  const rows = db.prepare("SELECT key,value FROM user_ai_settings WHERE userId=?").all(userId) as { key: string; value: string }[];
  return validateAccountSettings(Object.fromEntries(rows.filter(row => KEYS.has(row.key)).map(row => [row.key, row.value])));
}
export function writeAccountSettings(db: Database.Database, userId: string, value: AccountSettings) {
  const checked = validateAccountSettings(value);
  db.transaction(() => {
    const remove = db.prepare("DELETE FROM user_ai_settings WHERE userId=? AND key=?");
    for (const key of KEYS) if (!(key in checked)) remove.run(userId, key);
    const upsert = db.prepare(`INSERT INTO user_ai_settings(userId,key,value,updatedAt) VALUES(?,?,?,datetime('now'))
      ON CONFLICT(userId,key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    for (const [key, value] of Object.entries(checked)) upsert.run(userId, key, value);
  })();
}

/** Configuration has its own CAS receipt; secrets never enter the note feed or logs. */
export async function syncAccountSettings(db: Database.Database, profileId: string, userId: string, serverUrl: string, request: typeof fetch) {
  db.exec(`CREATE TABLE IF NOT EXISTS sync_account_settings_state (
    profileId TEXT NOT NULL, userId TEXT NOT NULL, baseHash TEXT NOT NULL,
    PRIMARY KEY(profileId,userId))`);
  const url = serverUrl + "/api/sync/v2/account-settings?modelSettings=2";
  const response = await request(url, { signal: AbortSignal.timeout(10000), redirect: "error" });
  if (response.status === 404) return; // Older servers retain their existing note sync.
  if (!response.ok) throw new SyncError(response.status === 401 ? "AUTH_EXPIRED" : "SERVER_ERROR", "AI 配置同步连接失败");
  const remote = await response.json() as { settings: unknown; hash: string };
  const value = validateAccountSettings(remote.settings), remoteHash = settingsHash(value);
  if (remote.hash !== remoteHash) throw new SyncError("SERVER_ERROR", "AI 配置完整性校验失败");
  const local = readAccountSettings(db, userId), localHash = settingsHash(local);
  const state = db.prepare("SELECT baseHash FROM sync_account_settings_state WHERE profileId=? AND userId=?").get(profileId, userId) as { baseHash: string } | undefined;
  const remember = (hash: string) => db.prepare(`INSERT INTO sync_account_settings_state VALUES(?,?,?)
    ON CONFLICT(profileId,userId) DO UPDATE SET baseHash=excluded.baseHash`).run(profileId,userId,hash);
  if (localHash === remoteHash) { remember(remoteHash); return; }
  // First login deliberately adopts this account's server configuration.
  if ((!state && Object.keys(value).length > 0) || (state && localHash === state.baseHash)) {
    db.transaction(() => { writeAccountSettings(db,userId,value); remember(remoteHash); })();
    return;
  }
  if (state && remoteHash !== state.baseHash) throw new SyncError("VERSION_CONFLICT", "两端 AI 配置同时修改，已保留两端配置，请先统一配置后重试");
  const pushed = await request(url, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseHash: remoteHash, settings: local }), signal: AbortSignal.timeout(10000), redirect: "error" });
  if (pushed.status === 409) throw new SyncError("VERSION_CONFLICT", "AI 配置已在另一端修改，本机修改已保留");
  if (!pushed.ok) throw new SyncError("SERVER_ERROR", "AI 配置尚未同步，本机修改已保留");
  const ack = await pushed.json() as { hash?: string };
  if (ack.hash !== localHash) throw new SyncError("SERVER_ERROR", "AI 配置同步确认无效，本机修改已保留");
  remember(localHash);
}
