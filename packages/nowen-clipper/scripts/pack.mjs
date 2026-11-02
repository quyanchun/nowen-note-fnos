#!/usr/bin/env node
/**
 * 打包扩展为 zip（用于上传 Chrome Web Store 或分发）。
 * 输入：dist/ 构建产物
 * 输出：releases/nowen-clipper-<version>.zip
 */
import { mkdirSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 这里用 archiver 更方便，但为了避免新增依赖，用 JSZip（node 端亦可）。
// JSZip 已在 backend 里用过，属于项目内已有依赖生态，新加到 devDeps 也合理。
import JSZip from "jszip";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
const out = join(root, "releases");

if (!existsSync(dist)) {
  console.error("[pack] dist 不存在，先运行 `npm run build`");
  process.exit(1);
}
if (!existsSync(out)) mkdirSync(out, { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

// 包名后缀策略：
//   优先看 --browser=xxx CLI 参数（chrome/edge/firefox），允许显式覆盖。
//   - chrome  → 无后缀          nowen-clipper-<v>.zip
//   - edge    → -edge 后缀      nowen-clipper-<v>-edge.zip
//   - firefox → -firefox 后缀   nowen-clipper-<v>-firefox.zip
// 若没显式传 --browser，则回退到看 dist/manifest.json 的特征：
//   有 browser_specific_settings.gecko 视作 firefox 包；否则当作 chrome。
//   （edge 与 chrome 的 manifest 完全一致，无法靠 manifest 区分，这种情况下
//    只能靠 CLI 参数明确，否则会归类成 chrome。）
const browserArg = process.argv.find((a) => a.startsWith("--browser="));
const browser = browserArg ? browserArg.slice("--browser=".length) : "";
let suffix = "";
if (browser === "firefox") suffix = "-firefox";
else if (browser === "edge") suffix = "-edge";
else if (browser === "chrome") suffix = "";
else {
  // 未显式指定：靠 manifest 推断
  try {
    const distManifest = JSON.parse(
      readFileSync(join(dist, "manifest.json"), "utf-8"),
    );
    if (distManifest?.browser_specific_settings?.gecko) {
      suffix = "-firefox";
    }
  } catch {
    // dist/manifest.json 不存在时，前面 dist 存在性检查已经处理过，这里忽略解析失败，按 Chrome 包名走。
  }
}
const zipName = `nowen-clipper-${pkg.version}${suffix}.zip`;
const zipPath = join(out, zipName);

const zip = new JSZip();

function addDir(baseZip, absDir, relDir = "") {
  for (const entry of readdirSync(absDir)) {
    const abs = join(absDir, entry);
    const rel = relDir ? `${relDir}/${entry}` : entry;
    const st = statSync(abs);
    if (st.isDirectory()) addDir(baseZip, abs, rel);
    else baseZip.file(rel, readFileSync(abs));
  }
}
addDir(zip, dist);

const buf = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
});

// Windows 上若 zip 正被其他进程持有句柄（浏览器上传中、资源管理器预览、
// 杀毒软件扫描等），直接 writeFileSync 会抛 UNKNOWN errno -4094 这种迷之错误。
// 策略：先写入同目录的临时文件，再原子 rename 覆盖目标；如果 rename 也失败，
// 给出可操作的提示而不是裸的 stacktrace。
const tmpPath = `${zipPath}.tmp-${process.pid}-${Date.now()}`;
writeFileSync(tmpPath, buf);

try {
  // 旧文件存在则先删，避免某些 Windows 文件系统下 rename 不能覆盖。
  if (existsSync(zipPath)) {
    try {
      unlinkSync(zipPath);
    } catch (e) {
      // 删不掉通常说明文件被占用 → 给出清晰指引后退出。
      try { unlinkSync(tmpPath); } catch {}
      console.error(
        `[pack] 无法删除已存在的 ${zipName}，文件可能被占用。\n` +
          `  常见原因：Firefox/Chrome 开发者中心正在上传该文件、\n` +
          `            资源管理器预览面板已打开、杀毒软件正在扫描。\n` +
          `  建议：关闭浏览器上传页签 / 资源管理器预览，或重命名输出文件后重试。\n` +
          `  原始错误：${e?.code || e?.message || e}`,
      );
      process.exit(1);
    }
  }
  renameSync(tmpPath, zipPath);
} catch (e) {
  try { unlinkSync(tmpPath); } catch {}
  console.error(`[pack] 写入 ${zipName} 失败：${e?.code || e?.message || e}`);
  process.exit(1);
}

console.log(`[pack] 打包完成：${zipPath} (${(buf.length / 1024).toFixed(1)} KB)`);
