import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { captureInput, CaptureError, getCapture, initCaptures, presentCapture, retryCapture, submitCapture, type CaptureActor } from "../services/captures.js";

const app = new Hono();
app.onError((error, c) => {
  if (error instanceof CaptureError) return c.json({ error: error.message, code: error.code }, error.status as 400);
  return c.json({ error: "收集服务暂时不可用", code: "CAPTURE_SERVICE_FAILED" }, 500);
});
app.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!c.req.header("X-User-Id")) return c.json({ error: "未授权", code: "UNAUTHENTICATED" }, 401);
  initCaptures();
  await next();
});
app.use("*", bodyLimit({ maxSize: 160 * 1024, onError: c => c.json({ error: "收集内容过大", code: "CAPTURE_TOO_LARGE" }, 413) }));
const actor = (c: any): CaptureActor => ({ userId: c.req.header("X-User-Id"),
  tokenId: c.req.header("X-Auth-Mode") === "api-token" ? c.req.header("X-Api-Token-Id") : null });

app.post("/", async c => {
  const parsed = captureInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "需要唯一 requestId 和非空文本；文本最多32000字符", code: "CAPTURE_INVALID_INPUT" }, 400);
  const { job, duplicate } = submitCapture(actor(c), parsed.data);
  return c.json({ ...presentCapture(job), duplicate }, duplicate ? 200 : 202);
});
app.get("/:id", c => c.json(presentCapture(getCapture(actor(c), c.req.param("id")))));
app.post("/:id/retry", c => c.json(presentCapture(retryCapture(actor(c), c.req.param("id"))), 202));
export default app;
