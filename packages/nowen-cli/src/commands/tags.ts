import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import { getClient } from "../cli.js";

export function registerTagsCommands(program: Command) {
  const tags = program
    .command("tags")
    .description("标签管理");

  // nowen tags list
  tags
    .command("list")
    .description("列出所有标签")
    .action(async () => {
      const spinner = ora("加载标签...").start();
      try {
        const client = getClient();
        const list = await client.request("/api/tags");
        spinner.stop();

        if (list.length === 0) {
          console.log(chalk.yellow("暂无标签"));
          return;
        }

        const table = new Table({
          head: [chalk.cyan("ID"), chalk.cyan("名称"), chalk.cyan("颜色"), chalk.cyan("笔记数")],
          colWidths: [10, 20, 10, 10],
        });

        for (const tag of list) {
          table.push([
            tag.id.slice(0, 8),
            `#${tag.name}`,
            tag.color || "—",
            tag.noteCount || 0,
          ]);
        }

        console.log(table.toString());
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });

  // nowen tags create <name>
  tags
    .command("create <name>")
    .description("创建标签")
    .option("-c, --color <hex>", "颜色", "#58a6ff")
    .action(async (name, opts) => {
      const spinner = ora("创建标签...").start();
      try {
        const client = getClient();
        const tag = await client.request("/api/tags", {
          method: "POST",
          body: { name, color: opts.color },
        });
        spinner.succeed(chalk.green(`标签创建成功: #${tag.name}`));
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });
}
