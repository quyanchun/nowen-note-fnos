import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import { getClient } from "../cli.js";

export function registerNotebooksCommands(program: Command) {
  const notebooks = program
    .command("notebooks")
    .description("笔记本管理");

  // nowen notebooks list
  notebooks
    .command("list")
    .description("列出所有笔记本")
    .action(async () => {
      const spinner = ora("加载笔记本...").start();
      try {
        const client = getClient();
        const list = await client.request("/api/notebooks");
        spinner.stop();

        if (list.length === 0) {
          console.log(chalk.yellow("暂无笔记本"));
          return;
        }

        const table = new Table({
          head: [chalk.cyan("ID"), chalk.cyan("名称"), chalk.cyan("图标"), chalk.cyan("笔记数")],
          colWidths: [10, 25, 8, 10],
        });

        for (const nb of list) {
          table.push([
            nb.id.slice(0, 8),
            nb.name,
            nb.icon || "📒",
            nb.noteCount || 0,
          ]);
        }

        console.log(table.toString());
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });

  // nowen notebooks create
  notebooks
    .command("create <name>")
    .description("创建笔记本")
    .option("-i, --icon <emoji>", "图标", "📒")
    .option("-p, --parent <id>", "父笔记本 ID")
    .action(async (name, opts) => {
      const spinner = ora("创建笔记本...").start();
      try {
        const client = getClient();
        const nb = await client.request("/api/notebooks", {
          method: "POST",
          body: { name, icon: opts.icon, parentId: opts.parent },
        });
        spinner.succeed(chalk.green(`笔记本创建成功: ${nb.name} (${nb.id.slice(0, 8)})`));
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });

  // nowen notebooks delete <id>
  notebooks
    .command("delete <id>")
    .description("删除笔记本")
    .action(async (id) => {
      const spinner = ora("删除笔记本...").start();
      try {
        const client = getClient();
        await client.request(`/api/notebooks/${id}`, { method: "DELETE" });
        spinner.succeed(chalk.green("笔记本已删除"));
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });
}
