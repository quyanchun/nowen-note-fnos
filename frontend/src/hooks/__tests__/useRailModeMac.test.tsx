import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { useRailMode } from "../useRailMode";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let dispose = () => {};
afterEach(() => { dispose(); localStorage.clear(); delete (window as any).nowenDesktop; });
it.each(["icon", "label", "hidden"])("keeps native Mac menu text visible despite old %s preference", stored => {
  localStorage.setItem("nowen-rail-mode", stored); (window as any).nowenDesktop = { isDesktop: true, platform: "darwin" };
  const host = document.createElement("div"); const root = createRoot(host); dispose = () => act(() => root.unmount());
  function Probe() { const [mode] = useRailMode(); return <span>{mode}</span>; }
  act(() => root.render(<Probe />)); expect(host.textContent).toBe("label"); expect(localStorage.getItem("nowen-rail-mode")).toBe(stored);
});
it.each(["win32", undefined])("preserves %s menu preferences", platform => {
  localStorage.setItem("nowen-rail-mode", "hidden"); (window as any).nowenDesktop = platform ? { isDesktop: true, platform } : undefined;
  const host = document.createElement("div"); const root = createRoot(host); dispose = () => act(() => root.unmount());
  function Probe() { const [mode] = useRailMode(); return <span>{mode}</span>; }
  act(() => root.render(<Probe />)); expect(host.textContent).toBe("hidden");
});
