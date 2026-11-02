const os = require("node:os");
const SCHEME = "nowen-note-private";

function parseAuthorizationCallback(input) {
  try {
    if (typeof input !== "string" || input.length > 512) return null;
    const url = new URL(input);
    if (url.protocol !== `${SCHEME}:` || url.hostname !== "auth" || url.pathname !== "/callback"
      || url.username || url.password || url.port || url.hash
      || [...url.searchParams.keys()].sort().join(",") !== "code,state") return null;
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    return /^[A-Za-z0-9_-]{43}$/.test(code || "") && /^[A-Za-z0-9_-]{43}$/.test(state || "") ? { code, state } : null;
  } catch { return null; }
}

function registerBrowserAuthorization({ app, shell, ipcMain, assertSender, getConnection, focus, confirmCertificate = async () => false, authorizeFnosSession, fetchImpl = fetch }) {
  const localRequest = async (route, body) => {
    const local = await getConnection();
    if (!local?.token || !/^http:\/\/127\.0\.0\.1:\d+$/.test(local.baseUrl)) throw new Error("请等待本地工作区启动后重试");
    const response = await fetchImpl(`${local.baseUrl}/api/sync/local/settings/server/browser/${route}`, {
      method: "POST", headers: { Authorization: `Bearer ${local.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(typeof result.error === "string" ? result.error : "授权连接失败，请重新发起"), { response: result });
    return result;
  };
  const handleCallback = async input => {
    const fields = parseAuthorizationCallback(input);
    if (!fields) return false;
    focus();
    try { await localRequest("finish", fields); return true; }
    catch { console.warn("[sync-auth] callback rejected; restart device authorization"); return false; }
  };
  // macOS can deliver open-url before ready; register synchronously.
  app.on("open-url", (event, url) => { if (parseAuthorizationCallback(url)) { event.preventDefault(); void handleCallback(url); } });
  const startAuthorization = async (event, serverUrl, desktopLogin = false) => {
    const denied = assertSender(event); if (denied) return denied;
    try {
      if (typeof serverUrl !== "string" || serverUrl.length > 2048) throw new Error("请输入 NAS 地址");
      const body = { serverUrl, deviceName: os.hostname(), ...(desktopLogin ? { desktopLogin: true } : {}) };
      let result;
      try { result = await localRequest("start", body); }
      catch (error) {
        const cert = error.response?.certificate;
        if (error.response?.code !== "NAS_CERTIFICATE_UNTRUSTED" || !cert || cert.origin !== new URL(serverUrl).origin) throw error;
        if (!await confirmCertificate(cert)) return { error: "未信任该 NAS 证书，连接已取消" };
        await localRequest("trust", { serverUrl, fingerprint: cert.fingerprint });
        result = await localRequest("start", body);
      }
      if (result.transport === "fnos-session") {
        if (!authorizeFnosSession) throw new Error("请更新桌面客户端后重试");
        authorizeFnosSession(new URL(serverUrl).origin,
          async () => { await localRequest("native-finish", { requestId: result.requestId, state: result.state }); focus(); },
          async () => { await localRequest("cancel", { requestId: result.requestId }).catch(() => {}); });
        return { requestId: result.requestId, expiresAt: result.expiresAt };
      }
      const target = new URL(result.authorizationUrl);
      if (target.origin !== new URL(serverUrl).origin || target.pathname !== "/app/nowen-note-private/client-authorize"
        || !["https:", "http:"].includes(target.protocol) || target.username || target.password) throw new Error("NAS 返回了无效的授权地址");
      await shell.openExternal(target.toString());
      return { requestId: result.requestId, expiresAt: result.expiresAt };
    } catch (error) { return { error: error.message || "无法发起浏览器授权" }; }
  };
  ipcMain.handle("sync:browser-authorize", startAuthorization);
  return { startAuthorization, handleCallback, registerProtocol: () => app.setAsDefaultProtocolClient(SCHEME) };
}
module.exports = { parseAuthorizationCallback, registerBrowserAuthorization };
