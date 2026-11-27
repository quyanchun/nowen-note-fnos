import { useEffect, useState } from "react";
import { getQuickPanel } from "@/lib/desktopBridge";
import { SHORTCUT_COMMANDS, shortcutMatchesEvent } from "@/lib/shortcutRegistry";

const symbols: Record<string, string> = { Command: "⌘", Control: "Ctrl", Alt: "⌥", Shift: "⇧", Space: "空格" };
export default function MacQuickShortcut() {
  const bridge = getQuickPanel();
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const display = key.split("+").map(part => symbols[part] || part).join(" + ");
  useEffect(() => {
    let mounted = true;
    bridge?.shortcut().then(result => {
      if (!mounted) return;
      setKey(result.key);
      if (result.key && !result.active) setMessage(result.key === "Control+Space" ? "Ctrl + 空格未能注册。可在这里更换组合键，或在系统设置的「键盘 → 键盘快捷键 → 输入法」检查是否占用。" : "快捷键已被占用，请更换");
    }).catch(() => { if (mounted) setMessage("无法读取快捷键"); });
    return () => { mounted = false; };
  }, [bridge]);
  if (!bridge) return null;
  async function save(value: string) {
    if (!bridge || busy) return;
    setRecording(false);
    setBusy(true);
    try {
      const result = await bridge.shortcut(value);
      setKey(result.key);
      setMessage(result.error || "");
    } catch { setMessage("快捷键保存失败"); }
    finally { setBusy(false); }
  }
  return <div className="px-4 py-3 text-sm">
    <div className="flex items-center gap-3">
      <div className="flex-1"><span className="font-medium">全局快速搜索</span><p className="mt-0.5 text-xs text-tx-secondary">在任意应用中呼出搜索弹窗</p></div>
      <button title="更改全局快速搜索快捷键" disabled={busy} className="rounded-md border border-app-border px-3 py-1" onClick={() => { setRecording(true); setMessage(""); }}
        onBlur={() => setRecording(false)} onKeyDownCapture={event => {
          if (!recording || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") { setRecording(false); return; }
          const mods = [event.ctrlKey && "Control", event.metaKey && "Command", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
          const key = /^(Key[A-Z]|Digit\d|Space)$/.test(event.code) ? event.code.replace(/^(Key|Digit)/, "") : "";
          if (!key) return;
          if (!(event.ctrlKey || event.metaKey || event.altKey)) { setMessage("请同时按住 ⌘、⌥ 或 ⌃"); return; }
          if ((!event.ctrlKey && SHORTCUT_COMMANDS.some(command => shortcutMatchesEvent(command.id, event, "macos", "desktop")))
            || (event.metaKey && !event.ctrlKey && !event.altKey && ["Space", "Q", "W", "C", "V", "X", "A", "Z"].includes(key))) {
            setMessage("此组合键已有用途，请换一个"); return;
          }
          void save([...mods, key].join("+"));
        }}>{recording ? "按下组合键…" : display || "设置快捷键"}</button>
      {key && <button disabled={busy} onClick={() => void save("")}>停用</button>}
    </div>
    {message && <p role="status" className="mt-2 text-xs text-tx-secondary">{message}</p>}
  </div>;
}
