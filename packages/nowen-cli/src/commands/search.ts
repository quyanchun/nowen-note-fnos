import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../cli.js";

export function registerSearchCommand(program: Command) {
  program
    .command("search <query>")
    .description("全文搜索笔记")
    .action(async (query) => {
      const spinner = ora(`搜索 "${query}"...`).start();
      try {
        const client = getClient();
        const results = await client.request("/api/search", { query: { q: query } });
        spinner.stop();

        if (results.length === 0) {
          console.log(chalk.yellow("未找到相关笔记"));
          return;
        }

        console.log(chalk.bold(`找到 ${results.length} 条结果:\n`));
        for (const r of results) {
          console.log(chalk.bold.blue(`  📝 ${r.title || "无标题"}`) + chalk.gray(` (${r.id.slice(0, 8)})`));
          if (r.snippet) {
            console.log(chalk.gray(`     ${r.snippet.slice(0, 80)}`));
          }
          console.log();
        }
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });
}
