import {existsSync} from "node:fs";
import {expect,it} from "vitest";
it("fnOS edition does not ship a personal community QR code",()=>{expect(existsSync("src/assets/community/nowen-lab-wechat.jpg")).toBe(false);});
