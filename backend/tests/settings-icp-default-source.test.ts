import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

test("public /api/settings default response includes site_icp_beian", () => {
  const source = readFileSync(path.resolve("src/index.ts"), "utf8");
  const routeStart = source.indexOf('app.get("/api/settings"');
  const routeEnd = source.indexOf('app.get("/api/fonts"', routeStart);

  assert.ok(routeStart >= 0, "public settings route should exist");
  assert.ok(routeEnd > routeStart, "public settings route should be bounded before fonts route");

  const routeSource = source.slice(routeStart, routeEnd);
  assert.match(routeSource, /site_icp_beian\s*:\s*""/);
});

test("public /api/settings response disables cache", () => {
  const source = readFileSync(path.resolve("src/index.ts"), "utf8");
  const routeStart = source.indexOf('app.get("/api/settings"');
  const routeEnd = source.indexOf('app.get("/api/fonts"', routeStart);

  assert.ok(routeStart >= 0, "public settings route should exist");
  assert.ok(routeEnd > routeStart, "public settings route should be bounded before fonts route");

  const routeSource = source.slice(routeStart, routeEnd);
  assert.match(routeSource, /Cache-Control["']?\s*,\s*["']no-store["']/);
});

test("ICP filing is sourced from docker env during startup seed", () => {
  const source = readFileSync(path.resolve("src/db/seed.ts"), "utf8");
  assert.match(source, /NOWEN_ICP_BEIAN/);
  assert.match(source, /site_icp_beian/);
});
