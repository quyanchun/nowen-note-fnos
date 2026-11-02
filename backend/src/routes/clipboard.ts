import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { CaptureError, getCapture, presentCapture, retryCapture, type CaptureActor } from "../services/captures.js";
import { authenticateClipboard, clipboardSettingsSchema, clipboardSubmissionSchema, copyClipboardToken, getClipboardSettings, revokeClipboardToken, saveClipboardSettings, submitClipboard, listClipboardLogs } from "../services/clipboard-integration.js";
import { isDesktopClipboard, desktopClipboardSettings, saveDesktopClipboardSettings, copyDesktopClipboardToken, revokeDesktopClipboardToken, desktopClipboardLogs, desktopClipboardLogAction } from "../services/desktop-clipboard";

import {deleteClipboardLog,forceClipboardLog,undoClipboardLog} from "../services/clipboard-log-actions";

function errors(app: Hono<any>,maxSize=160*1024) {
  app.onError((error,c) => error instanceof CaptureError ? c.json({ error: error.message, code: error.code }, error.status as 400)
    : c.json({ error: "剪贴板服务暂时不可用", code: "CLIPBOARD_SERVICE_FAILED" },500));
  app.use("*",async (c,next) => { c.header("Cache-Control","no-store"); await next(); });
  app.use("*",bodyLimit({ maxSize, onError:c=>c.json({ error:"内容过大",code:"CAPTURE_TOO_LARGE" },413) }));
}
export const clipboardSettingsRouter = new Hono();
errors(clipboardSettingsRouter);
clipboardSettingsRouter.use("*",async (c,next) => {
  if (!c.req.header("X-User-Id") || c.req.header("X-Auth-Mode") === "api-token") return c.json({ error:"请使用笔记登录凭证管理剪贴板集成" },403);
  await next();
});
clipboardSettingsRouter.get("/",async c=>c.json(isDesktopClipboard()
  ? await desktopClipboardSettings(c.req.header("X-User-Id")!)
  : getClipboardSettings(c.req.header("X-User-Id")!)));
clipboardSettingsRouter.get("/logs",async c=>{
  const offset=Number(c.req.query("offset")||0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return c.json({error:"无效分页"},400);
  const userId=c.req.header("X-User-Id")!;
  return c.json(isDesktopClipboard()?await desktopClipboardLogs(userId,offset):listClipboardLogs(userId,offset));
});

for(const action of ["delete","force","undo"] as const) {
  const handler=async(c:any)=>{
    const userId=c.req.header("X-User-Id")!,requestId=c.req.param("requestId");
    if(!requestId||requestId.length>160)return c.json({error:"无效日志编号"},400);
    if(isDesktopClipboard())return c.json(await desktopClipboardLogAction(userId,requestId,action));
    const result=action==="delete"?deleteClipboardLog(userId,requestId):action==="force"?forceClipboardLog(userId,requestId):await undoClipboardLog(userId,requestId);
    return c.json(result);
  };
  if(action==="delete")clipboardSettingsRouter.delete("/logs/:requestId",handler);
  else clipboardSettingsRouter.post(`/logs/:requestId/${action}`,handler);
}
clipboardSettingsRouter.put("/",async c=>{
  const parsed=clipboardSettingsSchema.safeParse(await c.req.json().catch(error=>{if(error?.name==="BodyLimitError")throw error;return null;}));
  if (!parsed.success) return c.json({error:"剪贴板设置格式不正确",code:"CLIPBOARD_INVALID_SETTINGS"},400);
  return c.json(isDesktopClipboard()
    ? await saveDesktopClipboardSettings(c.req.header("X-User-Id")!,parsed.data)
    : saveClipboardSettings(c.req.header("X-User-Id")!,parsed.data));
});
clipboardSettingsRouter.post("/token",async c=>c.json(isDesktopClipboard()
  ? await copyDesktopClipboardToken(c.req.header("X-User-Id")!) : copyClipboardToken(c.req.header("X-User-Id")!)));
clipboardSettingsRouter.post("/token/rotate",async c=>c.json(isDesktopClipboard()
  ? await copyDesktopClipboardToken(c.req.header("X-User-Id")!,true) : copyClipboardToken(c.req.header("X-User-Id")!,true)));
clipboardSettingsRouter.delete("/token",async c=>{
  if(isDesktopClipboard()) return c.json(await revokeDesktopClipboardToken(c.req.header("X-User-Id")!));
  revokeClipboardToken(c.req.header("X-User-Id")!);return c.json({success:true});
});

export const clipboardPublicRouter = new Hono<{ Variables: { actor: CaptureActor } }>();
errors(clipboardPublicRouter,18*1024*1024);
const rate = new Map<string,{until:number;count:number}>();
clipboardPublicRouter.use("*",async (c,next)=>{
  const bearer=c.req.header("Authorization") || "";
  const actor=authenticateClipboard(bearer.startsWith("Bearer ") ? bearer.slice(7) : "");
  const now=Date.now(); let bucket=rate.get(actor.tokenId!);
  if (!bucket || bucket.until<=now) { bucket={until:now+60000,count:0};rate.set(actor.tokenId!,bucket); }
  if (++bucket.count>180) return c.json({error:"请求过于频繁",code:"CLIPBOARD_RATE_LIMITED"},429);
  if (rate.size>5000) for(const [key,value] of rate) if(value.until<=now)rate.delete(key);
  c.set("actor",actor);await next();
});
clipboardPublicRouter.get("/policy",c=>{
  const {settings}=getClipboardSettings(c.get("actor").userId);
  const {systemPrompt,instruction,aiFilterPrompt,...policy}=settings;
  return c.json({ ...policy, supportedContent:"text", maxChars:32000,imagesSupported:true,maxImageBytes:6*1024*1024,maxImages:8,maxImageTotalBytes:12*1024*1024 });
});
clipboardPublicRouter.post("/captures",async c=>{
  const raw=await c.req.json().catch(error=>{if(error?.name==="BodyLimitError")throw error;return null;});
  if(!raw?.images?.length&&Buffer.byteLength(JSON.stringify(raw))>160*1024)return c.json({error:"内容过大",code:"CAPTURE_TOO_LARGE"},413);
  const parsed=clipboardSubmissionSchema.safeParse(raw);
  if(!parsed.success)return c.json({error:"需要唯一requestId和非空文本，最多32000字符",code:"CAPTURE_INVALID_INPUT"},400);
  const result=submitClipboard(c.get("actor"),parsed.data);
  return c.json(result,result.duplicate || result.status==="filtered" ? 200 : 202);
});
clipboardPublicRouter.get("/captures/:id",c=>c.json(presentCapture(getCapture(c.get("actor"),c.req.param("id")))));
clipboardPublicRouter.post("/captures/:id/retry",c=>c.json(presentCapture(retryCapture(c.get("actor"),c.req.param("id"))),202));
