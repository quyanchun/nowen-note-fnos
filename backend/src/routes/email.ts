/**
 * 邮件服务（SMTP）配置与测试 —— 管理员专属
 *
 *  - GET    /api/email/smtp            查看当前配置（密码字段永远不回明文，只回 hasPassword）
 *  - PUT    /api/email/smtp            写入/更新配置（sudo 二次验证；password 省略=不动旧值）
 *  - POST   /api/email/smtp/test       向指定邮箱发一封测试邮件（sudo）
 *
 * 为什么把 SMTP 配置放在这里而不是扩展 /api/settings？
 *  - /api/settings 已被用作站点标识（site_title / favicon / editor_font_family），
 *    把"含密钥/密码"的 SMTP 混进去会让它失去"仅站点外观"的清晰定位；
 *  - 独立路由能挂 requireAdmin + sudo，最小化敏感字段的暴露面。
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { requireAdmin } from "../middleware/acl.js";
import { verifySudoFromRequest } from "../lib/auth-security.js";
import { getDb } from "../db/schema.js";
import {
  readSmtpConfig,
  writeSmtpConfig,
  toPublicConfig,
  sendMail,
  type WriteSmtpInput,
} from "../services/email.js";

const emailRouter = new Hono();

// 全组管理员守卫：邮件服务涉及凭证 + 对外发信，不该让普通用户触达
emailRouter.use("*", requireAdmin);

/** 与 backups.ts 中的同名 helper 保持一致行为：写操作需 sudo */
function requireSudo(c: Context): Response | null {
  const userId = c.req.header("X-User-Id") || "";
  const db = getDb();
  const me = db
    .prepare("SELECT tokenVersion FROM users WHERE id = ?")
    .get(userId) as { tokenVersion: number } | undefined;
  const sudo = verifySudoFromRequest(c, userId, me?.tokenVersion ?? 0);
  if (!sudo.ok) {
    return c.json({ error: sudo.message, code: sudo.code }, sudo.status as 401 | 403);
  }
  return null;
}

// ===== GET /api/email/smtp =====
emailRouter.get("/smtp", (c) => {
  const cfg = readSmtpConfig();
  return c.json(toPublicConfig(cfg));
});

// ===== PUT /api/email/smtp =====
//
// body: {
//   enabled, host, port, secure, username, password?, fromName, fromEmail
// }
// password 字段语义：
//   - 省略 / undefined：保持旧密码不变
//   - 空串 ""        ：显式清空密码
//   - 非空串          ：覆盖为新密码（落库前做 AES-GCM 加密）
emailRouter.put("/smtp", async (c) => {
  const denied = requireSudo(c);
  if (denied) return denied;

  const body = (await c.req.json().catch(() => ({}))) as Partial<WriteSmtpInput>;

  // 简易校验：enabled 时必须有 host/port/from
  if (body.enabled) {
    if (!body.host || !String(body.host).trim()) {
      return c.json({ error: "启用 SMTP 时必须填写 host" }, 400);
    }
    if (!body.port || Number(body.port) <= 0 || Number(body.port) > 65535) {
      return c.json({ error: "port 必须在 1-65535 之间" }, 400);
    }
    const from = (body.fromEmail || body.username || "").toString().trim();
    if (!from || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
      return c.json({ error: "发件人邮箱格式不合法" }, 400);
    }
  }

  const saved = writeSmtpConfig({
    enabled: !!body.enabled,
    host: body.host || "",
    port: Number(body.port) || 465,
    secure: body.secure !== false, // 默认 true（465）
    username: body.username || "",
    // undefined 表示"不动旧密码"；调用者若想清空可显式传空串
    password: body.password,
    fromName: body.fromName || "",
    fromEmail: body.fromEmail || "",
  });

  return c.json(saved);
});

// ===== POST /api/email/smtp/test =====
//
// body: { to: string }
// 发送一封"测试邮件"验证配置；失败返回 502 + error，前端可以直接展示给管理员。
emailRouter.post("/smtp/test", async (c) => {
  const denied = requireSudo(c);
  if (denied) return denied;

  const body = (await c.req.json().catch(() => ({}))) as { to?: string };
  const to = (body.to || "").trim();
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return c.json({ error: "收件人邮箱格式不合法" }, 400);
  }

  const result = await sendMail({
    to,
    subject: "[nowen-note] SMTP 测试邮件",
    text:
      "这是一封来自 nowen-note 的 SMTP 测试邮件。\n\n" +
      "如果你能看到这条消息，说明 SMTP 配置正常，可以用于后续的「备份文件发送到邮箱」等自动化场景。\n\n" +
      `发送时间：${new Date().toLocaleString()}`,
  });

  if (!result.success) {
    return c.json({ success: false, error: result.error }, 502);
  }
  return c.json({ success: true, lastResponse: result.lastResponse });
});

export default emailRouter;
