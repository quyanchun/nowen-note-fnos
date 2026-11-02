import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Hono } from "hono";
import type Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-settings-icp-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.ELECTRON_USER_DATA = tmpDir;
process.env.NOWEN_ICP_BEIAN = "粤ICP备12345678号-1";

let app: Hono;
let getDb: () => Database.Database;
let closeDb: () => void;
let seedDatabase: () => void;

function db() {
  return getDb();
}

async function requestJson(method: string, url: string, body?: unknown, userId?: string) {
  const res = await app.request(url, {
    method,
    headers: {
      ...(userId ? { "X-User-Id": userId } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() as any };
}

test.before(async () => {
  const [settingsModule, schemaModule, seedModule] = await Promise.all([
    import("../src/routes/settings"),
    import("../src/db/schema"),
    import("../src/db/seed"),
  ]);
  app = new Hono();
  app.route("/settings", settingsModule.default);
  getDb = schemaModule.getDb;
  closeDb = schemaModule.closeDb;
  seedDatabase = seedModule.seedDatabase;
});

test.beforeEach(() => {
  db().prepare("DELETE FROM system_settings").run();
  db().prepare("DELETE FROM users").run();
});

test.after(async () => {
  closeDb();
  delete process.env.NOWEN_ICP_BEIAN;
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return;
    } catch (err: any) {
      if (err?.code !== "EBUSY") throw err;
      if (i === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
});

test("Docker env NOWEN_ICP_BEIAN is synced into public settings", async () => {
  seedDatabase();

  const get = await requestJson("GET", "/settings");
  assert.equal(get.status, 200);
  assert.equal(get.json.site_icp_beian, "粤ICP备12345678号-1");
});

test("API writes to site_icp_beian are ignored; env remains the source", async () => {
  seedDatabase();

  const put = await requestJson("PUT", "/settings", { site_icp_beian: "粤ICP备99999999号-9" });
  assert.equal(put.status, 200);
  assert.equal(put.json.site_icp_beian, "粤ICP备12345678号-1");

  const row = db().prepare("SELECT value FROM system_settings WHERE key = 'site_icp_beian'").get() as { value: string };
  assert.equal(row.value, "粤ICP备12345678号-1");
});
