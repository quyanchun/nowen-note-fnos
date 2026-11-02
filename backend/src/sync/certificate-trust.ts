import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import https from "node:https";
import { Agent, fetch as undiciFetch } from "undici";

const agents = new Map<string, Agent>();
const fingerprint = (value: string) => value.replaceAll(":", "").toUpperCase();
const file = () => path.join(process.env.ELECTRON_USER_DATA || path.join(process.cwd(), "data"), ".sync_certificate_trust.json");
function readTrust(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(file(), "utf8")); } catch { return {}; }
}
export function trustNasCertificate(origin: string, value: string) {
  const url = new URL(origin);
  const pin = fingerprint(value);
  if (url.protocol !== "https:" || url.origin !== origin || !/^[A-F0-9]{64}$/.test(pin)) throw new Error("Invalid NAS certificate");
  const values = { ...readTrust(), [origin]: pin };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file() + ".tmp", JSON.stringify(values), { mode: 0o600 });
  fs.renameSync(file() + ".tmp", file());
}
export function certificateMatchesPin(cert: Pick<tls.PeerCertificate, "fingerprint256">, approved: string): boolean {
  return /^[A-F0-9]{64}$/.test(approved) && fingerprint(cert.fingerprint256 || "") === approved;
}
export function inspectNasCertificate(origin: string): Promise<{ origin: string; fingerprint: string; subject: string; issuer: string; validTo: string }> {
  const url = new URL(origin);
  if (url.protocol !== "https:") throw new Error("HTTPS is required");
  return new Promise((resolve, reject) => {
    // Inspection sends no HTTP request or credentials. Only the user may approve its fingerprint.
    const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert.fingerprint256) { reject(new Error("Missing NAS certificate")); return; }
      resolve({ origin: url.origin, fingerprint: cert.fingerprint256, subject: String(cert.subject?.CN || ""), issuer: String(cert.issuer?.CN || ""), validTo: cert.valid_to });
    });
    socket.setTimeout(8000, () => socket.destroy(new Error("TLS timeout")));
    socket.on("error", reject);
  });
}
export function isCertificateFailure(error: unknown): boolean {
  const codes = new Set(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED"]);
  let current = error as any;
  for (let i = 0; current && i < 4; i++, current = current.cause) if (codes.has(current.code)) return true;
  return false;
}

/** Trust is confined to this exact origin AND certificate; normal valid TLS always works. */
export const fetchSyncRemote: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const pin = readTrust()[url.origin];
  if (url.protocol !== "https:" || !/^[A-F0-9]{64}$/.test(pin || "")) return fetch(input, { ...init, redirect: "error" });
  const key = `${url.origin}|${pin}`;
  let agent = agents.get(key);
  if (!agent) {
    agent = new Agent({ connect(options, callback) {
      let settled = false;
      const done = (error: Error | null, socket: tls.TLSSocket | null) => {
        if (settled) return;
        settled = true;
        if (error) callback(error, null);
        else if (socket) callback(null, socket);
      };
      const socket = tls.connect({ host: options.hostname, port: Number(options.port || 443), servername: options.servername || options.hostname, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] }, () => {
        const cert = socket.getPeerCertificate();
        const valid = socket.authorized && !tls.checkServerIdentity(options.hostname, cert);
        if (valid || certificateMatchesPin(cert, pin)) done(null, socket);
        else { const error = Object.assign(new Error("NAS certificate changed; approval required"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }); done(error, null); socket.destroy(); }
      });
      socket.setTimeout(10_000, () => socket.destroy(new Error("TLS timeout")));
      socket.on("error", error => done(error, null));
    } });
    agents.set(key, agent);
  }
  return undiciFetch(input as any, { ...init, redirect: "error", dispatcher: agent } as any) as unknown as Promise<Response>;
};

/** ws uses Node's HTTPS agent; release a socket only after certificate validation. */
export function syncWebSocketAgent(origin: string): https.Agent | undefined {
  const pin = readTrust()[origin];
  if (!/^[A-F0-9]{64}$/.test(pin || "")) return undefined;
  const url = new URL(origin);
  const agent = new https.Agent();
  agent.createConnection = ((_options: unknown, callback: (error: Error | null, socket?: tls.TLSSocket) => void) => {
    let settled = false;
    const done = (error: Error | null, socket?: tls.TLSSocket) => { if (!settled) { settled = true; callback(error, socket); } };
    const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] }, () => {
      const cert = socket.getPeerCertificate();
      if ((socket.authorized && !tls.checkServerIdentity(url.hostname, cert)) || certificateMatchesPin(cert, pin)) done(null, socket);
      else { done(new Error("NAS certificate changed")); socket.destroy(); }
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error("TLS timeout")));
    socket.on("error", error => done(error));
    return undefined;
  }) as typeof agent.createConnection;
  return agent;
}
