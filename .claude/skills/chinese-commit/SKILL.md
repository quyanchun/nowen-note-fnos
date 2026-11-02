---
name: chinese-commit
description: 确保 git commit message 使用中文。在提交代码时自动应用中文提交规范。
---

# Chinese Commit

确保所有 git commit message 使用中文。

## 规则

1. **commit message 必须使用中文** — 包括标题和正文
2. **type 保持英文** — 如 `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `test`, `perf`, `build`, `ci`, `revert`
3. **scope 可选中文或英文** — 如 `编辑器`, `标签`, `backlinks`, `tasks`
4. **描述用中文** — 清晰说明做了什么
5. **正文可选** — 用中文解释为什么做这个修改

## 格式

```
<type>(<scope>): <中文描述>

<可选中文正文>
```

## 示例

```
feat(编辑器): 添加反向链接面板

支持查看哪些笔记引用了当前笔记，点击可跳转。
```

```
fix(tags): 修复删除笔记后标签筛选上下文丢失

不再强制 setViewMode("all")，保留当前笔记本/搜索上下文。
```

```
refactor(db): 重建 note_links 表补齐外键约束

添加 ON DELETE CASCADE，确保删除笔记时自动清理引用关系。
```

```
chore: 更新依赖版本
```

## 使用方法

在对话中输入 `/chinese-commit`，AI 将使用中文格式生成 commit message。

## 常用 type 中文对照

| type | 中文含义 |
|------|----------|
| feat | 新增功能 |
| fix | 修复问题 |
| refactor | 重构代码 |
| chore | 杂项修改 |
| docs | 文档更新 |
| style | 代码格式 |
| test | 测试相关 |
| perf | 性能优化 |
| build | 构建相关 |
| ci | CI/CD |
| revert | 回滚提交 |
