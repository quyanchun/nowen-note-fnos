import { Hono } from "hono";
import { requireAdmin } from "../middleware/acl";
import { readFnosWebEntries, writeFnosWebEntries } from "../services/fnos-web-config";
const router = new Hono();
router.use("*", requireAdmin);
router.use("*", async(c,next)=>{ c.header("Cache-Control","no-store"); await next(); });
router.get("/",c=>c.json({entries:readFnosWebEntries(), available:!!process.env.NOWEN_FNOS_SOCKET || !!process.env.NOWEN_WEB_PUBLIC_URL}));
router.put("/",async c=>{
  if (c.req.header("sec-fetch-site")==="cross-site") return c.json({error:"请从本站设置页保存",code:"FORBIDDEN"},403);
  try {const body=await c.req.json();return c.json({entries:writeFnosWebEntries(body?.entries)});}
  catch(error){return c.json({error:error instanceof Error?error.message:"登录入口配置无效",code:"INVALID_FNOS_WEB_ENTRIES"},400);}
});
export default router;
