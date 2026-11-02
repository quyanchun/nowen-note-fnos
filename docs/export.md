# 导出功能说明

> 本文档描述 nowen-note 的笔记导出能力，覆盖所有支持的导出格式、各平台行为差异、入口位置及已知待优化项。

---

## 目录

1. [Markdown 导出](#1-markdown-导出)
2. [PDF 导出](#2-pdf-导出)
3. [Word 导出](#3-word-导出)
4. [PNG / JPG 图片导出](#4-png--jpg-图片导出)
5. [Android 相册保存](#5-android-相册保存)
6. [Web / Electron fallback 下载](#6-web--electron-fallback-下载)
7. [右键菜单入口](#7-右键菜单入口)
8. [已知待优化项](#8-已知待优化项)

---

## 1. Markdown 导出

Markdown 导出是 nowen-note 最基础、覆盖面最广的导出方式，支持单篇笔记、按笔记本批量导出、以及全量备份三种粒度。

### 1.1 单篇笔记导出

右键点击笔记列表中的任意一篇笔记，选择 **导出 > Markdown**，即可下载该笔记。

- 若笔记不含内联图片或远程附件，直接下载 `.md` 文件。
- 若笔记包含图片（内联 data URI 或远程 `/api/attachments/<id>`），自动打包为 `.zip`，内含：
  - `<笔记标题>.md`：正文 Markdown，图片引用为相对路径 `./assets/<hash>.<ext>`。
  - `assets/` 目录：所有图片文件，按 SHA-1 前 10 位去重命名。

导出的 Markdown 文件包含 YAML frontmatter：

```yaml
---
title: "笔记标题"
created: 2025-01-01T00:00:00.000Z
updated: 2025-06-01T12:00:00.000Z
---
```

### 1.2 按笔记本导出

在左侧文档树中右键点击一个笔记本，选择 **导出为 Markdown**，可将该笔记本及其所有子笔记本下的全部笔记打包为一个 `.zip` 文件。

zip 内部结构按笔记本名称分目录：

```
笔记本A_2025-06-24.zip
├── 笔记本A/
│   ├── 笔记1.md
│   ├── 笔记2.md
│   └── assets/
│       └── a1b2c3d4e5.png
├── 子笔记本B/
│   └── 笔记3.md
├── metadata.json
└── export-warnings.json   （仅在有图片处理失败时生成）
```

`metadata.json` 记录导出元信息（版本、时间、笔记总数、各笔记本笔记数、图片处理统计）。
`export-warnings.json` 记录图片下载/内嵌失败的明细（原 src、所属笔记、失败原因），便于排查。

### 1.3 全量备份

在 **设置 > 数据管理** 中可触发全量导出，支持按"个人空间"或指定工作区为范围，导出当前空间下的全部笔记。

导出流程：
1. 拉取服务端全部笔记数据。
2. 逐篇将 Tiptap JSON 渲染为 HTML，再通过 Turndown 转为 Markdown。
3. 抽取内联图片和远程附件，写入 zip 的 `assets/` 目录。
4. 生成 `metadata.json` 元数据。
5. 压缩并触发下载。

### 1.4 图片处理策略

导出时提供两种图片处理模式：

| 模式 | 行为 | 适用场景 |
|---|---|---|
| **拆分为文件**（默认） | 内联 data URI 图片拆到 `assets/`，远程附件下载到 `assets/`，md 中用相对路径引用 | Typora / Obsidian / VSCode 等本地编辑器可直接预览 |
| **内嵌为 base64** | 所有图片（含远程附件）转为 `data:image/...;base64,...` 内嵌到 md 正文 | 单文件自包含，适合"导出再导入"闭环 |

base64 内嵌模式下，重新导入时后端会自动将 data URI 落盘为附件文件，不依赖旧 attachment id。

### 1.5 远程图片与附件下载

导出过程中会自动识别并下载指向本站后端的资源：

- **图片**：`<img src="/api/attachments/<id>">` 会被 fetch 下载并替换为 zip 内相对路径。
- **非图附件**：`<a href="/api/attachments/<id>">`（PDF、docx、音视频等）同样会被下载到 `assets/` 目录。

并发下载限流 6（图片）/ 4（非图附件），避免给后端施压。下载失败时保留原始 src 并规范化为相对路径 `/api/attachments/<id>`（剥掉 host:port），同时记录到 `export-warnings.json`。

### 1.6 转换细节

- Tiptap JSON 通过 `generateHTML` 渲染为 HTML，确保 `<pre><code class="language-xxx">` 代码块结构完整。
- Turndown 自定义转义策略：仅转义行首可能被误解析为 Markdown 块级语法的字符（`#`、`>`、`-`、`1.` 等），行内的 `_`、`*`、`~` 保留原字符。
- 任务列表（task list）转为 `- [x]` / `- [ ]` 语法。
- 高亮文本（`<mark>`）转为 `==内容==`。
- 连续空行自动折叠为最多 1 个空行（围栏代码块内除外）。

---

## 2. PDF 导出

PDF 导出支持单篇笔记，提供两条技术路径，按运行环境自动选择。

### 2.1 Electron 桌面端：矢量 PDF

在 Electron 环境中，PDF 导出走主进程离屏 BrowserWindow + `webContents.printToPDF` 路径：

- 产出**矢量 PDF**：文字可选、可搜索、体积小。
- 弹出系统"另存为"对话框，用户选择保存位置。
- 不会弹出系统打印对话框，体验为"直接保存"。
- 中文排版正常（使用系统字体）。

调用链：`exportSingleNoteAsPDF` -> `window.nowenDesktop.exportNoteToPDF` -> 主进程 BrowserWindow -> `printToPDF`。

### 2.2 浏览器端：html2canvas + jsPDF

在纯浏览器环境中（包括 Electron 降级），使用 html2canvas + jsPDF 直接生成 PDF 并触发下载：

1. 将笔记渲染为带完整排版样式的自包含 HTML（所有图片已 inline 为 data URI）。
2. 注入离屏 iframe，等待图片加载完成。
3. html2canvas 截图（2x DPI），按 A4 纵向尺寸分页。
4. jsPDF 逐页 `addImage`，输出 PDF Blob 并触发下载。

**特点**：
- 文字为光栅图（不可选、不可搜索），但中文渲染正常。
- 零系统依赖，不弹打印对话框，体验为"直接下载 PDF"。
- html2canvas 和 jsPDF 为动态 import，不影响首屏加载体积。
- 截图宽度固定 800px，按 A4 纵向 210mm x 297mm 分页，左右各留 10mm 边距。

### 2.3 降级策略

```
Electron 可用?
  ├─ 是 → 调用 window.nowenDesktop.exportNoteToPDF
  │       ├─ 成功 → 返回 { ok: true, mode: "desktop" }
  │       ├─ 用户取消 → 返回 { ok: false, mode: "canceled" }
  │       └─ 失败 → 降级到 Web 路径
  └─ 否 → html2canvas + jsPDF 直接生成 PDF
          └─ 返回 { ok: true, mode: "web" }
```

---

## 3. Word 导出

Word 导出支持将单篇笔记转为 `.docx` 格式。

### 3.1 技术路径

导出走 **Tiptap JSON -> DocxIR -> docx** 两段映射：

1. 将笔记的 Tiptap JSON content 解析为内部中间表示（DocxIR）。
2. 由 docx 序列化器将 IR 产出合法的 `.docx` Blob。
3. 触发浏览器下载。

调用链：`exportNoteAsDocx` (wordNoteService) -> `downloadDocxBlob`。

### 3.2 特性

- 导出的 `.docx` 可在 Microsoft Word、WPS、LibreOffice 等主流办公软件中打开。
- 支持标题、段落、列表、表格、代码块、图片等常见富文本元素的映射。
- 通过动态 import 加载，不影响首屏体积。

---

## 4. PNG / JPG 图片导出

图片导出将单篇笔记渲染为 PNG 或 JPG 格式的图片文件。

### 4.1 技术路径

1. 将笔记内容渲染为带完整排版样式的 HTML（图片已处理为可访问的 data URI 或绝对 URL）。
2. 注入离屏 DOM 容器（宽度 794px，白色背景）。
3. 使用 html2canvas 截图，设备像素比取 `Math.min(window.devicePixelRatio, 2)`。
4. 通过 `canvas.toBlob` 输出 PNG 或 JPG（JPG 质量默认 0.92）。

### 4.2 输出特性

- 输出宽度固定 794px，高度按内容自适应。
- 包含标题、更新时间、正文完整排版。
- JPG 格式体积更小，适合分享；PNG 无损，适合存档。
- 超长笔记（高度 > 20000px）会弹出确认提示，避免生成过大的图片。

### 4.3 Android 环境特殊处理

在 Android 原生环境（Capacitor）中，图片导出完成后会自动调用系统相册保存接口，而非触发浏览器下载。详见 [Android 相册保存](#5-android-相册保存)。

---

## 5. Android 相册保存

在 Android 原生环境（Capacitor App）中，图片导出（PNG / JPG）完成后会自动保存到系统相册。

### 5.1 实现机制

通过 Capacitor 原生插件 `MediaStoreSave` 实现：

1. 将 canvas 产出的 Blob 转为 base64。
2. 调用 `MediaStoreSave.saveImage`，传入 base64 数据、文件名、MIME 类型。
3. 图片保存到 `Pictures/Nowen Note` 目录。
4. 保存成功后直接返回，不触发浏览器下载。

### 5.2 降级策略

若原生保存失败（插件异常、权限不足等），自动降级为浏览器 `saveAs` 下载，保证用户始终能拿到文件。

### 5.3 环境判断

通过 `Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"` 判断是否为 Android 原生环境。iOS 暂不支持相册保存，走标准下载路径。

---

## 6. Web / Electron fallback 下载

所有导出格式在不同平台上的下载行为遵循统一的 fallback 机制：

| 环境 | 下载方式 | 说明 |
|---|---|---|
| **Electron 桌面端** | PDF：主进程 `printToPDF` 直接写文件；其他格式：`saveAs` | PDF 走系统"另存为"对话框；其他走浏览器下载 |
| **Web 浏览器** | `file-saver` 的 `saveAs` | 触发浏览器标准下载行为 |
| **Android 原生** | 图片：`MediaStoreSave` 保存到相册；其他：`saveAs` | 图片优先走原生相册，失败降级 `saveAs` |
| **Android WebView** | `saveAs` | 与标准 Web 行为一致 |

### 6.1 saveAs 统一入口

项目使用 `file-saver` 库的 `saveAs` 函数作为通用下载入口。该库在各平台（Chrome、Firefox、Safari、Electron WebView、Android WebView）均有良好兼容性。

### 6.2 PDF 的双路径设计

PDF 是唯一提供两条技术路径的格式：

- **Electron 矢量路径**：文字可选、体积小、中文完美，但仅限桌面端。
- **浏览器光栅路径**：html2canvas + jsPDF，零系统依赖，文字为图片，但覆盖所有平台。

两条路径自动切换，对用户透明。

---

## 7. 右键菜单入口

导出功能通过右键菜单（桌面端）/ 长按菜单（移动端）触发，分布在两个区域。

### 7.1 笔记列表右键菜单

在中间笔记列表区域右键点击任意笔记，展开 **导出...** 子菜单：

| 菜单项 | 对应格式 | 说明 |
|---|---|---|
| Markdown | `.md` 或 `.zip` | 按是否含图自动决定 |
| PDF | `.pdf` | Electron 矢量 / 浏览器光栅 |
| 图片 PNG | `.png` | html2canvas 截图 |
| 图片 JPG | `.jpg` | html2canvas 截图 |
| Word | `.docx` | Tiptap JSON -> DocxIR -> docx |

**注意**：批量选择模式下不显示导出子菜单，避免一次触发大量下载弹窗。

### 7.2 文档树右键菜单（树形目录）

在左侧文档树中：

- **右键点击笔记本**：显示 **导出为 Markdown** 菜单项，导出该笔记本及所有子笔记本的全部笔记为 zip。
- **右键点击树中的笔记条目**：目前树形目录的笔记右键菜单不包含导出项（仅提供打开、置顶、收藏、锁定、删除）。笔记导出需在笔记列表区域操作。

### 7.3 权限控制

笔记本级导出（导出为 Markdown）受以下权限控制：

| 空间类型 | 管理员 | 普通用户 |
|---|---|---|
| 工作区 | 始终可见 | 始终可见（由后端工作区成员资格控制） |
| 个人空间 | 始终可见（数据救援能力） | 受 `personalExportEnabled` 开关控制 |

该开关从 `GET /api/me` 的 `personalExportEnabled` 字段读取，v6 起由后端下发。

---

## 8. 已知待优化项

### CONTEXT-MENU-COMPACT-01 右键菜单导出项折叠优化（待开发）

**现状**：笔记列表右键菜单的导出子菜单包含 5 个固定项（Markdown、PDF、PNG、JPG、Word），在屏幕高度有限或移动端长按场景下，子菜单展开后可能超出可视区域。

**待优化方向**：

- 评估是否将低频导出格式（如 Word、JPG）折叠到"更多导出格式"二级入口中，仅保留 Markdown 和 PDF 作为一级快捷项。
- 移动端长按菜单考虑改为底部 Action Sheet 样式，提升小屏可用性。
- 批量模式下是否需要提供批量导出能力（当前为避免触发大量下载而禁用）。

**状态**：待开发。尚未进入迭代排期。

---

## 相关模块

| 模块 | 路径 | 职责 |
|---|---|---|
| exportService | `frontend/src/lib/exportService.ts` | Markdown / PDF / 图片导出核心逻辑 |
| wordNoteService | `frontend/src/lib/wordNoteService.ts` | Word 导入导出 |
| nativeImageSave | `frontend/src/lib/nativeImageSave.ts` | Android 相册保存 |
| ContextMenu | `frontend/src/components/ContextMenu.tsx` | 通用右键菜单组件（笔记列表） |
| NoteList | `frontend/src/components/NoteList.tsx` | 笔记列表，包含导出子菜单定义 |
| Sidebar | `frontend/src/components/Sidebar.tsx` | 文档树，包含笔记本级导出 |
| DataManager | `frontend/src/components/DataManager.tsx` | 数据管理，包含全量备份入口 |
| importService | `frontend/src/lib/importService.ts` | Markdown / ZIP 导入（导出的逆操作） |
