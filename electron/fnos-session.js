// fnOS' protected /app gateway requires its own browser session on every request.
// Keep that session in Electron; the embedded backend receives only a loopback capability.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const PREFIX = '/app/nowen-note-private';
const pinOf = pem => new crypto.X509Certificate(pem).fingerprint256.replaceAll(':', '').toUpperCase();
function permittedTarget(value, origins, websocket = false, method = 'GET') {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || !origins.has(url.origin)) return null;
    const suffix = url.pathname.slice(PREFIX.length);
    const settings = (['GET','PUT'].includes(method) && suffix === '/api/clipboard-settings')
      || (method === 'GET' && suffix === '/api/clipboard-settings/logs')
      || (method === 'DELETE' && /^\/api\/clipboard-settings\/logs\/[^/]{1,480}$/.test(suffix))
      || (method === 'POST' && /^\/api\/clipboard-settings\/logs\/[^/]{1,480}\/(?:force|undo)$/.test(suffix))
      || (['POST','DELETE'].includes(method) && suffix === '/api/clipboard-settings/token')
      || (method === 'POST' && suffix === '/api/clipboard-settings/token/rotate')
      || (method === 'GET' && suffix === '/api/notebooks');
    const sharing = (['GET','POST'].includes(method) && /^\/api\/shares\/?$/.test(suffix))
      || (method === 'POST' && suffix === '/api/shares/import-desktop')
      || (['GET','PUT','DELETE'].includes(method) && /^\/api\/shares\/[\w-]{1,128}$/.test(suffix))
      || (method === 'GET' && /^\/api\/shares\/(?:note\/[\w-]{1,128}|status\/batch)$/.test(suffix))
      || (method === 'GET' && /^\/api\/notes\/[\w-]{1,128}$/.test(suffix));
    if (!url.pathname.startsWith(PREFIX + '/') || (websocket ? suffix !== '/ws'
      : !(/^\/api\/sync\/v2(?:\/|$)/.test(suffix) || settings || sharing || ['/api/auth/fnos', '/api/auth/refresh', '/api/auth/login', '/api/auth/2fa/verify', '/api/health'].includes(suffix)))) return null;
    return url;
  } catch { return null; }
}
function createFnosSessionTransport({ session, BrowserWindow, getDataPath, getParent, WebSocket }) {
  const capability = crypto.randomBytes(32).toString('base64url');
  const origins = new Set(), sessions = new Map();
  let server, address;
  const restores = new Map();
  function trustedPin(origin) {
    try { return JSON.parse(fs.readFileSync(path.join(getDataPath(), '.sync_certificate_trust.json'), 'utf8'))[origin]; } catch { return null; }
  }
  function getSession(origin) {
    origins.add(origin);
    if (!sessions.has(origin)) {
      const ses = session.fromPartition('persist:nowen-fnos-' + crypto.createHash('sha256').update(origin).digest('hex').slice(0, 24));
      ses.setCertificateVerifyProc((request, callback) => {
        let matches = false;
        try { matches = request.hostname === new URL(origin).hostname && trustedPin(origin) === pinOf(request.certificate.data); } catch {}
        callback(request.errorCode === 0 ? -3 : matches ? 0 : -3);
      });
      ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      sessions.set(origin, ses);
    }
    return sessions.get(origin);
  }
  async function request(url, init) {
    return getSession(url.origin).fetch(url.href, { ...init, credentials: 'include', redirect: 'error' });
  }
  async function healthy(origin) {
    try {
      const response = await request(new URL(origin + PREFIX + '/api/health'), { signal: AbortSignal.timeout(2500) });
      const data = await response.json();
      return response.ok && data?.service === 'nowen-note' && data?.status === 'ok';
    } catch { return false; }
  }
  function restoreRememberedSession(origin) {
    if (restores.has(origin)) return restores.get(origin);
    const pending = (async () => {
      if (await healthy(origin)) return true;
      const ses = getSession(origin);
      const cookies = await ses.cookies?.get?.({ url: origin }) || [];
      if (!BrowserWindow || !cookies.some(cookie => cookie.session === false)) return false;
      // fnOS persists its refresh cookie, but restores the short session through its own portal.
      // No password is read or stored here, and the portal has no Node/Electron privileges.
      const win = new BrowserWindow({ show: false, webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true } });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, value) => { try { if (new URL(value).origin !== origin) event.preventDefault(); } catch { event.preventDefault(); } });
      try {
        void win.loadURL(origin).catch(() => {});
        const deadline = Date.now() + 8000;
        do {
          if (await healthy(origin)) { await ses.cookies.flushStore(); ses.flushStorageData?.(); return true; }
          await new Promise(resolve => setTimeout(resolve, 250));
        } while (Date.now() < deadline && !win.isDestroyed());
        return false;
      } finally { if (!win.isDestroyed()) win.destroy(); }
    })().catch(() => false).finally(() => restores.delete(origin));
    restores.set(origin, pending);
    return pending;
  }
  async function start() {
    if (address) return { NOWEN_FNOS_BRIDGE_URL: address, NOWEN_FNOS_BRIDGE_TOKEN: capability };
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(getDataPath(), '.sync_credentials.json'), 'utf8'));
      for (const value of Object.values(saved)) if (value.transport === 'fnos-session') getSession(new URL(value.serverUrl).origin);
    } catch {}
    for (const origin of origins) void restoreRememberedSession(origin);
    server = http.createServer(async (req, res) => {
      if (req.headers['x-nowen-bridge'] !== capability) { res.writeHead(403).end(); return; }
      const target = permittedTarget(req.headers['x-nowen-target'], origins, false, req.method);
      if (!target) { res.writeHead(403).end(); return; }
      try {
        const parts = []; let size = 0;
        for await (const part of req) { size += part.length; if (size > 128 * 1024 * 1024) throw new Error('Payload too large'); parts.push(part); }
        const headers = {};
        for (const key of ['authorization', 'content-type', 'accept', 'x-device-id']) if (typeof req.headers[key] === 'string') headers[key] = req.headers[key];
        if (restores.has(target.origin)) await restores.get(target.origin);
        const init = { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(parts), signal: AbortSignal.timeout(90_000) };
        let upstream = await request(target, init);
        const isBinaryRead = /\/api\/sync\/v2\/blob\//.test(target.pathname) && ['GET', 'HEAD'].includes(req.method);
        const unexpected = response => response.ok && (isBinaryRead ? !response.headers.get('x-blob-hash') : !response.headers.get('content-type')?.includes('application/json'));
        if (unexpected(upstream) && !await healthy(target.origin)) {
          await upstream.body?.cancel();
          if (await restoreRememberedSession(target.origin)) upstream = await request(target, init);
          else { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 'AUTH_EXPIRED' })); return; }
        }
        if (!isBinaryRead && unexpected(upstream)) {
          // fnOS may return login HTML or plain 'invalid token' with HTTP 200.
          res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ code: 'AUTH_EXPIRED', error: 'NAS 登录已过期，请重新授权' }));
          await upstream.body?.cancel(); return;
        }
        res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store', ...(upstream.headers.get('x-blob-hash') ? { 'X-Blob-Hash': upstream.headers.get('x-blob-hash') } : {}) });
        if (upstream.body) Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res); else res.end();
      } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
    });
    const sockets = new WebSocket.WebSocketServer({ noServer: true });
    server.on('upgrade', async (req, socket, head) => {
      const target = permittedTarget(req.headers['x-nowen-target'], origins, true);
      if (req.headers['x-nowen-bridge'] !== capability || !target) { socket.destroy(); return; }
      try {
        if (restores.has(target.origin)) await restores.get(target.origin);
        const cookies = await getSession(target.origin).cookies.get({ url: target.href });
        const secure = target.protocol === 'https:';
        const tls = require('node:tls'), https = require('node:https');
        let agent;
        if (secure && trustedPin(target.origin)) {
          agent = new https.Agent();
          agent.createConnection = (_options, callback) => {
            let settled = false;
            const done = (...args) => { if (!settled) { settled = true; callback(...args); } };
            const remote = tls.connect({ host: target.hostname, port: Number(target.port || 443), servername: target.hostname, rejectUnauthorized: false }, () => {
              const cert = remote.getPeerCertificate();
              if ((remote.authorized && !tls.checkServerIdentity(target.hostname, cert)) || cert.fingerprint256?.replaceAll(':', '').toUpperCase() === trustedPin(target.origin)) done(null, remote);
              else { done(new Error('NAS certificate changed')); remote.destroy(); }
            });
            remote.once('error', done);
            remote.setTimeout(10_000, () => remote.destroy(new Error('NAS TLS timeout')));
          };
        }
        const remote = new WebSocket(target.href.replace(/^http/, 'ws'), { agent, headers: { Cookie: cookies.map(item => `${item.name}=${item.value}`).join('; ') }, handshakeTimeout: 10_000 });
        remote.once('error', () => socket.destroy());
        remote.once('open', () => sockets.handleUpgrade(req, socket, head, local => {
          local.on('message', (data, binary) => { if (remote.readyState === 1) remote.send(data, { binary }); });
          remote.on('message', (data, binary) => { if (local.readyState === 1) local.send(data, { binary }); });
          local.once('close', () => remote.close()); remote.once('close', () => local.close());
          local.on('error', () => remote.close()); remote.on('error', () => local.close());
        }));
      } catch { socket.destroy(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    address = `http://127.0.0.1:${server.address().port}`;
    return { NOWEN_FNOS_BRIDGE_URL: address, NOWEN_FNOS_BRIDGE_TOKEN: capability };
  }
  function authorize(origin, onReady, onCancel) {
    const ses = getSession(origin);
    const win = new BrowserWindow({ parent: getParent(), width: 1050, height: 760, title: '飞牛 NAS 授权登录', webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true } });
    let busy = false, finished = false;
    const poll = async () => {
      if (busy || finished || win.isDestroyed()) return;
      busy = true;
      try {
        const response = await request(new URL(origin + PREFIX + '/api/auth/fnos'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const payload = response.ok ? await response.json() : null;
        if (payload?.token && payload?.user?.id) {
          await ses.cookies?.flushStore?.(); ses.flushStorageData?.();
          await onReady(); finished = true; win.close();
        }
      } catch { /* The protected gateway is unavailable until NAS login completes. */ }
      finally { busy = false; }
    };
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, value) => { try { if (new URL(value).origin !== origin) event.preventDefault(); } catch { event.preventDefault(); } });
    const timer = setInterval(poll, 1800), expiry = setTimeout(() => win.close(), 5 * 60_000);
    win.on('closed', () => { clearInterval(timer); clearTimeout(expiry); if (!finished) void onCancel(); });
    void win.loadURL(origin).catch(() => {});
    void poll();
  }
  async function prepareServer(value) {
    const url=new URL(value);
    if(!["https:","http:"].includes(url.protocol)||url.username||url.password||url.search||url.hash) throw new Error("Invalid server URL");
    getSession(url.origin);
    if (["/",PREFIX,PREFIX+"/"].includes(url.pathname) && await restoreRememberedSession(url.origin)) return url.origin+PREFIX;
    return value.replace(/\/+$/,"");
  }
  return { start, authorize, prepareServer, close: () => new Promise(resolve => { if (server) { server.closeAllConnections(); server.close(resolve); } else resolve(); }) };
}
module.exports = { createFnosSessionTransport, permittedTarget };
