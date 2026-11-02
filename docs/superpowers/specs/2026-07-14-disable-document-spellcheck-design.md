# 全端关闭文档拼写检查设计

## 目标

在桌面端、移动端和网页端的所有笔记文档中关闭浏览器或系统提供的拼写检查，不显示拼写错误下划线，也不提供用户开关。

关闭范围包括：

- 富文本笔记标题
- 富文本笔记正文
- Markdown 笔记标题
- Markdown 笔记源码正文

## 实现方案

三端复用 `frontend` 中的同一套编辑器组件，因此只在共享编辑器入口设置原生 `spellcheck` 属性，不分别修改 Electron、Capacitor 或网页端容器。

- 在 `TiptapEditor.tsx` 的标题输入框设置 `spellCheck={false}`。
- 在 Tiptap 的 `editorProps.attributes` 中设置 `spellcheck: "false"`，使 ProseMirror 正文根节点关闭拼写检查。
- 在 `MarkdownEditorImpl.tsx` 的标题输入框设置 `spellCheck={false}`。
- 在 CodeMirror 扩展列表中加入 `EditorView.contentAttributes.of({ spellcheck: "false" })`，使 Markdown 正文根节点关闭拼写检查。

不使用 CSS 隐藏拼写下划线，因为它不能可靠关闭浏览器拼写检查；不在各平台外壳重复配置，因为实际可编辑 DOM 由共享前端创建。

## 行为与数据影响

该修改只影响可编辑区域的浏览器原生拼写检查。笔记内容、保存格式、同步协议、输入法、搜索和自定义文本处理逻辑均不改变。只读预览不需要额外处理。

## 测试与验证

先增加源代码回归测试并确认其在实现前失败，测试断言：

- Tiptap 标题明确设置 `spellCheck={false}`。
- Tiptap 正文根节点属性明确设置 `spellcheck: "false"`。
- Markdown 标题明确设置 `spellCheck={false}`。
- CodeMirror 正文通过 `contentAttributes` 明确设置 `spellcheck: "false"`。

实现后重新运行该测试，并运行前端构建，确认 TypeScript 与 Vite 构建通过。由于三个客户端使用同一前端产物，上述共享入口的验证同时覆盖桌面端、移动端和网页端。
