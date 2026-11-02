import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-browser-flow-"));
process.env.ELECTRON_USER_DATA = dir;
test("browser callbacks cannot cross local accounts, replay or activate a cancelled request (DCC-006)", async () => {
  const { beginBrowserAuthorization, finishBrowserAuthorization, cancelBrowserAuthorization, browserAuthorizationStatus } = await import("../src/sync/browser-auth");
  const original = globalThis.fetch;
  let pendingResponse: ((response: Response) => void) | undefined;
  let capturedVerifier = "";
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    assert.equal(init.redirect, "error", "credentials must not follow redirects");
    if (url.endsWith("/health")) return Response.json({ service: "nowen-note-device", protocol: 1 });
    capturedVerifier = JSON.parse(init.body as string).verifier;
    return new Promise<Response>(resolve => { pendingResponse = resolve; });
  }) as typeof fetch;
  const result = () => Response.json({ token: "nnd_" + "t".repeat(43), user: { id: "nas-user-1000" } });
  let activated = 0;
  const activate = (serverUrl: string, _token: string, userId: string) => {
    activated++; assert.equal(serverUrl, "https://nas.example.com/nowen-note-device"); assert.equal(userId, "nas-user-1000"); return { bootstrapRequired: true };
  };
  try {
    const started = await beginBrowserAuthorization("local-a", "https://nas.example.com/app/nowen-note-private/", "Test Mac");
    const url = new URL(started.authorizationUrl);
    const callback = { state: url.searchParams.get("state")!, code: "c".repeat(43) };
    await assert.rejects(finishBrowserAuthorization("local-b", callback, activate));
    assert.equal(activated, 0);
    const finishing = finishBrowserAuthorization("local-a", callback, activate);
    assert.equal(createHash("sha256").update(capturedVerifier).digest("base64url"), url.searchParams.get("challenge"));
    pendingResponse!(result()); await finishing;
    assert.equal(activated, 1);
    assert.equal(browserAuthorizationStatus("local-a", started.requestId).status, "connected");
    await assert.rejects(finishBrowserAuthorization("local-a", callback, activate));
    const next = await beginBrowserAuthorization("local-a", "https://nas.example.com", "Test Mac");
    const late = finishBrowserAuthorization("local-a", { state: new URL(next.authorizationUrl).searchParams.get("state")!, code: "d".repeat(43) }, activate);
    cancelBrowserAuthorization("local-a", next.requestId);
    pendingResponse!(result()); await assert.rejects(late);
    assert.equal(activated, 1, "late callbacks cannot activate a profile after cancellation");
  } finally { globalThis.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); }
});
