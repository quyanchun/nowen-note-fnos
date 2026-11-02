# CLI 工具使用教程

> 用命令行快速操作 nowen-note 笔记库。

---

## 安装

```bash
cd packages/nowen-cli
npm install
npm run build
```

---

## 配置

首次使用需要配置服务器地址和凭据：

```bash
npx nowen-cli config set --url http://localhost:3001 --username admin --password admin123
```

---

## 命令一览

### 笔记本

```bash
nowen-cli notebooks list          # 列出笔记本
nowen-cli notebooks create <名称>  # 创建笔记本
```

### 笔记

```bash
nowen-cli notes list              # 列出笔记
nowen-cli notes get <id>          # 获取笔记
nowen-cli notes create <标题>     # 创建笔记
nowen-cli notes update <id>       # 更新笔记
nowen-cli notes delete <id>       # 删除笔记
```

### 搜索

```bash
nowen-cli search <关键词>         # 搜索笔记
```

### 标签

```bash
nowen-cli tags list               # 列出标签
```

### 任务

```bash
nowen-cli tasks list              # 列出任务
nowen-cli tasks create <标题>     # 创建任务
```

### AI

```bash
nowen-cli ai ask <问题>           # 知识库问答
```

---

## 使用示例

### 创建笔记

```bash
nowen-cli notes create "学习笔记" --notebook "学习" --content "今天学习了 React"
```

### 搜索笔记

```bash
nowen-cli search "React useEffect"
```

### AI 问答

```bash
nowen-cli ai ask "什么是 useMemo？"
```

---

## 脚本化使用

CLI 工具可以集成到自动化脚本中：

```bash
#!/bin/bash
# 每天自动创建日记
DATE=$(date +%Y-%m-%d)
nowen-cli notes create "$DATE 日记" --notebook "日记"
```

---

## 下一步

- [OpenAPI 接入指南](./api.md) — REST API
- [SDK 使用教程](./sdk.md) — TypeScript SDK
- [MCP Server 教程](./mcp.md) — AI 集成

---

> 本教程基于 nowen-note v1.1.18 编写。
