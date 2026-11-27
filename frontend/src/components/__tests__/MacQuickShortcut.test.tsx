import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import ShortcutSettingsPanel from "../settings/ShortcutSettingsPanel";
import MacQuickShortcut from "../settings/MacQuickShortcut";

const mock = vi.hoisted(() => ({ shortcut: vi.fn() }));
vi.mock("@/lib/desktopBridge", () => ({ getQuickPanel: () => mock }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("records the physical key under Option, reports conflicts and allows disabling", async () => {
  mock.shortcut.mockResolvedValueOnce({key:"Control+Space",active:true})
    .mockResolvedValueOnce({key:"Control+Space",active:true,error:"该快捷键无法注册，请换一个"})
    .mockResolvedValueOnce({key:"Control+Alt+8",active:true})
    .mockResolvedValueOnce({key:"",active:false});
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MacQuickShortcut/>));
    const button = host.querySelector("button")!;
    expect(button.textContent).toContain("Ctrl + 空格");
    async function record(code: string) {
      act(() => button.click());
      await act(async () => {
        button.dispatchEvent(new KeyboardEvent("keydown", {key:"•",code,ctrlKey:true,altKey:true,bubbles:true}));
      });
    }
    await record("Digit7");
    expect(host.textContent).toContain("请换一个");
    expect(button.textContent).toContain("Ctrl + 空格");
    await record("Digit8");
    expect(mock.shortcut).toHaveBeenCalledWith("Control+Alt+8");
    expect(button.textContent).toContain("Ctrl + ⌥ + 8");
    await act(async () => host.querySelectorAll("button")[1].click());
    expect(mock.shortcut).toHaveBeenCalledWith("");
    expect(button.textContent).toBe("设置快捷键");
  } finally { act(() => root.unmount()); }
});

it("places the native shortcut inside Global even when it is the sole search match", async () => {
  mock.shortcut.mockResolvedValue({ key: "Control+Space", active: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ShortcutSettingsPanel />));
    const section = () => host.querySelector('[title="更改全局快速搜索快捷键"]')?.closest("section");
    expect(section()?.querySelector("h4")?.textContent).toContain("全局");
    const search = host.querySelector<HTMLInputElement>('input[placeholder="搜索命令或分类…"]')!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { set.call(search, "快速搜索"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(section()?.querySelector("h4")?.textContent).toContain("全局");
    expect(host.textContent).not.toContain("没有匹配的命令");
  } finally { act(() => root.unmount()); }
});
