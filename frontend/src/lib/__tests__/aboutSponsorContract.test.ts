import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
it("fnOS About has no donation, personal contact or upstream update entry",()=>{
 const source=readFileSync("src/components/SettingsModal.tsx","utf8");
 expect(source).toContain("about.fnosDescription");expect(source).toContain("about.upstreamAttribution");
 for(const key of ["about.sponsor","about.feedbackQq","about.privateRepository","WhatsNewModal","setShowWhatsNew"])expect(source).not.toContain(key);
 for(const locale of ["zh-CN","en"]){const about=JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`,"utf8")).about;expect(Object.keys(about).some(key=>/sponsor|feedbackqq|contact|website|changelog|authorstory/i.test(key))).toBe(false);}
});
