# 浏览器可靠导出重试实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复浏览器导出 Nowen 数据包时 Blob 地址过早失效、下载令牌无法重试以及二进制响应被压缩的问题。

**架构：** 前端统一延迟撤销导出 Blob 地址，保证全局可靠下载桥完成异步读取。后端在现有 30 分钟有效期内保留下载任务和随机能力令牌，允许浏览器重复 GET，并通过 `Content-Encoding: identity` 保持文件长度不变。

**技术栈：** React、TypeScript、Vitest、Hono、Node.js Test Runner

---

## 文件结构

- 修改 `backend/tests/reliable-export-hardening.test.ts`：定义下载令牌可重试和二进制不压缩的回归行为。
- 修改 `backend/src/services/reliableExportJobs.ts`：保留有效期内的令牌与临时文件，并禁用下载响应压缩。
- 修改 `frontend/src/lib/__tests__/reliableExportDownloadBridge.test.ts`：定义对象地址延迟撤销行为。
- 修改 `frontend/src/lib/reliableExportDownloadBridge.ts`：提供并复用对象地址延迟撤销函数。
- 修改 `frontend/src/components/DataManager.tsx`：Nowen 数据包下载改用延迟撤销。

### 任务 1：让真实 HTTP 下载支持浏览器重试

**文件：**
- 修改：`backend/tests/reliable-export-hardening.test.ts:32-52`
- 修改：`backend/src/services/reliableExportJobs.ts:13-15,586-624`

- [ ] **步骤 1：把一次性令牌测试改为有效期内可重复下载**

```ts
test("download capability token can be retried before expiry", async () => {
  const body = new Response(new TextEncoder().encode("markdown")).body;
  assert.ok(body);
  const staged = await stageReliableGeneratedExport({
    userId: "user-export-hardening",
    filename: "note.md",
    contentType: "text/markdown",
    body,
  });

  const app = new Hono();
  app.get("/download/:token", handleReliableExportDownload);
  const first = await app.request(`/download/${staged.downloadToken}`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-encoding"), "identity");
  assert.equal(await first.text(), "markdown");

  const retry = await app.request(`/download/${staged.downloadToken}`);
  assert.equal(retry.status, 200);
  assert.equal(retry.headers.get("content-encoding"), "identity");
  assert.equal(await retry.text(), "markdown");
});
```

- [ ] **步骤 2：运行测试并确认因第二次请求返回 404 而失败**

运行：`cd backend; npm test -- --test-name-pattern="download capability token can be retried"`

预期：FAIL，第二次请求的实际状态为 404，期望为 200。

- [ ] **步骤 3：实现最小后端修复**

从 `handleReliableExportDownload` 删除首次响应时的：

```ts
downloadTokens.delete(token);
job.downloadToken = undefined;
```

同时删除文件流关闭后的即时 `disposeJob` 和回退定时器，让既有 `cleanupExpiredReliableExports` 在 30 分钟到期后回收文件；响应头加入：

```ts
"Content-Encoding": "identity",
```

- [ ] **步骤 4：运行后端定向测试并确认通过**

运行：`cd backend; npm test -- --test-name-pattern="download capability token can be retried"`

预期：PASS，连续两次请求均为 200，内容均为 `markdown`。

- [ ] **步骤 5：提交后端修复**

```powershell
git add -- backend/tests/reliable-export-hardening.test.ts backend/src/services/reliableExportJobs.ts
git commit -m "fix(export): 允许浏览器重试下载"
```

### 任务 2：避免导出 Blob 地址被同步撤销

**文件：**
- 修改：`frontend/src/lib/__tests__/reliableExportDownloadBridge.test.ts`
- 修改：`frontend/src/lib/reliableExportDownloadBridge.ts:52-66`
- 修改：`frontend/src/components/DataManager.tsx:446-458`

- [ ] **步骤 1：编写对象地址延迟撤销测试**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractLegacyDownloadToken,
  isReliableExportFilename,
  scheduleObjectUrlRevocation,
} from "@/lib/reliableExportDownloadBridge";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("keeps an export object URL alive until the cleanup delay expires", () => {
  vi.useFakeTimers();
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

  scheduleObjectUrlRevocation("blob:https://note.test/export", 60_000);

  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(59_999);
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(revoke).toHaveBeenCalledWith("blob:https://note.test/export");
});
```

- [ ] **步骤 2：运行测试并确认因导出函数不存在而失败**

运行：`cd frontend; npm run test:run -- src/lib/__tests__/reliableExportDownloadBridge.test.ts`

预期：FAIL，提示 `scheduleObjectUrlRevocation` 未导出或不是函数。

- [ ] **步骤 3：实现并接入统一延迟撤销**

在下载桥中添加：

```ts
const OBJECT_URL_CLEANUP_DELAY_MS = 60_000;

export function scheduleObjectUrlRevocation(
  url: string,
  delayMs = OBJECT_URL_CLEANUP_DELAY_MS,
): void {
  window.setTimeout(() => URL.revokeObjectURL(url), delayMs);
}
```

让 `triggerBlobDownload` 使用该函数，并在 `DataManager.tsx` 中导入它，把同步调用：

```ts
URL.revokeObjectURL(url);
```

替换为：

```ts
scheduleObjectUrlRevocation(url);
```

- [ ] **步骤 4：运行前端定向测试并确认通过**

运行：`cd frontend; npm run test:run -- src/lib/__tests__/reliableExportDownloadBridge.test.ts`

预期：全部 PASS。

- [ ] **步骤 5：提交前端修复**

```powershell
git add -- frontend/src/lib/__tests__/reliableExportDownloadBridge.test.ts frontend/src/lib/reliableExportDownloadBridge.ts frontend/src/components/DataManager.tsx
git commit -m "fix(export): 延迟释放导出文件地址"
```

### 任务 3：回归验证

**文件：**
- 验证：`backend/tests/reliable-export-hardening.test.ts`
- 验证：`backend/tests/markdown-export-jobs.test.ts`
- 验证：`frontend/src/lib/__tests__/reliableExportDownloadBridge.test.ts`

- [ ] **步骤 1：运行后端导出测试**

运行：`cd backend; node --import tsx --test tests/reliable-export-hardening.test.ts tests/markdown-export-jobs.test.ts`

预期：退出码 0，无失败测试。

- [ ] **步骤 2：运行前端下载桥测试**

运行：`cd frontend; npm run test:run -- src/lib/__tests__/reliableExportDownloadBridge.test.ts`

预期：退出码 0，无失败测试。

- [ ] **步骤 3：运行前后端构建**

运行：`npm run build:all`

预期：退出码 0，TypeScript 与打包均成功。

- [ ] **步骤 4：检查最终差异与编码**

运行：`git diff --check HEAD~2..HEAD; git status --short`

预期：无空白错误；只出现计划内提交和用户原有的未跟踪文件。
