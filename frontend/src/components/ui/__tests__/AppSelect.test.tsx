import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AppSelect from "../AppSelect";
import AppCombobox from "../AppCombobox";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const trigger = () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
async function open() { await act(async () => { trigger().focus(); trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); }); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function key(key: string) { await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); }); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }

it("uses a themed popup with option groups and skips disabled choices with the keyboard", async () => {
  let changed = "";
  function Form() { const [value, setValue] = useState(""); return <label>主题<AppSelect id="theme" name="theme" value={value} onChange={e => { expect(e.target).toBeInstanceOf(HTMLSelectElement); changed = e.currentTarget.value; setValue(changed); }}><option value="">跟随默认</option><optgroup label="颜色"><option disabled value="red">不可用</option><option value="blue">蓝色</option></optgroup></AppSelect></label>; }
  await act(async () => root.render(<form><Form /></form>));
  expect(trigger().textContent).toBe("跟随默认"); expect(host.querySelector("label")!.control).toBe(trigger());
  await open(); expect(document.querySelector('[role="listbox"]')?.textContent).toContain("颜色");
  await key("End"); await key("Enter"); expect(changed).toBe("blue"); expect(trigger().textContent).toBe("蓝色");
  expect(new FormData(host.querySelector("form")!).get("theme")).toBe("blue");
});

it("preserves empty values, controlled updates and dynamic options", async () => {
  const change = vi.fn();
  const render = (value: string, extra = false) => <AppSelect aria-label="范围" value={value} onChange={change}><option value="">全部</option>{extra && <option value="new">新目录</option>}</AppSelect>;
  await act(async () => root.render(render(""))); expect(trigger().textContent).toBe("全部");
  await act(async () => root.render(render("new", true))); expect(trigger().textContent).toBe("新目录");
  await open(); await key("Home"); await key("Enter"); expect(change).toHaveBeenCalledTimes(1); expect(change.mock.calls[0][0].target.value).toBe("new");
  // Controlled parent deliberately did not accept the new empty value.
  expect(trigger().textContent).toBe("新目录");
});

it("does not change the value on Escape and restores focus", async () => {
  const change = vi.fn(); await act(async () => root.render(<AppSelect title="选择" value="a" onChange={change}><option value="a">A</option><option value="b">B</option></AppSelect>));
  await open(); await key("ArrowDown"); await key("Escape"); expect(change).not.toHaveBeenCalled(); expect(document.querySelector('[role="listbox"]')).toBeNull(); expect(document.activeElement).toBe(trigger());
});

it("keeps disabled controls closed", async () => {
  await act(async () => root.render(<AppSelect aria-label="模型" disabled value="a"><option value="a">A</option></AppSelect>)); expect(trigger().disabled).toBe(true);
});

it("keeps custom model entry editable and selection callbacks compatible", async () => {
  function Field() { const [value, setValue] = useState("custom"); return <AppCombobox label="模型" value={value} onChange={setValue} options={[{id:"known",name:"可选模型"}]} />; }
  await act(async () => root.render(<Field />)); const input = host.querySelector("input")!; expect(input.value).toBe("custom");
  await open(); await key("End"); await key("Enter"); expect(input.value).toBe("known");
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "manual-model"); input.dispatchEvent(new Event("input", {bubbles:true})); }); expect(input.value).toBe("manual-model");
});

it("does not emit changes or clear an initial value when mounted inside a form", async () => {
  const change = vi.fn(); await act(async () => root.render(<form><AppSelect value="unresolved" onChange={change}><option value="">全部</option><option value="unresolved">未解决</option></AppSelect></form>));
  expect(change).not.toHaveBeenCalled(); expect(trigger().textContent).toBe("未解决");
});

it("aligns the editable-field picker to its right edge instead of extending past the arrow", async () => {
  await act(async () => root.render(<AppCombobox label="模型" value="custom" onChange={() => {}} options={[{id:"known",name:"模型名称"}]} />));
  await open();
  expect(document.querySelector('[role="listbox"]')?.getAttribute("data-align")).toBe("end");
});
