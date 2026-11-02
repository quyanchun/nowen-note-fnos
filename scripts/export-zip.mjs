#!/usr/bin/env node
/**
 * 将当前项目目录全量导出为 ZIP 压缩包。
 *
 * 特性：
 *   - 递归遍历所有子目录和文件，层级结构与原目录完全一致
 *   - 保留空目录（显式写入目录条目）
 *   - 支持通过 --exclude 多次排除任意相对路径 / 目录名 / glob
 *   - 流式写入，大项目也不会占用过多内存
 *   - 输出进度和最终统计信息
 *
 * 用法：
 *   node scripts/export-zip.mjs                         # 使用默认排除规则，输出到 <project>.zip
 *   node scripts/export-zip.mjs -o build/out.zip        # 指定输出路径
 *   node scripts/export-zip.mjs --include-node-modules  # 连 node_modules 也打包
 *   node scripts/export-zip.mjs --exclude release       # 追加排除目录
 *   node scripts/export-zip.mjs --src ./backend         # 打包指定子目录
 *
 * 依赖：archiver
 *   npm i -D archiver
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

// ------------------------------ 参数解析 ------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
function getArg(flag, short) {
  const idx = argv.findIndex((a) => a === flag || a === short);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("-")) {
    return argv[idx + 1];
  }
  return undefined;
}
function hasFlag(flag) {
  return argv.includes(flag);
}
function getAllArgs(flag) {
  const results = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) {
      results.push(argv[i + 1]);
      i++;
    }
  }
  return results;
}

const srcDir = path.resolve(getArg("--src", "-s") || PROJECT_ROOT);
const defaultOut = path.join(
  PROJECT_ROOT,
  `${path.basename(srcDir)}-${new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14)}.zip`,
);
const outPath = path.resolve(getArg("--output", "-o") || defaultOut);
const includeNodeModules = hasFlag("--include-node-modules");
const includeGit = hasFlag("--include-git");
const compressionLevel = Number(getArg("--level", "-l") ?? 9);
const quiet = hasFlag("--quiet") || hasFlag("-q");

// 默认排除：构建产物、依赖、版本控制、系统垃圾
const DEFAULT_EXCLUDES = new Set([
  ...(includeNodeModules ? [] : ["node_modules"]),
  "dist",
  "dist-electron",
  "release",
  "release2",
  ...(includeGit ? [] : [".git"]),
  ".DS_Store",
  "Thumbs.db",
  "$null",
]);
// 追加用户通过 --exclude 指定的项
for (const ex of getAllArgs("--exclude")) DEFAULT_EXCLUDES.add(ex);

// ------------------------------ 前置校验 ------------------------------
if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
  console.error(`[export-zip] 源目录不存在或不是目录: ${srcDir}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });

// 防止把输出 zip 打包进自身
const outPathResolved = path.resolve(outPath);

function log(...args) {
  if (!quiet) console.log("[export-zip]", ...args);
}

log(`源目录: ${srcDir}`);
log(`输出路径: ${outPath}`);
log(`压缩级别: ${compressionLevel}`);
log(`排除项: ${[...DEFAULT_EXCLUDES].join(", ") || "(无)"}`);

// ------------------------------ 排除判定 ------------------------------
/**
 * 判断某个绝对路径是否应排除。
 * - 匹配条件：路径的任意一段等于 DEFAULT_EXCLUDES 中的某项，
 *   或者 relPath 严格等于排除项。
 */
function shouldExclude(absPath) {
  if (absPath === outPathResolved) return true; // 不把自身打进去
  const rel = path.relative(srcDir, absPath).split(path.sep);
  for (const ex of DEFAULT_EXCLUDES) {
    if (rel.includes(ex)) return true;
    if (path.relative(srcDir, absPath) === ex) return true;
  }
  return false;
}

// ------------------------------ 递归收集条目 ------------------------------
/**
 * 深度优先遍历：先处理文件，再单独记录"空目录"以便写入 zip。
 * 返回值：{ files: string[], emptyDirs: string[] }（均为绝对路径）
 */
function collectEntries(root) {
  const files = [];
  const emptyDirs = [];
  const stack = [root];

  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (err) {
      console.warn(`[export-zip] 无法读取目录: ${cur} (${err.message})`);
      continue;
    }

    // 过滤排除项 & 分类
    const kept = entries.filter((d) => !shouldExclude(path.join(cur, d.name)));

    // 统计当前目录在过滤后是否为空
    if (cur !== root && kept.length === 0) {
      emptyDirs.push(cur);
      continue;
    }

    for (const d of kept) {
      const abs = path.join(cur, d.name);
      if (d.isSymbolicLink()) {
        // 对符号链接按普通文件处理（读取其目标内容）；如需保留 link，可自行扩展
        try {
          const target = fs.statSync(abs);
          if (target.isDirectory()) stack.push(abs);
          else files.push(abs);
        } catch {
          /* 悬空 link，忽略 */
        }
      } else if (d.isDirectory()) {
        stack.push(abs);
      } else if (d.isFile()) {
        files.push(abs);
      }
    }
  }

  return { files, emptyDirs };
}

// ------------------------------ 打包 ------------------------------
async function run() {
  const start = Date.now();
  log("正在扫描文件...");
  const { files, emptyDirs } = collectEntries(srcDir);
  log(`扫描完成：${files.length} 个文件，${emptyDirs.length} 个空目录`);

  const output = fs.createWriteStream(outPath);
  const archive = archiver("zip", {
    zlib: { level: Math.min(Math.max(compressionLevel, 0), 9) },
  });

  // 错误与警告
  archive.on("warning", (err) => {
    if (err.code === "ENOENT") console.warn("[export-zip] 警告:", err.message);
    else throw err;
  });
  archive.on("error", (err) => {
    throw err;
  });

  // 进度（每 200 个文件打一次，避免刷屏）
  let processed = 0;
  archive.on("entry", () => {
    processed++;
    if (!quiet && processed % 200 === 0) {
      log(`已写入 ${processed} / ${files.length + emptyDirs.length} 条...`);
    }
  });

  // 关闭 promise
  const done = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });

  archive.pipe(output);

  // 1) 写文件（保持相对路径）
  for (const abs of files) {
    const rel = path.relative(srcDir, abs).split(path.sep).join("/"); // zip 内部一律用正斜杠
    archive.file(abs, { name: rel });
  }

  // 2) 写空目录（显式目录条目，确保解压后能还原空文件夹）
  for (const abs of emptyDirs) {
    const rel = path.relative(srcDir, abs).split(path.sep).join("/") + "/";
    archive.append("", { name: rel });
  }

  await archive.finalize();
  await done;

  const size = fs.statSync(outPath).size;
  const ms = Date.now() - start;
  log(
    `完成！大小 ${(size / 1024 / 1024).toFixed(2)} MB，用时 ${(ms / 1000).toFixed(
      2,
    )} s`,
  );
  log(`输出：${outPath}`);
}

run().catch((err) => {
  console.error("[export-zip] 打包失败:", err);
  process.exit(1);
});
