import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-certificate-test-"));
process.env.ELECTRON_USER_DATA = dir;
function certificate(name: string) {
  const key = path.join(dir, `${name}.key`), cert = path.join(dir, `${name}.crt`);
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", `/CN=${name}`, ...(name === "public-endpoint" ? ["-addext", "subjectAltName=IP:127.0.0.1"] : [])], { stdio: "ignore" });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}
async function listen(material: ReturnType<typeof certificate>, port = 0) {
  const server = https.createServer(material, (_req, res) => { res.setHeader("Connection", "close"); res.end("synthetic NAS"); });
  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
  return server;
}
async function close(server: https.Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }

test("a NAS certificate exception is pinned to one origin and fingerprint; changed certificates fail closed", async () => {
  const { fetchSyncRemote, inspectNasCertificate, trustNasCertificate } = await import("../src/sync/certificate-trust");
  const material = certificate("synthetic-fnos");
  let server = await listen(material);
  const port = (server.address() as any).port;
  const origin = `https://127.0.0.1:${port}`;
  try {
    await assert.rejects(fetchSyncRemote(origin), "unapproved self-signed certificate must fail");
    const info = await inspectNasCertificate(origin);
    trustNasCertificate(origin, info.fingerprint);
    assert.equal(await (await fetchSyncRemote(origin)).text(), "synthetic NAS");
    const other = await listen(material);
    try { await assert.rejects(fetchSyncRemote(`https://127.0.0.1:${(other.address() as any).port}`), "trust cannot leak to another origin"); }
    finally { await close(other); }
    await close(server);
    server = await listen(certificate("changed-fnos"), port);
    await assert.rejects(fetchSyncRemote(origin), "a different certificate requires a new confirmation");
    await close(server);
    server = await listen(certificate("public-endpoint"), port);
    // Model the user's outside network: the same origin now has a normally trusted certificate.
    // The test-only CA is scoped to this child process, never the user's OS or application.
    const child = spawn(process.execPath, ["--import", "tsx", "-e", `require('./src/sync/certificate-trust.ts').fetchSyncRemote(${JSON.stringify(origin)}).then(async r => { if (await r.text() !== 'synthetic NAS') process.exitCode=1; }).catch(() => { process.exitCode=1; });`], {
      cwd: path.resolve(__dirname, ".."), env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(dir, "public-endpoint.crt") }, stdio: "ignore",
    });
    const exit = await new Promise<number | null>((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
    assert.equal(exit, 0, "a valid certificate at the same origin works outside despite a different LAN pin");
    assert.equal(fs.statSync(path.join(dir, ".sync_certificate_trust.json")).mode & 0o777, 0o600);
  } finally { await close(server); fs.rmSync(dir, { recursive: true, force: true }); }
});
