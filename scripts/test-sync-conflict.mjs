#!/usr/bin/env node
/**
 * Backend HTTP smoke test for note optimistic-lock conflicts.
 *
 * It starts the built backend against a temporary SQLite DB, creates a first
 * admin user, creates one note, then simulates two clients saving from the same
 * base version. The second stale save must return 409 and must not overwrite
 * the first save.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (child.exitCode !== null) throw new Error(`backend exited early with ${child.exitCode}`);
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      /* keep waiting */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("backend did not become healthy in time");
}

async function request(baseUrl, pathName, options = {}) {
  const res = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { res, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractText(content) {
  if (typeof content !== "string") return "";
  return content;
}

async function main() {
  const dist = path.join(repoRoot, "backend", "dist", "index.js");
  if (!fs.existsSync(dist)) {
    throw new Error("backend/dist/index.js not found. Run npm run build:backend first.");
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-sync-conflict-"));
  const dbPath = path.join(root, "nowen-note.db");
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [dist], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      JWT_SECRET: "sync-conflict-test-secret",
      DISABLE_MDNS: "1",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (b) => { output += b.toString(); });
  child.stderr.on("data", (b) => { output += b.toString(); });

  try {
    await waitForHealth(baseUrl, child);

    const registered = await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: {
        username: `sync_${Date.now().toString(36)}`,
        password: "admin123",
        email: `sync_${Date.now().toString(36)}@example.test`,
      },
    });
    assert(registered.res.status === 201, `register failed: ${registered.res.status} ${JSON.stringify(registered.data)}`);
    const token = registered.data.token;
    assert(token, "register did not return token");

    const notebook = await request(baseUrl, "/api/notebooks", {
      method: "POST",
      token,
      body: { name: "sync-conflict" },
    });
    assert(notebook.res.status === 201 || notebook.res.status === 200, `create notebook failed: ${notebook.res.status} ${JSON.stringify(notebook.data)}`);
    const notebookId = notebook.data.id;
    assert(notebookId, "create notebook did not return id");

    const created = await request(baseUrl, "/api/notes", {
      method: "POST",
      token,
      body: { notebookId, title: "base", content: "{\"type\":\"doc\",\"content\":[]}", contentText: "base" },
    });
    assert(created.res.status === 201 || created.res.status === 200, `create note failed: ${created.res.status} ${JSON.stringify(created.data)}`);
    const noteId = created.data.id;
    const baseVersion = created.data.version;
    assert(noteId && typeof baseVersion === "number", "create note did not return id/version");

    const firstSave = await request(baseUrl, `/api/notes/${noteId}`, {
      method: "PUT",
      token,
      body: { title: "client-a", content: "client-a-content", contentText: "client-a", version: baseVersion },
    });
    assert(firstSave.res.ok, `first save failed: ${firstSave.res.status} ${JSON.stringify(firstSave.data)}`);
    assert(firstSave.data.version === baseVersion + 1, `first save should increment version to ${baseVersion + 1}`);

    const staleSave = await request(baseUrl, `/api/notes/${noteId}`, {
      method: "PUT",
      token,
      body: { title: "client-b", content: "client-b-content", contentText: "client-b", version: baseVersion },
    });
    assert(staleSave.res.status === 409, `stale save should 409, got ${staleSave.res.status} ${JSON.stringify(staleSave.data)}`);
    assert(staleSave.data?.code === "VERSION_CONFLICT", "stale save should return VERSION_CONFLICT");
    assert(staleSave.data?.currentVersion === baseVersion + 1, "stale save should return currentVersion");

    const latest = await request(baseUrl, `/api/notes/${noteId}`, { method: "GET", token });
    assert(latest.res.ok, `get latest failed: ${latest.res.status} ${JSON.stringify(latest.data)}`);
    assert(latest.data.title === "client-a", "stale save overwrote the first title");
    assert(extractText(latest.data.content) === "client-a-content", "stale save overwrote the first content");
    assert(latest.data.version === baseVersion + 1, "version changed after rejected stale save");

    console.log("[sync-conflict-test] ok");
    console.log(`[sync-conflict-test] temp=${root}`);
  } finally {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    if (process.env.DEBUG_SYNC_CONFLICT_TEST === "1") {
      console.log(output);
    }
  }
}

main().catch((err) => {
  console.error(`[sync-conflict-test] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
