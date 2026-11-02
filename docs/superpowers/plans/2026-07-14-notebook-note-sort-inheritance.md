# 笔记排序继承修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复根级排序能排序文件夹却不能稳定排序文件夹内笔记的问题，同时保留子级显式排序覆盖。

**架构：** 使用纯函数显式解析“本层配置或根级回退”，让文件夹树与笔记列表获得同一份有效排序规则。删除依赖对象引用和模块级可变状态的隐式继承，避免排序结果受渲染顺序影响。

**技术栈：** React 18、TypeScript、Vitest

---

## 文件结构

- 修改 `frontend/src/lib/notebookSort.ts`：提供纯排序规则解析函数，并让树构建不再写入全局状态。
- 修改 `frontend/src/lib/notebookNoteCache.ts`：直接使用调用方传入的有效排序规则。
- 修改 `frontend/src/components/Sidebar.tsx`：缺少本层配置时显式回退根级配置。
- 修改 `frontend/src/lib/__tests__/notebookSortInheritance.test.ts`：覆盖嵌套笔记继承和显式子级覆盖。

### 任务 1：用回归测试定义显式继承行为

**文件：**
- 测试：`frontend/src/lib/__tests__/notebookSortInheritance.test.ts`

- [ ] **步骤 1：编写失败的测试**

导入尚未实现的 `resolveNotebookSortPref`，用它构造每层有效规则：

```ts
function inheritedResolver(
  rootPref: NotebookSortPref,
  overrides: Record<string, NotebookSortPref> = {},
) {
  return (parentId: string | null): NotebookSortPref => {
    if (parentId === null) return rootPref;
    return resolveNotebookSortPref(overrides[parentId], rootPref);
  };
}
```

嵌套笔记测试必须把 `resolvePref("child-a")` 传入 `sortNotebookNotes`，断言名称升序为 `['a', 'z']`；显式手动覆盖测试必须断言原顺序 `['z', 'a']` 不变。

- [ ] **步骤 2：运行测试验证失败**

运行：

```powershell
npm --prefix frontend run test:run -- src/lib/__tests__/notebookSortInheritance.test.ts
```

预期：FAIL，提示 `resolveNotebookSortPref` 尚未导出或不是函数。

### 任务 2：实现纯函数排序继承

**文件：**
- 修改：`frontend/src/lib/notebookSort.ts`
- 修改：`frontend/src/lib/notebookNoteCache.ts`
- 修改：`frontend/src/components/Sidebar.tsx`

- [ ] **步骤 1：编写最少实现代码**

在 `notebookSort.ts` 增加纯函数，并移除 `activeRootNotebookSortPref` 与 `resolveInheritedNotebookSortPref`：

```ts
export function resolveNotebookSortPref(
  explicitPref: NotebookSortPref | undefined,
  rootPref: NotebookSortPref,
): NotebookSortPref {
  return explicitPref ?? rootPref;
}
```

`buildNotebookTree` 直接使用解析器返回的有效规则；`sortNotebookNotes` 直接使用传入的有效规则。在 `Sidebar.tsx` 中按以下逻辑解析：

```ts
const rootPref = prefMap[ROOT_NOTEBOOK_SORT_KEY] ?? DEFAULT_NOTEBOOK_SORT_PREF;
if (parentId === null) return rootPref;
return resolveNotebookSortPref(prefMap[notebookSortKey(parentId)], rootPref);
```

- [ ] **步骤 2：运行回归测试验证通过**

运行：

```powershell
npm --prefix frontend run test:run -- src/lib/__tests__/notebookSortInheritance.test.ts src/lib/__tests__/notebookNoteCache.test.ts
```

预期：相关测试全部 PASS。

- [ ] **步骤 3：运行前端验证**

运行：

```powershell
npm --prefix frontend run test:run
npm --prefix frontend run build
```

预期：全部测试通过，TypeScript 与 Vite 构建成功。

- [ ] **步骤 4：检查并提交**

运行：

```powershell
git diff --check
git status --short
git add frontend/src/lib/notebookSort.ts frontend/src/lib/notebookNoteCache.ts frontend/src/components/Sidebar.tsx frontend/src/lib/__tests__/notebookSortInheritance.test.ts docs/superpowers/plans/2026-07-14-notebook-note-sort-inheritance.md
git commit -m "fix(notebooks): apply inherited sort to notes"
```

预期：仅提交本需求涉及的文件，保留工作区原有未跟踪文件。
