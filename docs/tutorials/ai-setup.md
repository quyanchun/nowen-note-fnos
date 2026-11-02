# 如何配置 AI 服务商

> 让 AI 成为你的写作助手、笔记总结员和知识管理员。

---

## 支持的 AI 服务商

nowen-note 支持 6 个 AI 服务商：

| 服务商 | 模型示例 | 需要 API Key | 国内访问 |
|---|---|---|---|
| 通义千问 | qwen-plus / qwen-max | ✅ | ✅ 直连 |
| OpenAI | GPT-4o / GPT-4 | ✅ | ⚠️ 需代理 |
| Google Gemini | Gemini Pro | ✅ | ⚠️ 需代理 |
| DeepSeek | DeepSeek-V3 / R1 | ✅ | ✅ 直连 |
| 豆包（火山引擎） | doubao-pro | ✅ | ✅ 直连 |
| Ollama | 各种开源模型 | ❌ 本地运行 | ✅ 无需网络 |

---

## 配置步骤

### 步骤一：打开 AI 设置

1. 点击左侧导航栏的 ⚙️ 设置图标
2. 在设置面板中选择「AI 设置」

[截图：设置面板中的 AI 设置入口]

### 步骤二：选择服务商

1. 在「AI 服务商」下拉框中选择服务商
2. 系统会自动填入默认的 API 地址

[截图：服务商选择下拉框]

### 步骤三：填写 API Key

1. 在对应服务商的控制台获取 API Key
2. 将 API Key 粘贴到对应输入框
3. API Key 保存在本地，不会上传到其他服务器

[截图：API Key 输入框]

### 步骤四：选择模型

1. 填入 API Key 后，系统自动加载可用模型列表
2. 从下拉框中选择模型

[截图：模型选择下拉框]

### 步骤五：测试连接

1. 点击「测试连接」按钮
2. 看到「连接成功」即可使用

---

## 各服务商配置指南

### 通义千问（推荐国内用户）

1. 访问 [阿里云百炼平台](https://bailian.console.aliyun.com/)
2. 在「API-KEY 管理」中创建 API Key
3. 在 nowen-note 中选择「通义千问」，粘贴 Key
4. 推荐模型：`qwen-plus`（性价比高）

### OpenAI

1. 访问 [OpenAI Platform](https://platform.openai.com/)
2. 在 API Keys 中创建 Key
3. 在 nowen-note 中选择「OpenAI」，粘贴 Key
4. 推荐模型：`gpt-4o`

> ⚠️ 国内需要代理。可在「API 地址」中填入代理地址。

### DeepSeek

1. 访问 [DeepSeek Platform](https://platform.deepseek.com/)
2. 创建 API Key
3. 推荐模型：`deepseek-chat`（即 V3）

### 豆包（火山引擎）

1. 访问 [火山引擎控制台](https://console.volcengine.com/)
2. 开通豆包大模型服务，创建 API Key

### Google Gemini

1. 访问 [Google AI Studio](https://aistudio.google.com/)
2. 获取 API Key

### Ollama（本地部署，无需 API Key）

Ollama 在本地电脑上运行 AI 模型，不需要联网。

**安装：**

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows：从 https://ollama.com/download 下载安装包
```

**下载模型：**

```bash
ollama pull qwen2.5:7b    # 推荐，约 4GB
ollama pull qwen2.5:3b    # 更轻量，约 2GB
ollama pull qwen2.5:14b   # 更强，约 13GB
```

**配置：**

1. 确保 Ollama 正在运行
2. 在 AI 设置中选择「Custom / Ollama」
3. API 地址：`http://localhost:11434/v1`
4. 无需 API Key，选择模型即可

---

## AI 功能一览

配置好 AI 后可以使用以下功能：

### 编辑器中的 AI

| 功能 | 入口 | 说明 |
|---|---|---|
| 生成标题 | 工具栏 → AI → 生成标题 | 根据内容自动生成 |
| 推荐标签 | 工具栏 → AI → 推荐标签 | 分析内容推荐标签 |
| AI 总结 | 工具栏 → AI → AI 总结 | 生成内容摘要 |
| 写作助手 | 输入 `/AI` 或工具栏 AI 图标 | 续写、改写、翻译 |

### 笔记列表中的 AI 批量操作

| 功能 | 入口 | 说明 |
|---|---|---|
| 批量 AI 标签 | 多选笔记 → 右键 → AI 标签 | 为多篇笔记生成标签 |
| AI 批量归类 | 多选笔记 → 右键 → AI 归类 | AI 建议移动到哪个笔记本 |

### AI 知识库问答

| 功能 | 入口 | 说明 |
|---|---|---|
| AI 问答 | 左侧导航栏「AI 问答」 | 基于笔记内容的 RAG 问答 |

---

## 常见问题

### Q：配置了 AI 但没有生效？

1. 确认 API Key 填写正确
2. 点击「测试连接」检查连通性
3. 检查网络（国内推荐通义千问或 DeepSeek）

### Q：Ollama 启动后还是不工作？

1. 确认 Ollama 正在运行（终端执行 `ollama list`）
2. 确认 API 地址正确（`http://localhost:11434/v1`）
3. 确认已下载模型（`ollama pull qwen2.5:7b`）

### Q：AI 回复很慢？

- 本地 Ollama 速度取决于电脑性能
- 云端 API 速度取决于网络
- 推荐用较小模型获得更快响应

### Q：API Key 安全吗？

API Key 保存在本地浏览器 localStorage 中，不上传到服务器。自托管部署数据完全在你的控制下。

---

> 本教程基于 nowen-note v1.1.18 编写。
