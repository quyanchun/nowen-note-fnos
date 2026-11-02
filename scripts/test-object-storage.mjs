#!/usr/bin/env node
/**
 * End-to-end smoke test for the S3-compatible attachment migration path.
 *
 * It starts a tiny local S3-like HTTP server, creates a temporary Nowen Note
 * SQLite database plus local attachment files, then runs the migration script
 * in dry-run and apply modes. This verifies the same signed HTTP HEAD/PUT
 * path used for R2/S3/MinIO without requiring Docker or real cloud credentials.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

function requireBetterSqlite3() {
  const req = createRequire(`file:///${path.join(repoRoot, "backend", "package.json").replace(/\\/g, "/")}`);
  return req("better-sqlite3");
}

function createMockS3() {
  const objects = new Map();
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const url = new URL(req.url || "/", "http://localhost");
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    requests.push({ method: req.method, key, auth: req.headers.authorization || "" });

    if (!String(req.headers.authorization || "").includes("AWS4-HMAC-SHA256")) {
      res.writeHead(403);
      res.end("missing signature");
      return;
    }

    if (req.method === "HEAD") {
      res.writeHead(objects.has(key) ? 200 : 404);
      res.end();
      return;
    }
    if (req.method === "PUT") {
      objects.set(key, body);
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === "GET") {
      const data = objects.get(key);
      if (!data) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200);
      res.end(data);
      return;
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        endpoint: `http://127.0.0.1:${address.port}`,
        objects,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function createTempFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-object-storage-"));
  const dbPath = path.join(root, "nowen-note.db");
  const attachmentsDir = path.join(root, "attachments");
  fs.mkdirSync(attachmentsDir, { recursive: true });

  const files = {
    "note-one.txt": Buffer.from("note attachment one"),
    "diary-one.txt": Buffer.from("diary attachment one"),
    "task-one.txt": Buffer.from("task attachment one"),
  };
  for (const [name, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(attachmentsDir, name), data);
  }

  const Database = requireBetterSqlite3();
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE attachments (path TEXT, mimeType TEXT, size INTEGER);
    CREATE TABLE diary_attachments (path TEXT, mimeType TEXT, size INTEGER);
    CREATE TABLE task_attachments (path TEXT, mimeType TEXT, size INTEGER);
  `);
  db.prepare("INSERT INTO attachments (path, mimeType, size) VALUES (?, ?, ?)").run("note-one.txt", "text/plain", files["note-one.txt"].length);
  db.prepare("INSERT INTO diary_attachments (path, mimeType, size) VALUES (?, ?, ?)").run("diary-one.txt", "text/plain", files["diary-one.txt"].length);
  db.prepare("INSERT INTO task_attachments (path, mimeType, size) VALUES (?, ?, ?)").run("task-one.txt", "text/plain", files["task-one.txt"].length);
  db.close();

  return { root, dbPath, attachmentsDir, files };
}

async function runMigration(args, env) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [path.join(repoRoot, "scripts", "migrate-attachments-to-object-storage.mjs"), ...args],
    {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      maxBuffer: 1024 * 1024 * 5,
    },
  );
  return `${stdout}${stderr}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const mock = await createMockS3();
  const fixture = createTempFixture();
  const env = {
    ATTACHMENT_STORAGE: "s3",
    S3_ENDPOINT: mock.endpoint,
    S3_REGION: "auto",
    S3_BUCKET: "nowen-test",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
    S3_PREFIX: "attachments",
  };

  try {
    const baseArgs = ["--db", fixture.dbPath, "--attachments-dir", fixture.attachmentsDir, "--verbose"];
    const dryRun = await runMigration(["--dry-run", ...baseArgs], env);
    assert(dryRun.includes("needUpload: 3"), "dry-run should find three uploads");
    assert(mock.objects.size === 0, "dry-run must not upload objects");

    const apply = await runMigration(["--apply", ...baseArgs], env);
    assert(apply.includes("uploaded: 3"), "apply should upload three objects");
    assert(mock.objects.size === 3, "mock bucket should contain three objects");

    for (const [name, data] of Object.entries(fixture.files)) {
      const key = `nowen-test/attachments/${name}`;
      assert(mock.objects.has(key), `missing uploaded object ${key}`);
      assert(Buffer.compare(mock.objects.get(key), data) === 0, `object bytes mismatch for ${key}`);
    }

    const verify = await runMigration(["--dry-run", "--include-existing", ...baseArgs], env);
    assert(verify.includes("alreadyRemote: 3"), "second dry-run should see remote objects");
    assert(mock.requests.some((r) => r.method === "HEAD"), "migration should issue HEAD requests");
    assert(mock.requests.some((r) => r.method === "PUT"), "migration should issue PUT requests");
    assert(mock.requests.every((r) => r.auth.includes("AWS4-HMAC-SHA256")), "all mock S3 requests should be signed");

    console.log("[object-storage-test] ok");
    console.log(`[object-storage-test] temp=${fixture.root}`);
  } finally {
    await mock.close();
  }
}

main().catch((err) => {
  console.error(`[object-storage-test] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
