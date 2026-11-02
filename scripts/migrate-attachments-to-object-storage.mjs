#!/usr/bin/env node
/**
 * Migrate local attachment files to S3-compatible object storage.
 *
 * Usage:
 *   node scripts/migrate-attachments-to-object-storage.mjs --dry-run
 *   node scripts/migrate-attachments-to-object-storage.mjs --apply
 *
 * Config:
 *   By default the script reads the object storage config saved in
 *   Settings -> Data Management. A complete env config below overrides it.
 *
 * Env override:
 *   ATTACHMENT_STORAGE=s3
 *   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
 *   S3_REGION=auto
 *   S3_BUCKET=nowen-note
 *   S3_ACCESS_KEY_ID=...
 *   S3_SECRET_ACCESS_KEY=...
 *   S3_PREFIX=attachments
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const SETTING_KEY = "attachmentStorage:config";

function parseArgs(argv) {
  const out = {
    dryRun: true,
    db: "",
    attachmentsDir: "",
    limit: 0,
    verbose: false,
    includeExisting: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.dryRun = false;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--db") out.db = argv[++i] || "";
    else if (a === "--attachments-dir") out.attachmentsDir = argv[++i] || "";
    else if (a === "--limit") out.limit = Number(argv[++i] || 0) || 0;
    else if (a === "--verbose") out.verbose = true;
    else if (a === "--include-existing") out.includeExisting = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node scripts/migrate-attachments-to-object-storage.mjs [--dry-run|--apply]
       [--db <path>] [--attachments-dir <path>] [--limit N]
       [--verbose] [--include-existing]

Options:
  --dry-run           Scan only. This is the default.
  --apply             Upload local files missing from the object bucket.
  --db                SQLite DB path. Defaults to DB_PATH or data/nowen-note.db.
  --attachments-dir   Local attachment directory. Defaults to data/attachments.
  --limit             Process at most N unique attachment paths.
  --verbose           Print every changed or problematic path.
  --include-existing  Also print paths that already exist remotely.

Config:
  Uses a complete env config first. If env is not configured, reads the
  Settings -> Data Management object storage config from the SQLite DB.
  If that config has an encrypted secret, run with the same JWT_SECRET used
  by the backend that saved it.`);
}

function requireBetterSqlite3() {
  const anchors = [
    path.join(repoRoot, "backend", "package.json"),
    path.join(repoRoot, "package.json"),
    import.meta.url,
  ];
  for (const anchor of anchors) {
    try {
      const req = createRequire(anchor.startsWith("file:") ? anchor : `file:///${anchor.replace(/\\/g, "/")}`);
      return req("better-sqlite3");
    } catch {
      /* try next */
    }
  }
  throw new Error("Cannot resolve better-sqlite3. Run npm install first.");
}

function env(name) {
  return (process.env[name] || "").trim();
}

function deriveCipherKey() {
  const secret = process.env.JWT_SECRET || "nowen-note-default-secret";
  return crypto.scryptSync(secret, "nowen-attachment-storage-v1", 32);
}

function decryptSecret(encoded) {
  if (!encoded || !encoded.startsWith("v1:")) return "";
  try {
    const [, ivB64, tagB64, dataB64] = encoded.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveCipherKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return "";
  }
}

function resolveDbPath(cliPath) {
  if (cliPath) return path.resolve(cliPath);
  if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH);
  const base = process.env.ELECTRON_USER_DATA || path.join(process.cwd(), "data");
  return path.resolve(base, "nowen-note.db");
}

function resolveAttachmentsDir(cliPath) {
  if (cliPath) return path.resolve(cliPath);
  const base = process.env.ELECTRON_USER_DATA || path.join(process.cwd(), "data");
  return path.resolve(base, "attachments");
}

function getEnvS3Config() {
  const storage = env("ATTACHMENT_STORAGE").toLowerCase();
  if (storage !== "s3" && storage !== "r2" && storage !== "minio") {
    return null;
  }
  const cfg = {
    source: "env",
    endpoint: env("S3_ENDPOINT").replace(/\/+$/, ""),
    region: env("S3_REGION") || "auto",
    bucket: env("S3_BUCKET"),
    accessKeyId: env("S3_ACCESS_KEY_ID"),
    secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
    prefix: env("S3_PREFIX").replace(/^\/+|\/+$/g, ""),
  };
  const missing = Object.entries(cfg)
    .filter(([k, v]) => k !== "prefix" && !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`Missing S3 config: ${missing.join(", ")}`);
  return cfg;
}

function readDbS3Config(db) {
  if (!tableExists(db, "system_settings")) return null;
  const row = db
    .prepare("SELECT value, updatedAt FROM system_settings WHERE key = ?")
    .get(SETTING_KEY);
  if (!row) return null;

  const parsed = JSON.parse(row.value || "{}");
  if (parsed.enabled !== true) {
    throw new Error("Saved object storage config is disabled. Enable it in Settings or provide env config.");
  }

  const cfg = {
    source: "settings",
    endpoint: String(parsed.endpoint || "").trim().replace(/\/+$/, ""),
    region: String(parsed.region || "auto").trim() || "auto",
    bucket: String(parsed.bucket || "").trim(),
    accessKeyId: String(parsed.accessKeyId || "").trim(),
    secretAccessKey: decryptSecret(String(parsed.secretAccessKeyEnc || "")),
    prefix: String(parsed.prefix || "").trim().replace(/^\/+|\/+$/g, ""),
    updatedAt: row.updatedAt || null,
  };
  const missing = Object.entries(cfg)
    .filter(([k, v]) => !["prefix", "updatedAt"].includes(k) && !v)
    .map(([k]) => k);
  if (missing.length) {
    const extra = missing.includes("secretAccessKey")
      ? " If the secret is saved in the UI, run this script with the same JWT_SECRET as the backend."
      : "";
    throw new Error(`Saved object storage config is incomplete: ${missing.join(", ")}.${extra}`);
  }
  return cfg;
}

function getS3Config(db) {
  const envCfg = getEnvS3Config();
  if (envCfg) return envCfg;

  const dbCfg = readDbS3Config(db);
  if (dbCfg) return dbCfg;

  throw new Error(
    "Object storage is not configured. Save it in Settings -> Data Management, or set ATTACHMENT_STORAGE=s3/r2/minio with S3_* env vars.",
  );
}

function encodePathSegment(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function objectKey(relPath, cfg) {
  const clean = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const key = cfg.prefix ? `${cfg.prefix}/${clean}` : clean;
  return key.split("/").filter(Boolean).map(encodePathSegment).join("/");
}

function objectUrl(relPath, cfg) {
  return new URL(`${cfg.endpoint}/${encodePathSegment(cfg.bucket)}/${objectKey(relPath, cfg)}`);
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function amzDate(date) {
  return `${yyyymmdd(date)}T${date.toISOString().slice(11, 19).replace(/:/g, "")}Z`;
}

function signingKey(secret, date, region) {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

async function signedFetch(method, relPath, cfg, body, contentType) {
  const url = objectUrl(relPath, cfg);
  const now = new Date();
  const date = yyyymmdd(now);
  const payloadHash = body ? sha256Hex(body) : sha256Hex("");
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate(now),
  };
  if (contentType) headers["content-type"] = contentType;
  const sorted = Object.keys(headers).sort();
  const canonicalHeaders = sorted.map((k) => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = sorted.join(";");
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    headers["x-amz-date"],
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = crypto
    .createHmac("sha256", signingKey(cfg.secretAccessKey, date, cfg.region))
    .update(stringToSign)
    .digest("hex");
  return fetch(url, {
    method,
    headers: {
      ...headers,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
}

async function objectExists(relPath, cfg) {
  const res = await signedFetch("HEAD", relPath, cfg);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`HEAD ${relPath} failed: ${res.status} ${res.statusText}`);
  return true;
}

async function uploadObject(relPath, absPath, mimeType, cfg) {
  const body = fs.readFileSync(absPath);
  const res = await signedFetch("PUT", relPath, cfg, body, mimeType || "application/octet-stream");
  if (!res.ok) {
    throw new Error(`PUT ${relPath} failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

function tableExists(db, table) {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return !!row;
}

function collectAttachmentRows(db) {
  const rows = [];
  if (tableExists(db, "attachments")) {
    rows.push(...db.prepare("SELECT path, mimeType, size, 'attachments' AS source FROM attachments WHERE path IS NOT NULL AND path <> ''").all());
  }
  if (tableExists(db, "diary_attachments")) {
    rows.push(...db.prepare("SELECT path, mimeType, size, 'diary_attachments' AS source FROM diary_attachments WHERE path IS NOT NULL AND path <> ''").all());
  }
  if (tableExists(db, "task_attachments")) {
    rows.push(...db.prepare("SELECT path, mimeType, size, 'task_attachments' AS source FROM task_attachments WHERE path IS NOT NULL AND path <> ''").all());
  }
  const byPath = new Map();
  for (const row of rows) {
    const rel = String(row.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel || rel.includes("..") || path.basename(rel) !== rel) continue;
    const cur = byPath.get(rel);
    if (!cur) {
      byPath.set(rel, {
        path: rel,
        mimeType: row.mimeType || "application/octet-stream",
        size: Number(row.size || 0),
        sources: new Set([row.source]),
      });
    } else {
      cur.sources.add(row.source);
      if (!cur.mimeType && row.mimeType) cur.mimeType = row.mimeType;
    }
  }
  return [...byPath.values()].map((x) => ({ ...x, sources: [...x.sources] }));
}

async function main() {
  const args = parseArgs(process.argv);
  const dbPath = resolveDbPath(args.db);
  const attachmentsDir = resolveAttachmentsDir(args.attachmentsDir);
  if (!fs.existsSync(dbPath)) throw new Error(`DB not found: ${dbPath}`);
  if (!fs.existsSync(attachmentsDir)) throw new Error(`attachments dir not found: ${attachmentsDir}`);

  const Database = requireBetterSqlite3();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const cfg = getS3Config(db);
  const allRows = collectAttachmentRows(db);
  db.close();
  const rows = args.limit > 0 ? allRows.slice(0, args.limit) : allRows;

  const summary = {
    scanned: rows.length,
    alreadyRemote: 0,
    needUpload: 0,
    uploaded: 0,
    localMissing: 0,
    failed: 0,
  };

  console.log(`[object-storage] mode=${args.dryRun ? "dry-run" : "apply"}`);
  console.log(`[object-storage] db=${dbPath}`);
  console.log(`[object-storage] attachments=${attachmentsDir}`);
  console.log(`[object-storage] config=${cfg.source}${cfg.updatedAt ? ` updatedAt=${cfg.updatedAt}` : ""}`);
  console.log(`[object-storage] bucket=${cfg.bucket} endpoint=${cfg.endpoint} prefix=${cfg.prefix || "(none)"}`);

  for (const row of rows) {
    const abs = path.join(attachmentsDir, row.path);
    if (!fs.existsSync(abs)) {
      summary.localMissing++;
      if (args.verbose) console.log(`[missing-local] ${row.path}`);
      continue;
    }
    try {
      const exists = await objectExists(row.path, cfg);
      if (exists) {
        summary.alreadyRemote++;
        if (args.includeExisting) console.log(`[remote-ok] ${row.path}`);
        continue;
      }
      summary.needUpload++;
      if (args.dryRun) {
        if (args.verbose) console.log(`[would-upload] ${row.path}`);
        continue;
      }
      await uploadObject(row.path, abs, row.mimeType, cfg);
      summary.uploaded++;
      if (args.verbose) console.log(`[uploaded] ${row.path}`);
    } catch (err) {
      summary.failed++;
      console.warn(`[failed] ${row.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("[object-storage] summary:");
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k}: ${v}`);
  }
  if (summary.failed > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(`[object-storage] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
