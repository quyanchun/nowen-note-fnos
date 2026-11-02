import {Hono} from "hono";
import {getDb} from "../db/schema";
import {getActiveProfile} from "../sync/profile";
import {getRemoteCredential,createRemoteClientForProfile} from "../sync/credentials";
import {ensureDevice} from "../sync/device";
import {isLocalFirstSyncV2Enabled} from "../sync/flag";
import {triggerSyncNow} from "../sync/runtime";
import {reviewSync,reviewHistory,smartReview,applyNotePlan,undoReview,reviewVersions,recoverReviewCopy,type ReviewContext} from "../sync/conflictReview";
import {SyncError} from "../sync/errors";

const app=new Hono();
function context(c:any):ReviewContext {
  if(!isLocalFirstSyncV2Enabled())throw new SyncError("INVALID_PAYLOAD","当前设备未开启同步");
  const db=getDb(),profile=getActiveProfile(db),userId=c.req.header("X-User-Id");
  if(!userId||c.req.header("X-Auth-Mode")==="api-token"||!db.prepare("SELECT 1 FROM users WHERE id=? AND isDisabled=0").get(userId))throw new SyncError("SCOPE_FORBIDDEN","请使用笔记账号管理同步");
  const credential=profile&&getRemoteCredential(profile.id);
  if(!profile||!credential||credential.localUserId!==userId||!profile.remoteUserId||credential.remoteUserId!==profile.remoteUserId||credential.serverUrl!==profile.serverUrl)throw new SyncError("AUTH_EXPIRED","请先连接并登录同步服务");
  const assertCurrent=()=>{
    const next=getRemoteCredential(profile.id);
    if(getActiveProfile(db)?.id!==profile.id||!next||next.localUserId!==userId||next.remoteUserId!==profile.remoteUserId||next.serverUrl!==profile.serverUrl||!db.prepare("SELECT 1 FROM users WHERE id=? AND isDisabled=0").get(userId))throw new SyncError("AUTH_EXPIRED","同步连接已变更，请刷新后重试");
  };
  return {db,profileId:profile.id,userId,remoteUserId:profile.remoteUserId,deviceId:ensureDevice(db,{profileId:profile.id}).id,
    client:createRemoteClientForProfile(profile.id,profile.serverUrl)!,assertCurrent};
}
app.onError((error,c)=>{
  const code=error instanceof SyncError?error.code:"SERVER_ERROR";
  if(code==="MISSING_DEPENDENCY")void triggerSyncNow();
  return c.json({code,error:code==="SERVER_ERROR"?"暂时未完成处理，原始版本已保留，请重试":code==="MISSING_DEPENDENCY"?"原笔记或目录还没同步完整。已保留两个版本，后台同步后可重试。":error.message},code==="AUTH_EXPIRED"?409:code==="SCOPE_FORBIDDEN"?403:code==="VERSION_CONFLICT"?409:code==="INVALID_PAYLOAD"?400:502);
});
app.get("/",async c=>{
  let ctx:ReviewContext;
  try {ctx=context(c);}catch(error){
    if(error instanceof SyncError&&error.code==="AUTH_EXPIRED")return c.json({connected:false,items:[],consistent:0,total:0,legacyCount:0,history:[],message:error.message});
    throw error;
  }
  const result=await reviewSync(ctx);
  return c.json({connected:true,items:result.items,consistent:result.consistent,total:result.total,legacyCount:result.legacyCount,history:reviewHistory(ctx)});
});
app.post("/smart",async c=>{
  const ctx=context(c),body=await c.req.json().catch(()=>({}));
  if(body.conflictId!==undefined&&(typeof body.conflictId!=="string"||body.conflictId.length>128))throw new SyncError("INVALID_PAYLOAD","记录参数无效");
  if(body.side!==undefined&&body.side!=="local"&&body.side!=="remote")throw new SyncError("INVALID_PAYLOAD","版本选择无效");
  const result=await smartReview(ctx,{conflictId:body.conflictId,analyzeOnly:body.analyzeOnly===true,side:body.side});
  void triggerSyncNow();return c.json(result);
});
app.post("/apply/:id",async c=>{const ctx=context(c),result=await applyNotePlan(ctx,c.req.param("id"));void triggerSyncNow();return c.json(result);});
app.post("/undo/:id",async c=>{const ctx=context(c),result=await undoReview(ctx,c.req.param("id"));void triggerSyncNow();return c.json(result);});
app.get("/versions/:id",c=>c.json(reviewVersions(context(c),c.req.param("id"))));
app.post("/recover/:id",c=>{const ctx=context(c),result=recoverReviewCopy(ctx,c.req.param("id"));void triggerSyncNow();return c.json(result);});
export default app;
