import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-desktop-gateway-"));
process.env.DB_PATH = path.join(dir, "test.db");
process.env.JWT_SECRET = "clipboard-desktop-isolated-secret";
test("clipboard capability remains bound to its NAS identity and narrow routes (DCC-006)", async () => {
  const { getFnosAccount } = await import("../src/lib/fnos-identity.js");
  const { clipboardSettingsSchema, saveClipboardSettings, copyClipboardToken, revokeClipboardToken } = await import("../src/services/clipboard-integration.js");
  const { dispatchFnosGateway, FNOS_PREFIX } = await import("../src/services/fnos-gateway.js");
  const { clipboardPublicRouter } = await import("../src/routes/clipboard.js");
  const { closeDb } = await import("../src/db/schema.js");
  const owner = getFnosAccount({ uid: "4401", username: "clip-owner", isAdmin: false });
  saveClipboardSettings(owner.id, clipboardSettingsSchema.parse({ enabled: true }));
  const token = copyClipboardToken(owner.id).token;
  const app = new Hono(); app.route("/api/clipboard", clipboardPublicRouter);
  const call = (suffix: string, uid = "4401", method = "GET", raw = token) => dispatchFnosGateway(new Request(`https://nas.test${FNOS_PREFIX}${suffix}`, {
    method, headers: { "X-Trim-Userid": uid, "X-Trim-Username": "fixture", "X-Trim-Isadmin": "false", Authorization: `Bearer ${raw}` },
  }), app);
  assert.equal((await call("/api/clipboard/policy")).status, 200);
  assert.equal((await call("/api/clipboard/policy", "4402")).status, 401);
  for (const route of ["/api/notes", "/api/auth/verify", "/api/clipboard-settings", "/api/clipboard/captures/abc/extra"]) {
    assert.equal((await call(route)).status, 401, route);
  }
  assert.equal((await call("/api/clipboard/policy", "4401", "DELETE")).status, 401);
  assert.equal((await call("/api/clipboard/policy", "4401", "GET", "ncc_invalid")).status, 401);
  revokeClipboardToken(owner.id);
  assert.equal((await call("/api/clipboard/policy")).status, 401);
  closeDb();
});
