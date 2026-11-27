import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nowen-fnos-password-'));
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.JWT_SECRET = 'fnos-password-setup-isolated-test-secret';

test('fnOS first password setup requires a live owned session and preserves local password verification (DCC-006)', async () => {
  const { getDb, closeDb } = await import('../src/db/schema');
  const { default: auth, createFnosLogin } = await import('../src/routes/auth');
  const { requiresCurrentPassword } = await import('../src/lib/fnos-identity');
  const { default: bcrypt } = await import('bcryptjs');
  const app = new Hono(); app.route('/api/auth', auth);
  const db = getDb();
  const post = (token: string, body: object) => app.request('/api/auth/change-password', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    db.exec("CREATE TABLE fnos_identities (uid TEXT PRIMARY KEY, userId TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE)");
    for (const [id, version] of [['legacy-initial', 0], ['legacy-configured', 1]] as const) {
      db.prepare('INSERT INTO users (id, username, passwordHash, tokenVersion) VALUES (?, ?, ?, ?)').run(id, id, bcrypt.hashSync('legacy-synthetic-password', 10), version);
      db.prepare('INSERT INTO fnos_identities (uid, userId) VALUES (?, ?)').run(id, id);
    }
    assert.equal(requiresCurrentPassword('legacy-initial'), false, 'migrates untouched fnOS accounts');
    assert.equal(requiresCurrentPassword('legacy-configured'), true, 'preserves prior password changes/resets');
    const login = createFnosLogin({ uid: '1000', username: 'nas-user', isAdmin: false });
    assert.equal(requiresCurrentPassword(login.user.id), false);
    assert.equal((await post('', { newPassword: 'new-synthetic-password' })).status, 401);
    assert.equal((await post(login.token, { newPassword: 'short' })).status, 400);
    const profile = await post(login.token, { newDisplayName: 'My name' });
    assert.equal(profile.status, 200);
    assert.equal(requiresCurrentPassword(login.user.id), false, 'profile changes do not establish a password');
    const other = createFnosLogin({ uid: '1001', username: 'other', isAdmin: false });
    const otherHash = (db.prepare('SELECT passwordHash FROM users WHERE id = ?').get(other.user.id) as any).passwordHash;
    const responses = await Promise.all([post(login.token, { newPassword: 'new-synthetic-password' }), post(login.token, { newPassword: 'another-synthetic-password' })]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409], 'concurrent initial setup cannot overwrite a password');
    const accepted = responses.findIndex(r => r.status === 200);
    const password = accepted === 0 ? 'new-synthetic-password' : 'another-synthetic-password';
    const updated = await responses[accepted].json() as any;
    assert.equal(requiresCurrentPassword(login.user.id), true);
    assert.equal((db.prepare('SELECT passwordHash FROM users WHERE id = ?').get(other.user.id) as any).passwordHash, otherHash);
    assert.equal((await post(login.token, { newPassword: 'stale-synthetic-password' })).status, 401, 'old session is invalidated');
    assert.equal((await post(updated.token, { newPassword: 'next-synthetic-password' })).status, 400);
    assert.equal((await post(updated.token, { currentPassword: 'wrong-password', newPassword: 'next-synthetic-password' })).status, 403);
    assert.equal((await post(updated.token, { currentPassword: password, newPassword: 'next-synthetic-password' })).status, 200);
    db.prepare('INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)').run('local', 'local-user', bcrypt.hashSync('local-synthetic-password', 10));
    const localRes = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'local-user', password: 'local-synthetic-password' }) });
    const local = await localRes.json() as any;
    assert.equal(requiresCurrentPassword('local'), true);
    assert.equal((await post(local.token, { newPassword: 'next-synthetic-password', currentPasswordRequired: false })).status, 400, 'client flags cannot bypass verification');
    db.prepare('UPDATE user_sessions SET revokedAt = datetime(\'now\') WHERE userId = ?').run(other.user.id);
    assert.equal((await post(other.token, { newPassword: 'next-synthetic-password' })).status, 401);
    const disabled = createFnosLogin({ uid: '1002', username: 'disabled', isAdmin: false });
    db.prepare('UPDATE users SET isDisabled = 1 WHERE id = ?').run(disabled.user.id);
    assert.equal((await post(disabled.token, { newPassword: 'next-synthetic-password' })).status, 403);
  } finally { closeDb(); fs.rmSync(directory, { recursive: true, force: true }); }
});
