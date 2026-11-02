# 开发维护文档

本文档记录项目中的关键技术决策和注意事项，供开发团队参考。

---

## 1. Commit Message 编码

**规则：** Commit message 必须使用 **UTF-8 without BOM** 编码。

**背景：** 使用带 BOM 的 UTF-8 或其他编码会导致 git log 显示异常、CI 脚本解析失败等问题。

**实践：**
- Linux/macOS 环境下默认符合要求，无需额外处理。
- Windows 环境下注意编辑器和脚本的默认编码设置。

---

## 2. 禁止使用 PowerShell Set-Content 生成 Commit Message

**规则：** 不要用 PowerShell 的 `Set-Content` 默认编码来生成 commit message。

**原因：** PowerShell 5.x 的 `Set-Content` 默认使用 UTF-16 LE (BOM) 编码，会导致 commit message 损坏。

**替代方案：**
```powershell
# 使用 -Encoding UTF8 显式指定（PowerShell 5.x 仍会加 BOM，需注意）
Set-Content -Path $file -Value $msg -Encoding UTF8

# 更推荐使用 Out-File
$msg | Out-File -FilePath $file -Encoding utf8NoBOM

# 或者直接用 git commit -m
git commit -m "your message"
```

---

## 3. 文件开头禁止 UTF-8 BOM

**规则：** 项目中所有文本文件开头**不要**带 UTF-8 BOM (`EF BB BF`)。

**受影响的文件类型：** `.ts`, `.vue`, `.json`, `.md`, `.html`, `.css`, `.js` 等。

**检查方法：**
```bash
# 检查文件前 3 字节
xxd -l 3 filename | grep -q "efbb bf" && echo "Has BOM"
```

**处理方法：**
```bash
# 移除 BOM
sed -i '1s/^\xEF\xBB\xBF//' filename
```

---

## 4. 附件路径规范

**规则：** 附件存储路径只允许以下两种格式：

| 格式 | 示例 | 说明 |
|------|------|------|
| `<uuid>.<ext>` | `a1b2c3d4-e5f6-7890-abcd-ef1234567890.png` | 单层扁平结构 |
| `YYYY/MM/<uuid>.<ext>` | `2026/06/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png` | 按年月归档 |

**禁止的格式：**
- 使用原始文件名（避免中文、空格、特殊字符问题）
- 自定义目录结构（如 `notes/xxx/`、`user/xxx/`）
- 嵌套超过两级的路径

**目的：** 统一附件管理，避免路径冲突和迁移困难。

---

## 5. Orphan 清理必须保护附件目录

**规则：** 执行 orphan（孤立笔记）清理时，必须**保护**以下目录，禁止删除：

- `attachments/`
- `task_attachments/`

**原因：** 附件可能被多处引用（笔记内容、任务描述等），仅因笔记被删除就清理附件会导致数据丢失。

**实现要点：**
```typescript
// 清理逻辑中必须包含保护判断
const PROTECTED_DIRS = ['attachments', 'task_attachments'];

function isProtectedPath(path: string): boolean {
  return PROTECTED_DIRS.some(dir => path.startsWith(dir + '/'));
}
```

---

## 6. Android 原生插件修改后必须同步

**规则：** 修改 Android 原生插件（Java/Kotlin 代码、`AndroidManifest.xml`、原生依赖等）后，**必须**执行：

```bash
npx cap sync android
```

**原因：** Capacitor 的 `sync` 命令会将 web 资源拷贝到 Android 项目并更新原生配置。不执行同步会导致：
- 原生代码变更不生效
- 插件注册丢失
- 构建产物与源码不一致

**完整流程：**
```bash
# 1. 修改原生代码
# 2. 同步
npx cap sync android
# 3. 构建验证
npx cap open android  # 或直接 Android Studio 构建
```

---

## 7. 未完成功能禁止标记为已上线

**规则：** 不要把未完成的规划写成已上线功能。

**具体要求：**
- Release notes / Changelog 中只记录**已完成并测试通过**的功能
- 未完成的功能如果需要记录，使用 `TODO` 或 `Planned` 标签，与已上线内容明确区分
- PR 描述中如实反映当前状态，不要预设合并后的效果

**反面案例：**
```
## v1.2.0
- 支持全文搜索  ← 实际只做了索引，搜索 UI 未完成
```

**正面案例：**
```
## v1.2.0
- 全文搜索：完成索引引擎（搜索 UI 计划中）
```

---

## 8. 回收站笔记必须锁定

**规则：** 进入回收站的笔记必须处于**锁定状态**，禁止以下操作：

| 操作 | 回收站中 |
|------|----------|
| 编辑 | 禁止 |
| 收藏 | 禁止 |
| 置顶 | 禁止 |
| 锁定/解锁 | 禁止（已锁定） |
| 移动 | 禁止 |

**实现要点：**
- 笔记移入回收站时自动设置锁定标志
- UI 层面对回收站笔记隐藏上述操作入口
- 后端/数据层对回收站笔记的上述操作返回错误

**目的：** 防止用户误操作回收站中的笔记，保持回收站数据的完整性以便恢复。

---

## 9. 搜索结果必须包含关键词（待开发）

**状态：** 待开发

**规则：** 搜索功能返回的结果必须包含用户输入的关键词。

**当前问题：** 部分搜索结果可能不包含关键词（如模糊匹配、分词误差等），导致用户体验不佳。

**预期行为：**
- 搜索结果的标题或正文中必须能高亮显示匹配的关键词
- 如果没有匹配结果，应明确提示"未找到包含 XXX 的笔记"

---

## 10. 表格单元格默认居中

**规则：** 表格单元格内容默认**居中对齐**。

**适用范围：**
- Markdown 渲染中的表格
- 编辑器中的表格组件

**CSS 实现：**
```css
table td,
table th {
  text-align: center;
  vertical-align: middle;
}
```

**例外情况：** 如需左对齐（如长文本内容），使用明确的 class 覆盖默认样式。
