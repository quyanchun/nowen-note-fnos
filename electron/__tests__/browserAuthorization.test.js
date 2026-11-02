const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { parseAuthorizationCallback, registerBrowserAuthorization } = require("../browser-authorization");
const code = "c".repeat(43), state = "s".repeat(43);
const callback = `nowen-note-private://auth/callback?code=${code}&state=${state}`;
test("desktop callbacks accept only the fixed protocol, route and one-time fields", () => {
  assert.deepEqual(parseAuthorizationCallback(callback), { code, state });
  for (const url of [callback.replace("nowen-note-private:", "https:"), callback.replace("auth/", "hostile/"), callback + "&token=secret", callback + "&state=duplicate", "nowen-note-private://auth/callback?code=x&state=y"]) {
    assert.equal(parseAuthorizationCallback(url), null);
  }
});
test("browser authorization uses trusted IPC, local backend and redacted failures", async () => {
  const app = new EventEmitter(); app.setAsDefaultProtocolClient = () => true;
  const handlers = new Map(), requests = [], opened = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => url.endsWith("/start") ? { requestId: "pending", authorizationUrl: `https://nas.example.com/app/nowen-note-private/client-authorize?state=${state}` } : { authorized: true } };
  };
  const bridge = registerBrowserAuthorization({ app, shell: { openExternal: async url => opened.push(url) }, ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
    assertSender: event => event.trusted ? null : { error: "denied" }, getConnection: () => ({ baseUrl: "http://127.0.0.1:57892", token: "local-secret" }), focus: () => {}, fetchImpl });
  assert.equal((await handlers.get("sync:browser-authorize")({ trusted: false }, "https://nas.example.com")).error, "denied");
  assert.equal(requests.length, 0);
  await handlers.get("sync:browser-authorize")({ trusted: true }, "https://nas.example.com");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].includes("local-secret"), false);
  await bridge.handleCallback(callback);
  assert.match(requests.at(-1).url, /^http:\/\/127\.0\.0\.1:57892\/api\/sync\/local/);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { code, state });
  assert.equal(await bridge.handleCallback("https://attacker.test"), false);
});

test("certificate trust requires an explicit native confirmation and stays on the selected NAS", async () => {
  for (const accepted of [false, true]) {
    const app = new EventEmitter(), handlers = new Map(), routes = [];
    let starts = 0;
    const certificate = { origin: "https://nas.example.com", fingerprint: "AB:".repeat(31) + "AB" };
    registerBrowserAuthorization({ app, shell: { openExternal: async () => {} }, ipcMain: { handle: (key, handler) => handlers.set(key, handler) }, assertSender: () => null,
      getConnection: () => ({ baseUrl: "http://127.0.0.1:57892", token: "local" }), focus: () => {},
      confirmCertificate: async cert => { assert.equal(cert.origin, certificate.origin); return accepted; },
      fetchImpl: async (url, init) => {
        const route = url.split("/").at(-1); routes.push(route);
        if (route === "start" && starts++ === 0) return { ok: false, json: async () => ({ code: "NAS_CERTIFICATE_UNTRUSTED", certificate }) };
        if (route === "trust") { assert.equal(JSON.parse(init.body).fingerprint, certificate.fingerprint); return { ok: true, json: async () => ({ ok: true }) }; }
        return { ok: true, json: async () => ({ requestId: "approved", authorizationUrl: "https://nas.example.com/app/nowen-note-private/client-authorize" }) };
      },
    });
    const result = await handlers.get("sync:browser-authorize")({}, "https://nas.example.com");
    assert.deepEqual(routes, accepted ? ["start", "trust", "start"] : ["start"]);
    assert.equal(Boolean(result.requestId), accepted);
  }
});
