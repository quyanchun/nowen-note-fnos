# 剪贴板软件直连笔记服务

NAS28 / Mac34 / EcoPaste build11028 已完成实机验收。EcoPaste 直接使用笔记服务地址和专用 Token，不依赖笔记客户端运行，不包含飞牛登录或本机中转。NAS 负责过滤、整理、新建或追加，并保留入队原文。

## 配置

1. 在笔记 **设置 → 剪贴板集成** 启用并保存。选择 NAS 网关或独立服务，复制提交接口地址与专用 Token。
2. 在 EcoPaste 中填写可独立访问的笔记服务提交地址和 Token 并保存。需要图片时启用“传输图片”，同时在笔记端取消“忽略图片”。相对图片路径还需选择“Markdown 图片根目录”。
3. 点击测试连接。内容直接提交到所配置的 NAS，由 NAS 过滤、整理、自动新建或追加，并保留已入队原文。无需运行 Nowen Note 桌面客户端。

```text
NAS 地址：https://<NAS域名>/app/nowen-note-private/api/clipboard/captures
独立服务：https://<笔记服务域名>/api/clipboard/captures
请求方式：POST
Content-Type：application/json
Authorization：Bearer <从笔记设置复制的Token>

{"requestId":"每次收集生成UUID，重试保持不变","content":"完整原始文本"}
```

NAS `/app/` 网关还要求飞牛会话，收集 Token 不能替代它；当前 EcoPaste 不提供该登录流程，因此请复制笔记设置中“独立服务”的地址。独立笔记服务仅需专用 Token。域名由用户自行配置，产品不内置个人地址。

保留现有 NAS HTTPS、入口和端口，不修改系统 Nginx。设置页两端可以复制相同 NAS 地址和 Token；规则与提示词存于 NAS 当前账号。

## 请求和结果

完整可选请求：

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "content": "PostgreSQL 查询原来850ms，增加索引后120ms。",
  "kind": "text",
  "sourceApp": "浏览器",
  "fileName": "",
  "instruction": "按数据库主题归档，保留耗时数字",
  "organize": true,
  "notebookId": "可选的已有文件夹ID",
  "noteId": "可选的指定追加笔记ID"
}
```

不使用的可选字段省略，不传 `null`。`content` 非空、最多32000字符；不含图片的请求最多160KiB，含图片请求最多18MiB。`organize` 不传时采用设置页配置；`notebookId` 默认采用设置页归档范围，不能越过该范围；`noteId` 强制追加已有笔记。整理要求会与设置页要求合并，系统提示词由NAS设置管理，客户端不能用请求参数修改它。

首次成功返回 **202**，含 `id`、`requestId`、`status=queued` 和 `originalContent`。此时原文已持久化，笔记尚未完成保存。

每1～2秒轮询，使用同一个请求头：

```text
GET https://<笔记服务域名>/api/clipboard/captures/{id}
Authorization: Bearer <Token>
```

状态：`queued`、`processing`、`completed`、`failed`。允许等待数分钟，超时不等于服务端失败。只有 `completed` 才显示「已保存到 NAS」。成功结果包含 `result.action`（`create`/`append`）、`noteId`、`notebookId`、`version`、`path` 和本次新增的 `content`。

`originalContent` 逐字保留提交原文；原文在服务器收集记录中，不自动变成额外笔记。完成收据与笔记正文同事务提交。新建和追加继续走现有知识树、历史和同步链路。

## 过滤

设置页支持：最少字符数、包含任意关键词、排除关键词、排除来源应用、排除扩展名、忽略文件来源、忽略图片来源，以及默认整理方式、整理提示词和系统AI提示词。规则保存后对下一次新收集生效，NAS在调用AI之前过滤。

客户端需提供来源信息：`sourceApp` 为应用完整名称；文件来源传 `kind=file`、图片来源传 `kind=image`，并可传 `fileName`。规则无法识别客户端没有上报的来源。

普通文件上传仍不支持。图片可通过可选 `images` 数组随文本提交，见下节；不是把本机图片路径直接交给 NAS 读取。

被过滤返回 **200**：

```json
{"requestId":"客户端编号","status":"filtered","reasonCode":"IMAGE_FILTERED","duplicate":false}
```

`filtered` 表示忽略，不能提示笔记保存成功。原因包括 `TEXT_TOO_SHORT`、`KEYWORD_NOT_INCLUDED`、`KEYWORD_EXCLUDED`、`APP_EXCLUDED`、`EXTENSION_EXCLUDED`、`FILE_FILTERED`、`IMAGE_FILTERED`。被过滤内容不进入模型，也不保存为笔记或原文收集任务。

可用 `GET /api/clipboard/policy` 读取过滤规则和文本上限，认证相同；不返回模型密钥、Token 或系统提示词。NAS仍执行过滤，不能只依赖客户端预过滤。

## 可选AI过滤（NAS已安装并验收）

设置页把过滤分成“规则过滤”和“启用 AI 过滤”。默认关闭AI过滤，旧配置继续只按规则处理。启用时必须填写单独的“AI过滤提示词”，例如：

```text
只收集软件开发、数据库和NAS运维知识，忽略广告、验证码、生活购物和闲聊。
```

规则先执行，命中忽略时直接返回200/filtered，不调用AI。规则通过且AI过滤启用时，先持久化原文并返回202，后台AI判断后再决定是否整理归档：

- AI允许：继续整理和新建/追加，最终completed。
- AI拒绝：查询最终返回 `status=filtered`、`reasonCode=AI_FILTERED`、`result=null`，不创建笔记，原文仍在该任务的originalContent中。
- AI异常或判断格式无效：最终failed，原文保留，可用原任务retry；不会将异常视作允许收集。临时429/5xx或连接故障最多自动重试两次。

客户端须同时处理“提交时filtered”和“轮询后filtered”，不能将filtered提示为笔记保存成功。已经入队的任务使用提交时的提示词快照；重发同一编号不重新判断，已经通过的AI判断在后续整理失败重试时复用。设置页的系统AI提示词用于整理，是否收集由单独的AI过滤提示词判断。策略接口返回aiFilterEnabled，不返回AI过滤提示词。

设置页压缩了间距与文本框高度，把规则说明收进问号提示，并将整理提示词并排显示；问号支持悬浮和键盘聚焦。

此前 AI 过滤版本的本地、最终镜像各14组真实模型与NAS11项验收通过，见 [AI过滤验收记录](../qa/clipboard-ai-filter-20261028/验收记录.md)。

## 重试和凭据

- 同次收集的网络重发：相同 `requestId`、相同全部输入。返回200和原任务，不重复创建/追加；修改过滤设置后再重发也返回原任务。
- 同编号不同输入：409。修改原文、来源或要求时使用新编号。
- `failed`：原文仍保留，使用 `POST /api/clipboard/captures/{id}/retry`，请求体 `{}`，继续查询原ID。已完成/排队/处理中不能重试。客户端在确认完成前保留原文与编号。
- 地址返回飞牛 `invalid token` 或登录页面：它是需要额外会话的网关入口；改用可独立访问的笔记服务提交地址。EcoPaste 不再提供飞牛登录或中转。
- 401：集成关闭、Token无效/撤销或账号禁用。403：目录授权不足。404：任务不属于当前Token或入口不提供该接口。400：参数不合法。413：请求体过大。429：请求过多（单Token每分钟180次）或待处理队列满。
- 重置Token后，新Token不能读取旧Token的任务原文；笔记正文和服务器原始记录不会因此删除。原文仍可由所属账号的登录凭证通过原收集查询API读取。
- 在客户端安全保存Token；不要将它写进请求URL、日志、代码仓库或截图。

当前三端图片、目录恢复与日志验收见 [NAS28/Mac34验收记录](../qa/clipboard-images-20261028/实机验收记录.md)。旧桌面会话及单Token接口记录仅用于历史追溯。

NAS29/Mac35 修复纯图片笔记在实时预览中只显示 Markdown 的问题。整理默认只做必要格式调整；单独路径或 URL 原样保存，不根据名称生成文章。同类持续积累的内容优先追加，例如不同网站的账号记录放入同一个账号密码本；没有合适笔记时再新建。此次实际安装和三条账号连续追加、路径原样保存、两端图片预览证据见 [实装验收记录](../qa/clipboard-fidelity-20261029/验收记录.md)。EcoPaste 沿用现有版本、笔记服务地址和 Token。

两端设置统一与 Mac AI 配置升级记录见 [NAS21/Mac24 验收记录](../qa/settings-unification-20261028/验收记录.md)。


## 图片与收集日志

EcoPaste 支持 Markdown 中的公网 HTTP(S) 图片、本机绝对路径、`file://` 路径，以及相对路径。相对路径以用户选择的根目录为起点，不能通过 `..` 或符号链接跳出；代码示例中的图片语法不上传。原生剪贴板图片也可收集，仍受 NAS 规则与 AI 过滤。需要登录或携带 Cookie 的远程图片不属于公网图片支持范围。

自建客户端可在提交体增加：

```json
{
  "images": [{
    "source": "./images/a.png",
    "markdown": "![说明](./images/a.png)",
    "alt": "说明",
    "mimeType": "image/png",
    "data": "图片原始字节的base64，不带data:前缀"
  }]
}
```

每次最多8张、每张6MiB、图片总计12MiB。首次提交前保存图片字节快照，重发保持 requestId、全部输入与图片字节不变。服务端检查真实图片格式和像素；原图落为附件，正文改用附件引用。配置多模态模型时生成200字符以内的说明写入 Markdown alt，进入全文及向量索引。未配置多模态时保留原说明并记提示；模型调用失败保留原任务，按原ID重试。

笔记设置顶部的“配置 / 日志”分别管理规则和查看当前账号收集结果。日志包含成功、失败、已过滤及处理中状态，显示路径、图片数量、稳定错误和提示；专用收集 Token 不能列举管理日志。新建根目录时 AI 使用2～4级路径，优先复用合适的已有目录；删除目标不会自动还原回收站。

用途判断：智能归档无法确认主题时返回 `status=filtered`、`reasonCode=CAPTURE_UNCLEAR_PURPOSE`，在日志中说明，AI判断跳过的原文保留在任务中，不创建目录或笔记。规则可提前拦截无用途说明的裸密钥（sk-/ncc_）：不调用模型、不建立收集任务，日志只显示片段类型，不保存密钥正文。不会自动建立“收集箱/待整理”等兜底分类。用户明确指定的保存目录仍可使用；内容主题明确且没有合适目录时可创建有意义的2～4级分类。同类账号资料继续优先追加集合笔记。可选AI过滤提供用户自己的额外条件，不替代归档用途判断。

图片诊断：日志分别显示 `CAPTURE_IMAGE_HTTP_状态码`、`CAPTURE_IMAGE_TIMEOUT`、`CAPTURE_IMAGE_NETWORK`、`CAPTURE_IMAGE_INVALID_RESPONSE`、`CAPTURE_IMAGE_EMPTY_RESPONSE`、`CAPTURE_IMAGE_TRUNCATED_RESPONSE`。429、5xx、网络中断和超时自动重试一次；输出截断时增加生成额度后重试一次。不会把模型思考内容当作图片描述，也不记录上游原始错误正文或密钥。旧的 DESCRIPTION_FAILED 记录不具备这些历史详情。
