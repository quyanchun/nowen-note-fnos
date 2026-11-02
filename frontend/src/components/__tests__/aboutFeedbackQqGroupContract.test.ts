import {existsSync,readFileSync} from "node:fs";
import {expect,it} from "vitest";
it("public fnOS frontend does not bundle payment or QQ group QR assets",()=>{
 for(const asset of ["src/assets/sponsor/weixin.jpg","src/assets/sponsor/zhifubao.png","src/assets/feedback/qq-group.jpg"])expect(existsSync(asset)).toBe(false);
 const app=readFileSync("src/App.tsx","utf8");expect(app).not.toContain("<UpdateNotifier");
});
