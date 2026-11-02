import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ folders: vi.fn(), save: vi.fn(), close: vi.fn(), restore: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "zh-CN" } }) }));
vi.mock("@/lib/api", () => ({ api: { getNotebooks: m.folders } }));
vi.mock("@/lib/aiCollaboration", () => ({ collaborationScope: () => "test", readCollaborationDraft: () => ({ input: "" }) }));
vi.mock("@/components/ui/AppSelect", () => ({ default: (props: any) => <select {...props} /> }));
import HomeCaptureSettings from "../HomeCaptureSettings";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.resetAllMocks(); m.folders.mockResolvedValue([{ id: "folder", name: "资料", permission: "write" }]); m.save.mockResolvedValue(undefined); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<HomeCaptureSettings preferences={{ method: "tidy" }} destinationLocked={false} allowRestore={false} onSave={m.save} onRestore={m.restore} onClose={m.close} />)); }
it("offers usable defaults and hides optional instructions under more options", async () => {
  await render(); expect((document.querySelector('[aria-label="保存位置"]') as HTMLSelectElement).value).toBe("");
  expect((document.querySelector('[aria-label="AI 整理方式"]') as HTMLSelectElement).value).toBe("tidy"); expect(document.querySelector("details")?.open).toBe(false);
  await act(async () => { [...document.querySelectorAll("button")].find(el => el.textContent === "完成")!.click(); });
  expect(m.save).toHaveBeenCalledWith({ method: "tidy" }); expect(m.close).toHaveBeenCalledOnce();
});
it("changes destination and organization method without requiring a prompt", async () => {
  await render();
  act(() => { const el = document.querySelector<HTMLSelectElement>('[aria-label="保存位置"]')!; el.value = "folder"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  act(() => { const el = document.querySelector<HTMLSelectElement>('[aria-label="AI 整理方式"]')!; el.value = "summary"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { [...document.querySelectorAll("button")].find(el => el.textContent === "完成")!.click(); });
  expect(m.save).toHaveBeenCalledWith({ method: "summary", notebookId: "folder" });
});
it("keeps the dialog open if persisting preferences fails", async () => {
  m.save.mockRejectedValueOnce(new Error("存储失败")); await render();
  await act(async () => { [...document.querySelectorAll("button")].find(el => el.textContent === "完成")!.click(); });
  expect(m.close).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')?.textContent).toBe("存储失败");
});
