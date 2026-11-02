import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-auth-session-cache-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "test-jwt-secret-for-auth-session-cache";

import { getDb } from "../src/db/schema";
import { userSessionsRepository } from "../src/repositories/userSessionsRepository";
import {
  getCachedAuthUser,
  invalidateUserAuthCache,
  setCachedAuthUser,
} from "../src/lib/auth-security";

const USER_ID = "auth-cache-user";

function seedUser(): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO users (id, username, passwordHash, role, tokenVersion)
    VALUES (?, ?, ?, 'admin', 1)
  `).run(USER_ID, "renamed-admin", "test-hash");
}

function primeStaleCache(): void {
  setCachedAuthUser(USER_ID, {
    username: "admin",
    tokenVersion: 0,
    isDisabled: 0,
    role: "admin",
  });
  assert.equal(getCachedAuthUser(USER_ID)?.tokenVersion, 0);
}

function resetSessions(): void {
  getDb().prepare("DELETE FROM user_sessions WHERE userId = ?").run(USER_ID);
  invalidateUserAuthCache(USER_ID);
}

test("creating a fresh login session clears stale tokenVersion and username cache", () => {
  seedUser();
  resetSessions();
  primeStaleCache();

  userSessionsRepository.create({
    id: "auth-cache-session-create",
    userId: USER_ID,
    ip: "127.0.0.1",
    userAgent: "test",
  });

  assert.equal(getCachedAuthUser(USER_ID), null);
  resetSessions();
});

test("reusing a device session also clears stale auth cache before JWT issuance", () => {
  seedUser();
  resetSessions();
  getDb().prepare(`
    INSERT INTO user_sessions (id, userId, ip, userAgent, deviceLabel, createdAt, lastSeenAt)
    VALUES (?, ?, '', '', ?, datetime('now'), datetime('now'))
  `).run("auth-cache-session-reuse", USER_ID, "device:test-device");
  primeStaleCache();

  const session = userSessionsRepository.findByDevice(USER_ID, "device:test-device");

  assert.equal(session?.id, "auth-cache-session-reuse");
  assert.equal(getCachedAuthUser(USER_ID), null);
  resetSessions();
});

test("async session creation keeps cache semantics aligned with the sync login path", async () => {
  seedUser();
  resetSessions();
  primeStaleCache();

  await userSessionsRepository.createAsync({
    id: "auth-cache-session-create-async",
    userId: USER_ID,
    ip: "127.0.0.1",
    userAgent: "test",
  });

  assert.equal(getCachedAuthUser(USER_ID), null);
  resetSessions();
});

test("async device reuse clears stale auth cache", async () => {
  seedUser();
  resetSessions();
  getDb().prepare(`
    INSERT INTO user_sessions (id, userId, ip, userAgent, deviceLabel, createdAt, lastSeenAt)
    VALUES (?, ?, '', '', ?, datetime('now'), datetime('now'))
  `).run("auth-cache-session-reuse-async", USER_ID, "device:test-device-async");
  primeStaleCache();

  const session = await userSessionsRepository.findByDeviceAsync(
    USER_ID,
    "device:test-device-async",
  );

  assert.equal(session?.id, "auth-cache-session-reuse-async");
  assert.equal(getCachedAuthUser(USER_ID), null);
  resetSessions();
});
