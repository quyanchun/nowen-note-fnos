# nowen-note 官网教程体系 — 项目分析与教程规划

> 本文档基于 nowen-note v1.1.18 代码分析，为官网教程页面提供完整的规划蓝图。

---

## 第一部分：项目分析

### 1. nowen-note 是什么？

自托管的私有知识库，对标群晖 Note Station。支持 Web / Electron 桌面端 / Android 移动端 / 鸿蒙。

### 2. 技术栈

React 18 · TypeScript · Vite 5 · Tiptap 3 · Tailwind · Hono 4 · SQLite(FTS5) · JWT · Electron 33 · Capacitor 8

### 3. 面向用户

- 个人知识管理者（替代印象笔记/Notion）
- 小团队协作用户
- 群晖/绿联/NAS 用户（私有化部署）
- 技术开发者（有 OpenAPI/MCP/SDK）

### 4. 核心功能地图

| 模块 | 功能 | 代码确认 |
|---|---|---|
| **笔记编辑** | 富文本编辑（Tiptap 3） | ✅ |
| | Markdown 模式（CodeMirror 6） | ✅ |
| | 双模式切换 | ✅ |
| | 代码块高亮 | ✅ |
| | 数学公式（KaTeX） | ✅ |
| | Mermaid 图表 | ✅ |
| | 表格（可拖拽行高） | ✅ |
| | 脚注 | ✅ |
| | 视频嵌入 | ✅ |
| | 斜杠命令 | ✅ |
| **文档树** | 无限层级笔记本 | ✅ |
| | 拖拽排序/移动 | ✅ |
| | Emoji 图标 | ✅ |
| | 折叠/展开 | ✅ |
| **笔记管理** | 笔记列表/排序/筛选 | ✅ |
| | 收藏/置顶/锁定 | ✅ |
| | 回收站 + 恢复 | ✅ |
| | 版本历史 | ✅ |
| | 导出（Markdown/PDF/图片/Word） | ✅ |
| | 批量操作 | ✅ |
| **标签** | 彩色标签 + AI 自动标签 | ✅ |
| **搜索** | FTS5 全文搜索 + 高亮 | ✅ |
| **AI** | AI 配置（6+ 服务商） | ✅ |
| | AI 写作/标题/标签/总结/思维导图 | ✅ |
| | AI 知识库问答（RAG） | ✅ |
| | AI 批量标签/归类 | ✅ |
| **思维导图** | 节点式编辑器 + 笔记生成 + PNG 导出 | ✅ |
| **说说** | 时间线式短内容 | ✅ |
| **待办任务** | 任务清单 + 看板 | ✅ |
| **文件管理** | 文件管理器 + 图片缩略图 + 孤儿清理 | ✅ |
| **协作** | 工作区 + 邀请码 + 角色权限 + 分享 + 实时协同 | ✅ |
| **附件** | 上传管理 + 对象存储(S3/R2/MinIO) + 健康检查 | ✅ |
| **自动化** | Webhook + 审计日志 + 定时备份 + 邮件 | ✅ |
| **多端** | Web + Electron + Android + 鸿蒙 | ✅ |
| **数据** | 导入（有道/小米/iCloud/OPPO/Word/URL） | ✅ |
| **安全** | JWT + 2FA + 快速登录 + 体验账号 | ✅ |
| **主题** | 暗色/亮色 + 皮肤切换 | ✅ |
| **开发者** | MCP Server + SDK + CLI + 剪藏扩展 + OpenAPI | ✅ |
| **插件** | 沙箱插件系统 | ✅ |

### 5. 现有文档

| 文件 | 内容 |
|---|---|
| docs/deployment.md | 完整部署指南（10 种方式） |
| docs/object-storage.md | 对象存储配置 |
| docs/editor-mode-switch.md | 编辑器模式切换 |
| docs/backup-email-smtp.md | 邮件备份配置 |
| docs/PRIVACY.md | 隐私策略 |
| docs/tree-tutorial.md | 文档树教程（已完成） |

### 6. 当前项目没有独立的官网/文档站点

- 没有静态站点生成器（VitePress/Docusaurus 等）
- 前端是纯 SPA 应用
- 所有教程以 Markdown 形式放在 docs/ 目录
- 建议：教程保持 Markdown 格式，可直接被 GitHub/Gitee 渲染

---

## 第二部分：教程栏目规划

### 教程目录树

```
教程中心
├── 快速开始
│   ├── 01. 5 分钟快速上手 nowen-note
│   ├── 02. 创建你的第一篇笔记
│   ├── 03. 了解 nowen-note 界面
│   └── 04. 在手机上使用 nowen-note
│
├── 笔记管理
│   ├── 05. 文档树 / 笔记本使用教程       ✅ 已完成
│   ├── 06. 标签和收藏使用教程
│   ├── 07. 如何搜索笔记
│   ├── 08. 如何恢复误删内容
│   ├── 09. 笔记排序和批量管理
│   └── 10. 笔记导入和导出
│
├── 编辑器
│   ├── 11. 富文本编辑器使用教程
│   ├── 12. Markdown 编辑器使用教程
│   ├── 13. 斜杠命令和快捷操作
│   ├── 14. 表格、代码块、数学公式教程
│   ├── 15. Mermaid 流程图教程
│   └── 16. 自动保存和版本历史
│
├── AI 功能
│   ├── 17. 如何配置 AI 服务商
│   ├── 18. AI 生成标题和标签
│   ├── 19. AI 总结笔记
│   ├── 20. AI 写作助手使用教程
│   └── 21. AI 知识库问答（RAG）教程
│
├── 思维导图
│   ├── 22. 思维导图模块入门
│   ├── 23. 从笔记生成思维导图
│   └── 24. 思维导图导出和分享
│
├── 协作与分享
│   ├── 25. 工作区（团队空间）使用教程
│   ├── 26. 分享笔记和权限管理
│   └── 27. 实时协作编辑
│
├── 多端使用
│   ├── 28. Web 端使用指南
│   ├── 29. 桌面端（Electron）使用指南
│   ├── 30. Android 移动端使用指南
│   └── 31. 鸿蒙端使用指南
│
├── 附件与文件
│   ├── 32. 附件上传和管理
│   ├── 33. 对象存储（S3/R2）配置
│   └── 34. 文件管理器使用教程
│
├── 部署教程
│   ├── 35. Docker 一键部署
│   ├── 36. NAS 部署（群晖/绿联/飞牛/威联通/极空间）
│   ├── 37. Windows 本地部署
│   └── 38. 数据备份与迁移
│
├── 进阶功能
│   ├── 39. 说说（时间线）使用教程
│   ├── 40. 待办任务使用教程
│   ├── 41. 浏览器剪藏扩展
│   ├── 42. Webhook 自动化
│   └── 43. 安全设置（2FA/快速登录）
│
├── 开发者
│   ├── 44. OpenAPI 接入指南
│   ├── 45. MCP Server 使用教程
│   ├── 46. TypeScript SDK 使用教程
│   └── 47. CLI 工具使用教程
│
└── 常见问题
    ├── 48. 登录和鉴权问题
    ├── 49. 数据同步问题
    ├── 50. 附件和图片问题
    └── 51. 性能和存储问题
```

---

## 第三部分：教程详细规划

### P0 — 最高优先级（第一批写）

| # | 标题 | slug | 目标用户 | 核心内容 |
|---|---|---|---|---|
| 01 | 5 分钟快速上手 nowen-note | /tutorials/quick-start | 新用户 | 安装→登录→创建笔记→创建笔记本→第一篇 AI 总结 |
| 05 | 文档树 / 笔记本使用教程 | /tutorials/tree-tutorial | 普通用户 | **✅ 已完成** |
| 11 | 富文本编辑器使用教程 | /tutorials/editor-rich-text | 普通用户 | 基础编辑、格式、图片、链接、列表、标题 |
| 17 | 如何配置 AI 服务商 | /tutorials/ai-setup | 所有用户 | 支持的 AI 服务商、配置步骤、Ollama 本地部署 |
| 18 | AI 生成标题和标签教程 | /tutorials/ai-title-tags | 普通用户 | 自动生成标题、推荐标签、批量 AI 标签 |
| 22 | 思维导图模块入门 | /tutorials/mindmap-intro | 普通用户 | 创建思维导图、节点编辑、从笔记生成 |

### P1 — 高优先级（第二批写）

| # | 标题 | slug | 目标用户 | 核心内容 |
|---|---|---|---|---|
| 02 | 创建你的第一篇笔记 | /tutorials/first-note | 新用户 | 打开编辑器→输入内容→保存→查看笔记列表 |
| 03 | 了解 nowen-note 界面 | /tutorials/ui-overview | 新用户 | 侧边栏→笔记列表→编辑器→导航栏→设置 |
| 06 | 标签和收藏使用教程 | /tutorials/tags-favorites | 普通用户 | 创建标签、彩色标签、收藏笔记、标签过滤 |
| 07 | 如何搜索笔记 | /tutorials/search | 普通用户 | 全文搜索、搜索结果高亮、搜索替换 |
| 12 | Markdown 编辑器使用教程 | /tutorials/editor-markdown | 技术用户 | Markdown 模式、快捷键、代码高亮、切换 |
| 19 | AI 总结笔记教程 | /tutorials/ai-summary | 普通用户 | 单篇总结、追加到正文、重新生成 |
| 25 | 工作区使用教程 | /tutorials/workspace | 团队用户 | 创建工作区、邀请成员、角色权限、切换空间 |
| 35 | Docker 一键部署 | /tutorials/docker-deploy | 运维用户 | docker-compose、配置、数据持久化 |
| 36 | NAS 部署教程 | /tutorials/nas-deploy | NAS 用户 | 群晖/绿联/飞牛/威联通/极空间 |
| 38 | 数据备份与迁移 | /tutorials/backup-migrate | 运维用户 | 自动备份、手动备份、恢复、跨服务器迁移 |

### P2 — 中等优先级（第三批写）

| # | 标题 | slug | 目标用户 |
|---|---|---|---|
| 04 | 在手机上使用 nowen-note | /tutorials/mobile | 移动用户 |
| 08 | 如何恢复误删内容 | /tutorials/trash-recover | 普通用户 |
| 09 | 笔记排序和批量管理 | /tutorials/batch-manage | 高级用户 |
| 10 | 笔记导入和导出 | /tutorials/import-export | 数据迁移用户 |
| 13 | 斜杠命令和快捷操作 | /tutorials/slash-commands | 普通用户 |
| 14 | 表格、代码块、数学公式 | /tutorials/advanced-blocks | 技术用户 |
| 15 | Mermaid 流程图教程 | /tutorials/mermaid | 技术用户 |
| 16 | 自动保存和版本历史 | /tutorials/version-history | 普通用户 |
| 20 | AI 写作助手教程 | /tutorials/ai-writing | 普通用户 |
| 21 | AI 知识库问答（RAG） | /tutorials/ai-rag | 高级用户 |
| 23 | 从笔记生成思维导图 | /tutorials/mindmap-from-note | 普通用户 |
| 24 | 思维导图导出和分享 | /tutorials/mindmap-export | 普通用户 |
| 26 | 分享笔记和权限管理 | /tutorials/sharing | 协作用户 |
| 27 | 实时协作编辑 | /tutorials/realtime-collab | 协作用户 |
| 28-31 | 多端使用指南 | /tutorials/web/desktop/android/harmony | 各端用户 |
| 32-34 | 附件与文件 | /tutorials/attachments/object-storage/file-manager | 运维/普通用户 |
| 37 | Windows 本地部署 | /tutorials/windows-deploy | 开发用户 |
| 39-43 | 进阶功能 | /tutorials/diary/tasks/clipper/webhook/security | 各功能用户 |
| 44-47 | 开发者教程 | /tutorials/api/mcp/sdk/cli | 开发者 |
| 48-51 | 常见问题 | /tutorials/faq-* | 所有用户 |

---

## 第四部分：SEO 规划

### 每篇教程的 SEO 模板

```
SEO Title: [功能名称]教程 - nowen-note 使用指南
Meta Description: 了解如何使用 nowen-note 的 [功能]。[一句话核心价值]。
Keywords: nowen-note, [功能名], [相关关键词], 私有知识库, 自托管
Slug: /tutorials/[功能英文名]
OpenGraph Title: [功能名称]教程 - [吸引人的副标题]
OpenGraph Description: [详细的 OG 描述]
```

### README 教程导航建议

```markdown
📂 [教程中心](./tutorials/) | [快速上手](./tutorials/quick-start.md) | [文档树](./tree-tutorial.md) | [AI 配置](./tutorials/ai-setup.md) | [部署指南](./deployment.md)
```

---

## 第五部分：实施建议

### 文件组织

```
docs/
├── deployment.md            ← 已有
├── object-storage.md        ← 已有
├── editor-mode-switch.md    ← 已有
├── PRIVACY.md               ← 已有
├── tree-tutorial.md         ← 已完成
├── tutorials/
│   ├── README.md            ← 教程中心索引页
│   ├── quick-start.md       ← P0
│   ├── editor-rich-text.md  ← P0
│   ├── ai-setup.md          ← P0
│   ├── ai-title-tags.md     ← P0
│   ├── mindmap-intro.md     ← P0
│   └── ...（后续教程）
└── screenshots/
    └── tutorial-*.png       ← 教程截图
```

### 写作规范

1. **不要编造功能**：所有功能基于当前真实代码，不确定标注「需要确认」
2. **面向普通用户**：不写技术实现细节，每步操作具体
3. **截图占位**：用 `[截图：描述]` 标记
4. **中文优先**：所有教程先写中文版
5. **SEO 优化**：每篇标题包含核心关键词
6. **链接互通**：教程之间用相对链接互相关联

### 后续步骤

1. ✅ 文档树教程已完成
2. 下一步：写教程中心索引页 \`docs/tutorials/README.md\`
3. 按 P0 优先级逐篇写教程
4. 补充截图
5. 在 README.md 中添加教程中心链接
