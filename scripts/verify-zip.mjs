import fs from "node:fs";
import JSZip from "jszip";

const zipPath = process.argv[2];
if (!zipPath) {
  console.error("Usage: node scripts/verify-zip.mjs <zip-path>");
  process.exit(1);
}

const z = await JSZip.loadAsync(fs.readFileSync(zipPath));
const entries = Object.keys(z.files);
const dirs = entries.filter((f) => z.files[f].dir);
const files = entries.filter((f) => !z.files[f].dir);

console.log(`ZIP: ${zipPath}`);
console.log(`总条目: ${entries.length} | 文件: ${files.length} | 目录: ${dirs.length}`);

const topLevel = [...new Set(entries.map((e) => e.split("/")[0]))].sort();
console.log("\n顶层条目:");
for (const t of topLevel) console.log("  " + t);

console.log("\n抽样文件 (20 条):");
for (let i = 0; i < Math.min(20, files.length); i++) {
  console.log("  " + files[Math.floor(Math.random() * files.length)]);
}

console.log("\n目录条目 (前 30):");
for (const d of dirs.slice(0, 30)) console.log("  " + d);

// 校验每个目录条目都以 "/" 结尾（zip 目录规范）
const badDirs = dirs.filter((d) => !d.endsWith("/"));
console.log(`\n目录格式检查: ${badDirs.length === 0 ? "OK（全部以 / 结尾）" : "异常: " + badDirs.join(", ")}`);

// 统计各顶层条目文件数
console.log("\n各顶层目录的文件数:");
const countByTop = {};
for (const f of files) {
  const top = f.split("/")[0];
  countByTop[top] = (countByTop[top] || 0) + 1;
}
for (const [k, v] of Object.entries(countByTop).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${v}`);
}
