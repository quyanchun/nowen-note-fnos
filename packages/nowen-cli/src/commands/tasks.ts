import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import { getClient } from "../cli.js";

export function registerTasksCommands(program: Command) {
  const tasks = program
    .command("tasks")
    .description("任务管理");

  // nowen tasks list
  tasks
    .command("list")
    .description("列出任务")
    .option("-s, --status <status>", "按状态筛选 (todo/doing/done)")
    .option("-p, --priority <priority>", "按优先级筛选 (low/medium/high)")
    .action(async (opts) => {
      const spinner = ora("加载任务...").start();
      try {
        const client = getClient();
        const query: Record<string, string | undefined> = {};
        if (opts.status) query.status = opts.status;
        if (opts.priority) query.priority = opts.priority;

        const list = await client.request("/api/tasks", { query });
        spinner.stop();

        if (list.length === 0) {
          console.log(chalk.yellow("暂无任务"));
          return;
        }

        const statusIcons: Record<string, string> = { todo: "⬜", doing: "🔵", done: "✅" };
        const priorityColors: Record<string, typeof chalk> = {
          high: chalk.red, medium: chalk.yellow, low: chalk.gray,
        };

        const table = new Table({
          head: [chalk.cyan("状态"), chalk.cyan("标题"), chalk.cyan("优先级"), chalk.cyan("截止日期")],
          colWidths: [8, 30, 10, 14],
        });

        for (const task of list) {
          const pColor = priorityColors[task.priority] || chalk.white;
          table.push([
            statusIcons[task.status] || "⬜",
            (task.title || "").slice(0, 28),
            pColor(task.priority),
            task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—",
          ]);
        }

        console.log(table.toString());
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });

  // nowen tasks stats
  tasks
    .command("stats")
    .description("任务统计")
    .action(async () => {
      try {
        const client = getClient();
        const stats = await client.request("/api/tasks/stats/summary");
        console.log(chalk.bold("📊 任务统计:"));
        console.log(`  总计: ${chalk.bold(stats.total)}`);
        console.log(`  待做: ${chalk.yellow(stats.todo)}  进行中: ${chalk.blue(stats.doing)}  已完成: ${chalk.green(stats.done)}`);
        if (stats.overdue > 0) {
          console.log(`  ${chalk.red(`⚠ 逾期: ${stats.overdue}`)}`);
        }
      } catch (err: any) {
        console.error(chalk.red(err.message));
      }
    });

  // nowen tasks create
  tasks
    .command("create <title>")
    .description("创建任务")
    .option("-p, --priority <priority>", "优先级 (low/medium/high)", "medium")
    .option("-d, --due <date>", "截止日期 YYYY-MM-DD")
    .action(async (title, opts) => {
      const spinner = ora("创建任务...").start();
      try {
        const client = getClient();
        const task = await client.request("/api/tasks", {
          method: "POST",
          body: { title, priority: opts.priority, dueDate: opts.due },
        });
        spinner.succeed(chalk.green(`任务创建成功: ${task.title}`));
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
      }
    });

  // nowen tasks toggle <id>
  tasks
    .command("toggle <id>")
    .description("切换任务完成状态")
    .action(async (id) => {
      try {
        const client = getClient();
        const task = await client.request(`/api/tasks/${id}/toggle`, { method: "PATCH" });
        const icon = task.status === "done" ? "✅" : "⬜";
        console.log(`${icon} ${task.title} → ${task.status}`);
      } catch (err: any) {
        console.error(chalk.red(err.message));
      }
    });
}
