#!/usr/bin/env node
/**
 * migrate-tiptap-to-md.mjs
 * ----------------------------------------------------------------------
 * 一次性迁移脚本：把 notes 表里的 Tiptap JSON 历史笔记转换成 Markdown。
 *
 * 用法：
 *   node scripts/migrate-tiptap-to-md.mjs [--db <path>] [--dry-run|--apply]
 *                                          [--limit N] [--ids id1,id2]
 *   node scripts/migrate-tiptap-to-md.mjs --rollback <backup-file> [--db <path>]
 *
 * 选项：
 *   --db <path>              指定 SQLite 数据库文件路径。默认按环境变量 $DB_PATH，
 *                            再回退到 backend/data/nowen-note.db。
 *   --dry-run                只预览（默认）。不写库，打印 before/after 摘要。
 *   --apply                  真正执行写入。会先做一次全库备份 .bak。
 *   --limit N                最多处理 N 条（默认不限）。
 *   --ids a,b,c              仅处理指定笔记 ID（逗号分隔）。
 *   --verbose                打印每条笔记的转换细节。
 *   --rollback <backup-file> 用指定的 .bak 文件覆盖当前数据库（会先保存一份安全副本）。
 *   --yes / -y               跳过交互确认（脚本式使用）。
 *   --help                   显示帮助。
 *
 * 转换策略：
 *   1) 扫描 notes 表中 content 字段为合法 Tiptap JSON（type=doc 或含 content[]）
 *      的记录。对 "empty"/"md"/"html" 格式保持原样跳过。
 *   2) 基于节点类型自行遍历生成 Markdown（不依赖 Tiptap/Turndown，避免 DOM）。
 *   3) --apply 模式下在**单个事务**内批量写回 content 字段，确保幂等：
 *      整批成功或整批回滚，不会出现"一半 MD 一半 JSON"的中间态。
 *      contentText 保留原值（全文搜索不受影响）。
 *
 * 重要：--apply 前一定先停掉后端服务，避免写冲突。
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- 参数解析 ----------

function parseArgs(argv) {
  const args = {
    db: null,
    dryRun: true,
    limit: 0,
    ids: null,
    verbose: false,
    help: false,
    rollback: null,
    yes: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--db":
        args.db = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--apply":
        args.dryRun = false;
        break;
      case "--limit":
        args.limit = parseInt(argv[++i] || "0", 10);
        break;
      case "--ids":
        args.ids = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--verbose":
        args.verbose = true;
        break;
      case "--rollback":
        args.rollback = argv[++i];
        break;
      case "--yes":
      case "-y":
        args.yes = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        console.warn(`未识别参数: ${a}`);
    }
  }
  return args;
}

function printHelp() {
  const me = "scripts/migrate-tiptap-to-md.mjs";
  console.log(`用法：
  # 1. 迁移（dry-run 预览 / --apply 写入）
  node ${me} [--db <path>] [--dry-run|--apply] [--limit N] [--ids a,b] [--verbose]

  # 2. 回滚到指定备份
  node ${me} --rollback <backup-file> [--db <path>] [--yes]

选项：
  --db       指定 SQLite 文件路径，默认 backend/data/nowen-note.db
  --dry-run  只预览（默认）
  --apply    真正执行写入（会先生成 .bak 备份，并在单个事务内批量写入）
  --limit N  最多处理 N 条
  --ids a,b  仅处理指定 ID
  --verbose  打印每条笔记的前后对比摘要
  --rollback 用指定的 .bak 文件覆盖数据库
  --yes      跳过回滚前的交互确认`);
}

// ---------- 格式识别（与前端 contentFormat.ts 保持一致） ----------

function detectFormat(content) {
  if (content == null) return "empty";
  const trimmed = String(content).replace(
    /^[\s\uFEFF\u200B\u200C\u200D]+|[\s\uFEFF\u200B\u200C\u200D]+$/g,
    ""
  );
  if (!trimmed || trimmed === "{}" || trimmed === "[]") return "empty";
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const looksLikeTiptap =
          parsed.type === "doc" ||
          (typeof parsed.type === "string" && Array.isArray(parsed.content));
        if (looksLikeTiptap) return "tiptap-json";
      }
    } catch {
      /* 不是合法 JSON，往下 */
    }
  }
  if (trimmed.startsWith("<") && /^<\w/.test(trimmed) && /<\/?\w+[\s>]/.test(trimmed)) {
    return "html";
  }
  return "md";
}

// ---------- Tiptap JSON → Markdown（纯 Node，无 DOM） ----------

/**
 * 把一系列 inline 节点（text / hardBreak / image / 其他含 marks 的文本）转成 MD 字符串
 */
function inlineToMd(nodes) {
  if (!nodes || !Array.isArray(nodes)) return "";
  let out = "";
  for (const n of nodes) {
    if (!n) continue;
    if (n.type === "text") {
      let text = n.text || "";
      // 不转义，保留原样（历史内容里用户常写特殊字符，转义后反而破坏观感）
      if (n.marks) {
        for (const mark of n.marks) {
          switch (mark.type) {
            case "bold":
              text = `**${text}**`;
              break;
            case "italic":
              text = `*${text}*`;
              break;
            case "strike":
              text = `~~${text}~~`;
              break;
            case "code":
              text = `\`${text}\``;
              break;
            case "link": {
              const href = mark.attrs?.href || "";
              text = `[${text}](${href})`;
              break;
            }
            case "highlight":
              text = `==${text}==`;
              break;
            case "underline":
              text = `<u>${text}</u>`;
              break;
          }
        }
      }
      out += text;
      continue;
    }
    if (n.type === "hardBreak") {
      out += "  \n"; // MD 硬换行
      continue;
    }
    if (n.type === "image") {
      const alt = n.attrs?.alt || "";
      const src = n.attrs?.src || "";
      out += `![${alt}](${src})`;
      continue;
    }
    // 未知 inline 节点：递归子节点
    if (n.content) out += inlineToMd(n.content);
  }
  return out;
}

/**
 * 把一个块级节点转成 MD（以 \n 结尾）。
 * listDepth 用于处理嵌套列表缩进。
 */
function blockToMd(node, listDepth = 0) {
  if (!node) return "";
  switch (node.type) {
    case "paragraph": {
      return inlineToMd(node.content) + "\n";
    }
    case "heading": {
      const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6);
      return `${"#".repeat(level)} ${inlineToMd(node.content)}\n`;
    }
    case "bulletList": {
      const items = (node.content || []).map((li) =>
        listItemToMd(li, listDepth, null),
      );
      return items.join("");
    }
    case "orderedList": {
      const start = node.attrs?.start || 1;
      const items = (node.content || []).map((li, i) =>
        listItemToMd(li, listDepth, start + i),
      );
      return items.join("");
    }
    case "taskList": {
      const items = (node.content || []).map((li) =>
        taskItemToMd(li, listDepth),
      );
      return items.join("");
    }
    case "blockquote": {
      const inner = (node.content || [])
        .map((c) => blockToMd(c, 0))
        .join("")
        .trimEnd();
      return (
        inner
          .split("\n")
          .map((l) => (l ? `> ${l}` : ">"))
          .join("\n") + "\n"
      );
    }
    case "codeBlock": {
      const lang = node.attrs?.language || "";
      const text = (node.content || [])
        .map((c) => c.text || "")
        .join("");
      return `\`\`\`${lang}\n${text}\n\`\`\`\n`;
    }
    case "horizontalRule":
      return "---\n";
    case "image": {
      const alt = node.attrs?.alt || "";
      const src = node.attrs?.src || "";
      return `![${alt}](${src})\n`;
    }
    case "table":
      return tableToMd(node) + "\n";
    default:
      // 未知块节点：尝试当成段落处理
      if (node.content) return inlineToMd(node.content) + "\n";
      return "";
  }
}

function listItemToMd(li, depth, olIndex) {
  const indent = "  ".repeat(depth);
  const marker = olIndex != null ? `${olIndex}.` : "-";
  const inner = (li.content || [])
    .map((c, i) => {
      if (c.type === "paragraph") {
        return (i === 0 ? "" : indent + "  ") + inlineToMd(c.content);
      }
      return blockToMd(c, depth + 1).trimEnd();
    })
    .filter(Boolean)
    .join("\n" + indent + "  ");
  return `${indent}${marker} ${inner}\n`;
}

function taskItemToMd(li, depth) {
  const indent = "  ".repeat(depth);
  const checked = li.attrs?.checked ? "x" : " ";
  const inner = (li.content || [])
    .map((c, i) => {
      if (c.type === "paragraph") {
        return (i === 0 ? "" : indent + "  ") + inlineToMd(c.content);
      }
      return blockToMd(c, depth + 1).trimEnd();
    })
    .filter(Boolean)
    .join("\n" + indent + "  ");
  return `${indent}- [${checked}] ${inner}\n`;
}

function tableToMd(node) {
  const rows = node.content || [];
  if (rows.length === 0) return "";
  const cells = rows.map((row) =>
    (row.content || []).map((cell) => {
      const text = (cell.content || [])
        .map((c) => inlineToMd(c.content || []))
        .join(" ")
        .replace(/\|/g, "\\|")
        .replace(/\n+/g, " ")
        .trim();
      return text || "   ";
    }),
  );
  const cols = Math.max(...cells.map((r) => r.length));
  const pad = (r) => {
    while (r.length < cols) r.push("   ");
    return r;
  };
  const header = pad(cells[0] || []);
  const divider = Array.from({ length: cols }, () => "---");
  const body = cells.slice(1).map(pad);
  const fmt = (r) => `| ${r.join(" | ")} |`;
  return [fmt(header), fmt(divider), ...body.map(fmt)].join("\n");
}

function tiptapJsonToMarkdown(jsonStr) {
  try {
    const json = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
    if (!json || typeof json !== "object") return "";
    const blocks = json.content || [];
    let md = "";
    for (const b of blocks) {
      const chunk = blockToMd(b);
      md += chunk;
      if (!chunk.endsWith("\n\n")) md += "\n";
    }
    md = md.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    return md;
  } catch {
    return "";
  }
}

// ---------- 工具 ----------

function resolveDbPath(cliPath) {
  if (cliPath) return path.resolve(cliPath);
  if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH);
  return path.resolve(__dirname, "..", "backend", "data", "nowen-note.db");
}

function backupDb(dbPath) {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const bak = `${dbPath}.${stamp}.bak`;
  fs.copyFileSync(dbPath, bak);
  return bak;
}

function ellipsize(s, n = 80) {
  if (!s) return "";
  const oneLine = String(s).replace(/\s+/g, " ");
  return oneLine.length <= n ? oneLine : oneLine.slice(0, n - 1) + "…";
}

function confirmInteractive(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

// ---------- 回滚流程 ----------

async function runRollback(args) {
  const dbPath = resolveDbPath(args.db);
  const backupPath = path.resolve(args.rollback);

  if (!fs.existsSync(backupPath)) {
    console.error(`[x] 备份文件不存在: ${backupPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`[x] 数据库文件不存在: ${dbPath}`);
    process.exit(1);
  }

  const backupStat = fs.statSync(backupPath);
  const dbStat = fs.statSync(dbPath);

  console.log(`[i] 即将用备份覆盖数据库：`);
  console.log(`      backup : ${backupPath}  (${backupStat.size} bytes, ${backupStat.mtime.toISOString()})`);
  console.log(`      target : ${dbPath}  (${dbStat.size} bytes, ${dbStat.mtime.toISOString()})`);
  console.log(`[!] 此操作**不可逆**，请务必先停止后端服务。`);

  if (!args.yes) {
    const ok = await confirmInteractive("确认继续回滚？(y/N) ");
    if (!ok) {
      console.log("[i] 已取消。");
      return;
    }
  }

  // 回滚前再次备份一份当前 DB（以防"回滚之前就已经改过"的情况）
  const safetyBak = backupDb(dbPath);
  console.log(`[i] 当前数据库已保存为安全副本：${safetyBak}`);

  fs.copyFileSync(backupPath, dbPath);
  console.log(`[✓] 回滚完成：已用 ${path.basename(backupPath)} 覆盖数据库。`);
}

// ---------- 迁移流程 ----------

async function runMigrate(args) {
  const dbPath = resolveDbPath(args.db);
  if (!fs.existsSync(dbPath)) {
    console.error(`[x] 数据库文件不存在: ${dbPath}`);
    process.exit(1);
  }
  console.log(`[i] DB: ${dbPath}`);
  console.log(`[i] mode: ${args.dryRun ? "DRY-RUN" : "APPLY"}`);
  if (args.limit > 0) console.log(`[i] limit: ${args.limit}`);
  if (args.ids?.length) console.log(`[i] ids: ${args.ids.join(",")}`);

  if (!args.dryRun) {
    const bak = backupDb(dbPath);
    console.log(`[i] 已生成备份: ${bak}`);
    console.log(`[i] 若需回滚：node scripts/migrate-tiptap-to-md.mjs --rollback "${bak}"`);
  }

  const db = new Database(dbPath);

  try {
    let query = "SELECT id, title, content FROM notes";
    const params = [];
    if (args.ids?.length) {
      query += ` WHERE id IN (${args.ids.map(() => "?").join(",")})`;
      params.push(...args.ids);
    }
    query += " ORDER BY updatedAt DESC";
    if (args.limit > 0) query += ` LIMIT ${args.limit}`;

    const rows = db.prepare(query).all(...params);
    console.log(`[i] 待扫描笔记: ${rows.length}`);

    const stats = {
      total: rows.length,
      skippedEmpty: 0,
      skippedMd: 0,
      skippedHtml: 0,
      converted: 0,
      convertFailed: 0,
    };

    const patches = [];

    for (const row of rows) {
      const fmt = detectFormat(row.content);
      if (fmt === "empty") {
        stats.skippedEmpty++;
        if (args.verbose) console.log(`  [skip-empty] ${row.id} ${ellipsize(row.title, 40)}`);
        continue;
      }
      if (fmt === "md") {
        stats.skippedMd++;
        if (args.verbose) console.log(`  [skip-md]    ${row.id} ${ellipsize(row.title, 40)}`);
        continue;
      }
      if (fmt === "html") {
        stats.skippedHtml++;
        if (args.verbose) console.log(`  [skip-html]  ${row.id} ${ellipsize(row.title, 40)}`);
        continue;
      }
      // tiptap-json
      const md = tiptapJsonToMarkdown(row.content);
      if (!md) {
        stats.convertFailed++;
        console.warn(`  [x fail]     ${row.id} ${ellipsize(row.title, 40)}  (转换返回空)`);
        continue;
      }
      stats.converted++;
      patches.push({ id: row.id, md });
      if (args.verbose) {
        console.log(`  [+ convert]  ${row.id} ${ellipsize(row.title, 40)}`);
        console.log(`    before: ${ellipsize(row.content, 100)}`);
        console.log(`    after : ${ellipsize(md, 100)}`);
      }
    }

    console.log("\n========== 预检摘要 ==========");
    console.log(`total         : ${stats.total}`);
    console.log(`skipped(empty): ${stats.skippedEmpty}`);
    console.log(`skipped(md)   : ${stats.skippedMd}`);
    console.log(`skipped(html) : ${stats.skippedHtml}`);
    console.log(`will write    : ${stats.converted}`);
    console.log(`failed        : ${stats.convertFailed}`);
    console.log("==============================\n");

    if (args.dryRun) {
      console.log("[i] DRY-RUN：未写入。若结果符合预期，请加 --apply 重跑。");
      return;
    }

    if (patches.length === 0) {
      console.log("[i] 无需写入。");
      return;
    }

    // 整批单事务写入：确保原子性（要么全成功，要么全回滚）
    const update = db.prepare("UPDATE notes SET content = ? WHERE id = ?");
    const applyTx = db.transaction((ps) => {
      let done = 0;
      for (const p of ps) {
        update.run(p.md, p.id);
        done++;
        if (done % 100 === 0) {
          console.log(`  ... 已写入 ${done}/${ps.length}`);
        }
      }
    });

    try {
      applyTx(patches);
      console.log(`[✓] 已写入 ${patches.length} 条（单事务，已原子提交）。`);
    } catch (err) {
      console.error("[x] 事务写入失败，已自动回滚：", err);
      console.error("    可用 --rollback 恢复刚才创建的 .bak 备份。");
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

// ---------- 入口 ----------

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (args.rollback) {
    await runRollback(args);
    return;
  }
  await runMigrate(args);
}

main().catch((err) => {
  console.error("[x] 未捕获异常：", err);
  process.exit(1);
});
