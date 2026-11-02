import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../cli.js";

export function registerConfigCommand(program: Command) {
  program
    .command("config")
    .description("显示当前连接配置")
    .action(async () => {
      const url = process.env.NOWEN_URL || "http://localhost:3001";
      const user = process.env.NOWEN_USERNAME || "admin";

      console.log(chalk.bold("⚙️  Nowen CLI 配置:\n"));
      console.log(`  服务地址: ${chalk.cyan(url)}`);
      console.log(`  用户名:   ${chalk.cyan(user)}`);
      console.log(`  密码:     ${chalk.gray("***")}`);
      console.log();
      console.log(chalk.gray("通过环境变量修改配置:"));
      console.log(chalk.gray("  NOWEN_URL=http://your-server:3001"));
      console.log(chalk.gray("  NOWEN_USERNAME=your-username"));
      console.log(chalk.gray("  NOWEN_PASSWORD=your-password"));

      // 测试连接
      const spinner = ora("测试连接...").start();
      try {
        const client = getClient();
        const result = await client.request("/api/auth/verify");
        spinner.succeed(chalk.green(`连接成功! 用户: ${result.username}`));
      } catch (err: any) {
        spinner.fail(chalk.red(`连接失败: ${err.message}`));
      }
    });

  program
    .command("health")
    .description("检查服务健康状态")
    .action(async () => {
      const url = process.env.NOWEN_URL || "http://localhost:3001";
      const spinner = ora(`检查 ${url}...`).start();
      try {
        const res = await fetch(`${url}/api/health`);
        const data = await res.json() as { status: string; version: string };
        spinner.succeed(chalk.green(`服务正常 — 状态: ${data.status} | 版本: ${data.version}`));
      } catch (err: any) {
        spinner.fail(chalk.red(`服务不可达: ${err.message}`));
      }
    });
}
