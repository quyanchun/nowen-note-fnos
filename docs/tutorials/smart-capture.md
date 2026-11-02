# 文本智能收集 API

> 2026-10-28：NAS已新增 [剪贴板专用单Token入口](clipboard-integration.md)，无需飞牛Cookie。下文原 `/api/captures` 的JWT/PAT与飞牛网关认证方式继续保留。

电脑端或其他调用方提交文本，接收请求的笔记服务先持久化原文，后台使用该账号已配置的 AI 整理并判断创建或追加。支持新建多级文件夹、在已有文件夹中新建笔记、在已有笔记末尾追加。无需 MCP；客户端无需持有模型 Key。当前仅处理个人空间文本，不读取剪贴板，不修改现有笔记的格式或原有正文。

## 授权和 NAS 地址

使用登录 JWT，或在「设置 → 访问令牌」创建专用 PAT，选择 `notes:read`、`notes:write`、`notebooks:read`。需要创建文件夹时，再选择 `notebooks:write`。建议限定到收集目录，选择写权限及「包含子目录」。受限 PAT 不能在个人根级创建目录；如果只授权某一层且不含子目录，就只能直接向该层已有目录/笔记写入。

NAS 仍使用既有前缀，例如 `https://nas.example.test/app/nowen-note-private/api/captures`。**飞牛网关登录与笔记 PAT 是两层授权**：域名调用还必须带有效的飞牛会话，NAS 关联账号的 PAT 必须匹配当前飞牛 UID。匿名请求、跨 NAS 身份或已撤销 PAT 均拒绝。此功能没有新增 NAS 入口、反代或监听端口，不提供绕过飞牛登录的匿名 Webhook。后续客户端需要复用自己的飞牛授权会话；本次不更改桌面端的同步登录桥。

以下 `BASE` 是包含 `/api` 的服务地址。示例中的 `NAS_COOKIE_JAR` 代表调用方通过正常登录得到的私有会话文件；Cookie 和 Token 不应写进代码、日志或仓库。

## 提交和查询

```sh
curl "$BASE/captures" \
  --cookie "$NAS_COOKIE_JAR" \
  -H "Authorization: Bearer $CAPTURE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @capture.json
```

`capture.json`：

```json
{
  "requestId": "由调用方生成且重试时保持不变的唯一编号",
  "content": "零散的笔记文本……",
  "organize": true,
  "instruction": "保留数字和链接，按主题整理并归档"
}
```

可选 `notebookId` 限定到该文件夹及其子目录；可选 `noteId` 指定必须追加的笔记，两者同时传时必须匹配目录范围。`organize=false` 时新增正文使用提交原文；服务端的正常区块锚点规范化仍会发生。文本非空且最多 32000 字符，`instruction` 最多 2000 字符。

首次返回 HTTP 202，含 `id` 和 `status=queued`。此时只确认原文已保存，不能表示笔记已完成入库。用同样的认证查询：

```sh
curl "$BASE/captures/$CAPTURE_ID" \
  --cookie "$NAS_COOKIE_JAR" \
  -H "Authorization: Bearer $CAPTURE_TOKEN"
```

状态为 `queued`、`processing`、`completed` 或 `failed`。成功结果示例：

```json
{
  "id": "任务ID",
  "requestId": "提交时的编号",
  "status": "completed",
  "originalContent": "逐字保留的提交原文",
  "result": {
    "action": "append",
    "noteId": "保存笔记ID",
    "notebookId": "所在文件夹ID",
    "version": 3,
    "path": "技术 / 数据库 / PostgreSQL索引调优",
    "content": "本次整理后的新增正文"
  },
  "errorCode": null
}
```

`completed` 与笔记正文在同一数据库事务内提交，说明接收服务持久化了该版本；不代表第二设备已下载。原文与任务保存在接收服务数据库中，通过查询接口读取并纳入完整数据库备份；原文不作为笔记正文复制到所有客户端。整理后的笔记沿用现有索引、知识树、历史与 Sync V2 链路。

## 自动判断和失败恢复

- 优先使用已有合适目录；与已有笔记直接相关的补充可追加，否则新建独立笔记。无明确主题时可创建收集箱。AI 是语义判断，建议对实际常用资料持续抽查。
- 模型只收到当前授权范围内的候选目录及笔记摘要；最多 100 个目录和 30 条笔记摘要。密码保护目录、加密笔记/加密区块、已删除/归档/锁定笔记不进入候选。实际保存前再次校验权限，Token 撤销或授权变化不能继续写入。
- Markdown 和纯文本末尾追加。HTML 将新增文本转义后追加；富文本保留全部现有节点，新增标题与文本段落。新增文本中的复杂 Markdown 表格、列表、代码语法在 HTML/富文本中不保证转换成对应结构。
- 相同账号的同一个 `requestId` 加相同输入返回原任务（HTTP 200），不会重复创建或追加；相同编号配不同输入返回 409。每个用户最多 100 个待处理任务。
- AI 不可用、返回无效方案、权限不足、并发版本冲突等情况返回 `failed` 和稳定 `errorCode`，原文保留。不会覆盖并发编辑。服务重启恢复未完成任务；已经提交的任务不再执行。
- 失败任务通过 `POST /api/captures/{id}/retry` 重试，重新校验原授权。已生成的有效方案会复用；没有有效方案时重新请求模型。已创建的路径会复用；目录创建与最后的笔记写入属于不同事务，后续失败时可能保留已创建的空目录。若要修改原文或归档要求，使用新的 `requestId`；已完成或正在处理的任务不能重试。渠道临时 429/5xx 或连接故障在写入前最多重试两次。

## 验证

隔离 API/模型回归：在 `backend` 目录运行 `node --import tsx --import ./tests/setup-db-isolation.ts --test tests/captures.test.ts`。

完整服务与真实模型验收：准备权限为 0600 的 JSON 文件，包含该账号的 `ai_provider`、`ai_api_url`、`ai_api_key`、`ai_custom_headers`、`ai_model`。运行 `NOWEN_CAPTURE_LIVE_CONFIG=/private/path/config.json NOWEN_CAPTURE_REPORT=/private/path/report.json node --import tsx scripts/verify-captures-http.ts`。脚本使用独立数据库、合成测试文本和临时账号，通过实际登录、签发 PAT、提交和轮询验证，不改用户现有笔记。
