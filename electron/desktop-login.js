// Login uses the embedded workspace; the renderer never becomes a remote web view.
function registerDesktopLogin({ ipcMain, assertSender, getConnection, startAuthorization, onLogin, getLastServer, prepareServer = async value => value }) {
  const requests = new Set();
  async function request(route, body) {
    const local = await getConnection();
    if (!local?.token) throw new Error('本机服务尚未启动，请稍后重试');
    const response = await fetch(local.baseUrl + '/api/sync/local/' + route, {
      method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + local.token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(90000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '登录未完成，请重试');
    return { result, local };
  }
  async function complete(result, local) {
    if (!result.login?.token || !result.login?.user?.id) throw new Error('账号登录未完成');
    await onLogin(result.login, result.profile.serverUrl);
    return { ...result.login, serverUrl: local.baseUrl };
  }
  const handle = (name, fn) => ipcMain.handle(name, async (event, input) => {
    const denied=assertSender(event); if(denied) return denied;
    try { return await fn(event,input); } catch { return {error:'登录未完成，请检查服务器地址、账号或授权状态后重试'}; }
  });
  handle('desktop:login-info', async () => {
    const local=await getConnection(); if(!local) return {available:false};
    const {result}=await request('settings');
    return {available:true,serverUrl:getLastServer()||result.activeProfile?.serverUrl||result.profiles?.[0]?.serverUrl||''};
  });
  handle('desktop:login-start', async (event, input) => {
    if (!input || typeof input.serverUrl !== 'string' || input.serverUrl.length>2048) throw new Error('请输入服务器地址');
    if(input.method==='nas') {
      const result=await startAuthorization(event,input.serverUrl,true);
      if(result.requestId) requests.add(result.requestId);
      return result;
    }
    if(input.method!=='password') throw new Error('无效登录方式');
    const serverUrl=await prepareServer(input.serverUrl);
    const {result,local}=await request('settings/server/login',{serverUrl,username:input.username,password:input.password,ticket:input.ticket,code:input.code,desktopLogin:true});
    return result.requiresTwoFactor?result:complete(result,local);
  });
  handle('desktop:login-status', async (_event, input) => {
    if(!requests.has(input?.requestId)) throw new Error('授权请求已失效');
    const {result,local}=await request('settings/server/browser/status?requestId='+encodeURIComponent(input.requestId));
    if(result.status==='connected') { const login=await complete(result.result,local); requests.delete(input.requestId); return {status:'connected',login}; }
    return {status:result.status,error:result.error};
  });
  handle('desktop:login-cancel', async (_event,input) => {
    if(!requests.has(input?.requestId)) return {ok:true};
    requests.delete(input.requestId);
    await request('settings/server/browser/cancel',{requestId:input.requestId}); return {ok:true};
  });
}
module.exports={registerDesktopLogin};
