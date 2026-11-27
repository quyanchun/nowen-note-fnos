const path = require("node:path");
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require("electron");
const { assertMainWindowSender } = require("../security");
const { isQuickPanelShortcut, readSettings, writeSettings } = require("../settings");

const BAR_HEIGHT = 68;
const DEFAULT_KEY = "Control+Space";

function installQuickPanel(getMain) {
  let panel = null;
  let releaseTimer;
  let activeKey = "";
  let ready = false;
  let visible = false;
  let loaded = false;
  let request = 0;
  let contentHeight = 0, expanded = false;
  const pending = new Map();
  const choices = { search: new Set(), ask: new Set() };
  let draft = null, saving = false, savedId = "";
  const lane = kind => kind === "preview" ? "search" : kind;
  function resetReads() {
    for (const key of ["search", "ask", "detail"]) pending.delete(key);
    choices.search.clear();
    choices.ask.clear();
    mainSend("quick:query", { id: ++request, kind: "clear", query: "" });
  }
  function resetScope() {
    draft = null; saving = false; savedId = "";
    pending.clear();
    hide();
  }
  const savedKey = () => readSettings().quickPanelShortcut ?? DEFAULT_KEY;
  const mainSend = (channel, value) => {
    const main = getMain();
    if (main && !main.isDestroyed()) main.webContents.send(channel, value);
  };
  function revealMain() {
    const main = getMain();
    if (!main || main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }
  function hide() {
    if (!visible) return;
    visible = false;
    resetReads();
    if (panel && !panel.isDestroyed()) {
      panel.webContents.send("quick:clear");
      panel.hide();
    }
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => panel?.destroy(), 20000);
  }
  function fitPanel(area) {
    const resultsWidth = Math.min(920, Math.max(680, Math.round(area.width * 0.58)));
    let width = contentHeight > 0 ? resultsWidth : 680;
    if (expanded) width = Math.min(1280, Math.max(1000, Math.round(area.width * 0.84)));
    width = Math.min(width, Math.max(1, area.width - 32));
    const height = Math.min(Math.floor(area.height * 0.76), 920,
      Math.max(expanded ? 260 : BAR_HEIGHT, BAR_HEIGHT + Math.ceil(contentHeight)));
    const x = area.x + Math.round((area.width - width) / 2);
    // Anchor the input while streamed lines grow downwards; leave space above the Dock.
    const y = area.y + Math.round(area.height * 0.18);
    const old = panel.getBounds();
    if (x !== old.x || y !== old.y || width !== old.width || height !== old.height) {
      panel.setBounds({ x, y, width, height });
    }
  }
  function fitCurrentDisplay() {
    if (visible && loaded) fitPanel(screen.getDisplayMatching(panel.getBounds()).workArea);
  }
  screen.on("display-metrics-changed", fitCurrentDisplay);
  screen.on("display-removed", fitCurrentDisplay);
  function revealPanel() {
    if (!visible || !panel || !loaded) return;
    contentHeight = 0;
    expanded = false;
    fitPanel(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea);
    panel.show();
    panel.focus();
    panel.webContents.send("quick:reset", { draft, saving });
  }
  function toggle() {
    if (visible) return hide();
    clearTimeout(releaseTimer);
    visible = true;
    if (panel) return revealPanel();
    const nativeDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, "../../node_modules/.cache/nowen");
    let roundPanel;
    try { roundPanel = require(path.join(nativeDir, "quick-panel-corners.node")); }
    catch (error) { console.warn("[quick-panel] Using system corners:", error.code); }
    panel = new BrowserWindow({
      width: 680, height: BAR_HEIGHT, show: false, frame: false, type: "panel",
      resizable: false, fullscreenable: false, minimizable: false, alwaysOnTop: true,
      transparent: !!roundPanel, roundedCorners: !roundPanel, vibrancy: "popover", visualEffectState: "active", backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "quick-panel" },
    });
    roundPanel?.(panel.getNativeWindowHandle());
    panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    panel.webContents.on("will-navigate", event => event.preventDefault());
    const created = panel;
    panel.on("blur", () => {
      setImmediate(() => {
        if (created === panel && visible && !created.isFocused()) hide();
      });
    });
    panel.on("closed", () => {
      hide();
      clearTimeout(releaseTimer);
      panel = null;
      loaded = false;
    });
    created.loadFile(path.join(__dirname, "panel.html")).then(() => {
      if (created !== panel) return;
      loaded = true;
      revealPanel();
    }).catch(() => { if (!created.isDestroyed()) created.destroy(); });
  }
  const configured = savedKey();
  if (configured && globalShortcut.register(configured, toggle)) activeKey = configured;

  const isMain = event => !assertMainWindowSender(event) && event.senderFrame === event.sender.mainFrame;
  const isPanel = event => visible && panel && event.sender === panel.webContents && event.senderFrame === event.sender.mainFrame;
  ipcMain.handle("quick:shortcut", (event, next) => {
    if (!isMain(event)) return { error: "无法访问快捷键设置" };
    const status = () => ({ key: savedKey(), active: !!activeKey });
    if (next === undefined || next === activeKey && next === savedKey()) return status();
    if (!isQuickPanelShortcut(next)) return { ...status(), error: "请选择有效组合键" };
    if (next && !globalShortcut.register(next, toggle)) return { ...status(), error: "该快捷键无法注册，请换一个" };
    try { writeSettings({ quickPanelShortcut: next }); }
    catch {
      if (next) globalShortcut.unregister(next);
      return { key: activeKey, active: !!activeKey, error: "快捷键保存失败" };
    }
    if (activeKey) globalShortcut.unregister(activeKey);
    activeKey = next;
    return status();
  });
  ipcMain.on("quick:ready", (event, value) => {
    if (!isMain(event)) return;
    ready = value === true;
    if (!ready) resetScope();
  });
  getMain().webContents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) { ready = false; resetScope(); }
  });
  getMain().webContents.on("render-process-gone", () => { ready = false; resetScope(); });
  function query(kind, text, extra) {
    const query = text.trim().slice(0, kind === "ask" ? 2000 : 512);
    const data = { id: ++request, kind, query };
    pending.set(lane(kind), data);
    if (choices[lane(kind)]) choices[lane(kind)].clear();
    if (ready) mainSend("quick:query", { ...data, ...extra });
    else if (query) panel.webContents.send("quick:render", { ...data, error: "请先在客户端登录，再试一次" });
  }
  ipcMain.on("quick:type", (event, text) => {
    if (isPanel(event) && typeof text === "string") query("preview", text);
  });
  ipcMain.on("quick:height", (event, naturalHeight, split) => {
    if (!isPanel(event) || !Number.isFinite(naturalHeight)) return;
    contentHeight = Math.max(0, naturalHeight);
    expanded = split === true;
    fitCurrentDisplay();
  });
  ipcMain.on("quick:draft", (event, value) => {
    if (!ready || !isPanel(event) || saving || !value || typeof value.title !== "string" || typeof value.text !== "string"
      || !/^[0-9a-f-]{36}$/i.test(value.id) || value.title.length > 200 || value.text.length > 60000) return;
    draft = { id: value.id, title: value.title, text: value.text };
  });
  ipcMain.on("quick:results", (event, data) => {
    if (!isMain(event) || !data) return;
    const { kind, query } = data;
    const active = pending.get(lane(kind));
    if (!active || active.id !== data.id || active.query !== query || active.kind !== kind) return;
    if (kind === "save") {
      saving = false;
      if (data.saved === draft?.id) { savedId = data.saved; draft = null; }
      pending.delete("save");
    }
    if (!visible || !loaded) return;
    let result;
    if (Array.isArray(data.rows) && choices[lane(kind)]) {
      const rows = data.rows.slice(0, kind === "preview" ? 5 : 50)
        .filter(row => typeof row?.id === "string" && typeof row.title === "string")
        .map(({id, title, snippet, notebook, updatedAt}) => ({
          id, title, snippet: String(snippet || "").slice(0, 320), notebook: String(notebook || "").slice(0, 160), updatedAt,
        }));
      choices[lane(kind)] = new Set(rows.map(row => row.id));
      result = { rows };
    } else if (typeof data.error === "string") result = { error: data.error.slice(0, 500) };
    else if (kind === "ask" && typeof data.answerHtml === "string") result = { answerHtml: data.answerHtml, done: !!data.done };
    else if (kind === "detail" && typeof data.detail?.html === "string") result = { detail: data.detail };
    else if (kind === "save" && data.saved === savedId) result = { saved: savedId, folder: String(data.folder || "").slice(0, 300) };
    if (result) panel.webContents.send("quick:render", { kind, query, ...result });
  });
  const available = id => id && (choices.search.has(id) || choices.ask.has(id) || id === savedId);
  ipcMain.on("quick:submit", (event, action, text) => {
    if (!isPanel(event) || typeof text !== "string") return;
    if (action === "hide") return hide();
    if (action === "save" || action === "organize") {
      if (!ready) return query("save", text);
      if (!draft || saving || !draft.text.trim() || draft.id !== text) return;
      saving = action;
      return query("save", text, { draft, organize: action === "organize" });
    }
    if (action === "search" || action === "ask" || (action === "detail" && available(text))) {
      if (text.trim()) query(action, text);
      return;
    }
    if (action === "open" && (available(text) || pending.get("detail")?.query === text)) {
      hide();
      revealMain();
      if (ready) mainSend("quick:action", { action, text });
    }
  });
  return () => {
    screen.off("display-metrics-changed", fitCurrentDisplay);
    screen.off("display-removed", fitCurrentDisplay);
    if (activeKey) globalShortcut.unregister(activeKey);
    hide();
    clearTimeout(releaseTimer);
    panel?.destroy();
  };
}
module.exports = { installQuickPanel };
