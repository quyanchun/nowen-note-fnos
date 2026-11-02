import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("standard backend entry installs task statistics routes", () => {
  const source = readFileSync("src/index.ts", "utf8");

  assert.match(source, /import "\.\/runtime\/task-stats-hardening"/);
});

test("recent reminders route is registered before the task reminder parameter route", () => {
  const source = readFileSync("src/index.ts", "utf8");
  const recentRoute = source.indexOf('app.get("/api/task-reminders/recent"');
  const reminderRouter = source.indexOf('app.route("/api/task-reminders", taskRemindersRouter)');

  assert.ok(recentRoute >= 0);
  assert.ok(reminderRouter >= 0);
  assert.ok(recentRoute < reminderRouter);
});
