// 体验账号 seed 脚本（一次性 / 幂等）
// ----------------------------------------------------------------------------
// 用法：
//   node scripts/seed-demo.mjs                  # 默认 demo / demo123456
//   DEMO_USER=foo DEMO_PASS=bar123 node scripts/seed-demo.mjs
//
// 行为：
//   1. 打开后端实际使用的 SQLite 文件（与 src/db/schema.ts 中 DB_PATH 同逻辑）。
//   2. 若 users 表里已存在该用户名 → 仅 UPDATE isDemo=1（不动密码，避免覆盖你手改过的口令）。
//   3. 不存在 → 直接 INSERT 一条 role='user', isDemo=1 的新记录，bcrypt(10) 哈希密码。
//
// 之所以不直接复用 routes/auth.ts 的注册逻辑，是因为那条链路绑了 Hono context、
// session、audit log 等运行时依赖，单跑脚本太重；这里就走最小路径。

import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 与 backend/src/db/schema.ts 保持一致的路径解析
const DB_PATH =
  process.env.DB_PATH ||
  path.join(
    process.env.ELECTRON_USER_DATA || path.join(path.resolve(__dirname, ".."), "data"),
    "nowen-note.db",
  );

const username = process.env.DEMO_USER || "demo";
const password = process.env.DEMO_PASS || "demo123456";

console.log(`[seed-demo] 数据库: ${DB_PATH}`);
console.log(`[seed-demo] 账号: ${username} / ${password}`);

const db = new Database(DB_PATH);

// 先确认 isDemo 列存在（即 v15 迁移已跑过）
const cols = db.prepare("PRAGMA table_info(users)").all();
if (!cols.some((c) => c.name === "isDemo")) {
  console.error(
    "[seed-demo] users 表没有 isDemo 列。请先启动一次后端让 schema 迁移到 v15，再运行本脚本。",
  );
  process.exit(1);
}

const exist = db
  .prepare("SELECT id FROM users WHERE username = ?")
  .get(username);

if (exist) {
  db.prepare("UPDATE users SET isDemo = 1 WHERE id = ?").run(exist.id);
  console.log(`[seed-demo] ✓ 已存在用户 ${username}，已标记 isDemo=1（密码未改动）`);
} else {
  const id = randomUUID();
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(
    `INSERT INTO users (id, username, email, passwordHash, role, displayName, isDemo)
     VALUES (?, ?, NULL, ?, 'user', ?, 1)`,
  ).run(id, username, passwordHash, "体验账号");
  console.log(`[seed-demo] ✓ 已创建用户 ${username}（isDemo=1）`);
}

db.close();
console.log("[seed-demo] done.");
