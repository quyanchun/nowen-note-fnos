#!/usr/bin/env node
/**
 * 基于 jszip 的目录全量打包脚本（方案 B）。
 *
 * 适用场景：不想新增 archiver 依赖，或项目已在前端使用 jszip。
 *
 * 注意：jszip 是把所有条目先放进内存再统一 generate，超大项目请优先用 archiver 版本。
 *
 * 用法同 export-zip.mjs：
 *   node scripts/export-zip-jszip.mjs -o out.zip --exclude release
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ------------------------------ 参数 ------------------------------
const argv = process.argv.slice(2);
const getArg = (flag, short) => {
  const i = argv.findIndex((a) => a === flag || a === short);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[i + 1] : undefined;
};
const hasFlag = (f) => argv.includes(f);
const getAllArgs = (flag) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag && argv[i + 1]) out.push(argv[++i]);
  return out;
};

const srcDir = path.resolve(getArg("--src", "-s") || PROJECT_ROOT);
const outPath = path.resolve(
  getArg("--output", "-o") ||
    path.join(PROJECT_ROOT, `${path.basename(srcDir)}.zip`),
);
const EXCLUDES = new Set([
  ...(hasFlag("--include-node-modules") ? [] : ["node_modules"]),
  "dist",
  "dist-electron",
  "release",
  "release2",
  ...(hasFlag("--include-git") ? [] : [".git"]),
  ".DS_Store",
  "Thumbs.db",
  "$null",
  ...getAllArgs("--exclude"),
]);

if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
  console.error(`[export-zip-jszip] 源目录不存在: ${srcDir}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const outResolved = path.resolve(outPath);
const shouldExclude = (abs) => {
  if (abs === outResolved) return true;
  const parts = path.relative(srcDir, abs).split(path.sep);
  for (const ex of EXCLUDES) if (parts.includes(ex)) return true;
  return false;
};

// ------------------------------ 递归遍历 + 写入 JSZip ------------------------------
const zip = new JSZip();
let fileCount = 0;
let dirCount = 0;

/**
 * 递归处理一个目录。
 * @param {string} absDir 绝对路径
 * @param {JSZip} folderNode 对应 zip 内的文件夹节点（根目录是 zip 实例本身）
 */
function walk(absDir, folderNode) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const keptItems = entries.filter((d) => !shouldExclude(path.join(absDir, d.name)));

  // 空目录：显式创建一个文件夹条目，保留结构
  if (keptItems.length === 0 && absDir !== srcDir) {
    // folderNode 已经代表当前目录本身；JSZip 在 file() 时会自动创建父目录，
    // 但为了空目录也能存在，需要对父节点 .folder(name) 显式调用一次。
    // 由于进入 walk 前父级已经 folder()，此处无需重复。
    return;
  }

  for (const entry of keptItems) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      // 对每个目录显式创建一个文件夹条目，确保即便目录为空也会出现在 zip 里
      const sub = folderNode.folder(entry.name);
      dirCount++;
      walk(abs, sub);
    } else if (entry.isFile()) {
      const data = fs.readFileSync(abs);
      folderNode.file(entry.name, data, {
        // 保留文件的修改时间，解压后 mtime 更接近原状
        date: fs.statSync(abs).mtime,
        binary: true,
      });
      fileCount++;
    } else if (entry.isSymbolicLink()) {
      try {
        const st = fs.statSync(abs);
        if (st.isDirectory()) {
          const sub = folderNode.folder(entry.name);
          dirCount++;
          walk(abs, sub);
        } else {
          folderNode.file(entry.name, fs.readFileSync(abs), { binary: true });
          fileCount++;
        }
      } catch {
        /* 悬空 link，忽略 */
      }
    }
  }
}

// ------------------------------ 执行 ------------------------------
const start = Date.now();
console.log(`[export-zip-jszip] 扫描目录: ${srcDir}`);
console.log(`[export-zip-jszip] 排除: ${[...EXCLUDES].join(", ")}`);

walk(srcDir, zip);
console.log(`[export-zip-jszip] 收集完成：${fileCount} 文件 / ${dirCount} 目录`);

const buf = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  streamFiles: true, // 降低内存占用
});

fs.writeFileSync(outPath, buf);
const ms = Date.now() - start;
console.log(
  `[export-zip-jszip] 完成 -> ${outPath} (${(buf.length / 1024 / 1024).toFixed(
    2,
  )} MB, ${(ms / 1000).toFixed(2)} s)`,
);
