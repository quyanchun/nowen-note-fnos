import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { clipboardPublicRouter } from "../routes/clipboard.js";

/** A separate listener exposes capture capabilities only, never the main application. */
export function startClipboardGateway() {
  if (!process.env.NOWEN_CLIPBOARD_PORT) return null;
  const port = Number(process.env.NOWEN_CLIPBOARD_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid clipboard API port");
  const app = new Hono();
  app.route("/api/clipboard", clipboardPublicRouter);
  app.notFound(c => c.json({ error: "此入口仅提供剪贴板收集接口", code: "CLIPBOARD_ROUTE_NOT_FOUND" },404));
  return serve({ fetch: app.fetch, port, hostname: process.env.NOWEN_CLIPBOARD_HOST || "127.0.0.1" });
}
