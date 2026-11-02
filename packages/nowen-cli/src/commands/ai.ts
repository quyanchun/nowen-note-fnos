import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../cli.js";

export function registerAICommands(program: Command) {
  const ai = program
    .command("ai")
    .description("AI 功能");

  // nowen ai ask <question>
  ai
    .command("ask <question>")
    .description("知识库问答")
    .action(async (question) => {
      const spinner = ora("AI 思考中...").start();
      try {
        const client = getClient();
        const { text, metadata } = await client.readSSE("/api/ai/ask", { question });
        spinner.stop();

        console.log(chalk.bold.blue("🤖 AI 回答:\n"));
        console.log(text);

        if (metadata && metadata.length > 0) {
          console.log(chalk.gray("\n📌 参考笔记:"));
          for (const ref of metadata) {
            console.log(chalk.gray(`  • ${ref.title} (${ref.id.slice(0, 8)})`));
          }
        }
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });

  // nowen ai process
  ai
    .command("process")
    .description("AI 文本处理")
    .requiredOption("-a, --action <action>", "处理类型 (polish/rewrite/summarize/translate_en/translate_zh/expand/shorten/fix_grammar/format_markdown)")
    .requiredOption("-t, --text <text>", "要处理的文本")
    .option("-p, --prompt <prompt>", "自定义指令（action=custom 时使用）")
    .action(async (opts) => {
      const spinner = ora(`执行 ${opts.action}...`).start();
      try {
        const client = getClient();
        const { text } = await client.readSSE("/api/ai/chat", {
          action: opts.action,
          text: opts.text,
          customPrompt: opts.prompt,
        });
        spinner.stop();

        console.log(chalk.bold.blue(`✨ ${opts.action} 结果:\n`));
        console.log(text);
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });

  // nowen ai stats
  ai
    .command("stats")
    .description("知识库统计")
    .action(async () => {
      try {
        const client = getClient();
        const stats = await client.request("/api/ai/knowledge-stats");
        console.log(chalk.bold("📊 知识库统计:"));
        console.log(`  笔记数: ${chalk.bold(stats.totalNotes || 0)}`);
        console.log(`  笔记本: ${chalk.bold(stats.totalNotebooks || 0)}`);
        console.log(`  标签: ${chalk.bold(stats.totalTags || 0)}`);
        console.log(`  FTS 索引: ${stats.ftsEnabled ? chalk.green("已启用") : chalk.red("未启用")}`);
      } catch (err: any) {
        console.error(chalk.red(err.message));
      }
    });

  // nowen ai models
  ai
    .command("models")
    .description("列出可用 AI 模型")
    .action(async () => {
      const spinner = ora("获取模型列表...").start();
      try {
        const client = getClient();
        const models = await client.request("/api/ai/models");
        spinner.stop();

        if (Array.isArray(models) && models.length > 0) {
          console.log(chalk.bold("🤖 可用模型:"));
          for (const m of models) {
            const name = typeof m === "string" ? m : m.id || m.name;
            console.log(`  • ${name}`);
          }
        } else {
          console.log(chalk.yellow("未找到可用模型，请检查 AI 服务配置"));
        }
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });
}
