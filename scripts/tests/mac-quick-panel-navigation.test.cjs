const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("submitting searches and questions keeps the editor hidden until a note is opened", async (t) => {
  const ipcMain = new EventEmitter();
  ipcMain.handle = () => {};
  let toggle, panel, mainShows = 0;
  const sent = [];
  function contents() {
    return Object.assign(new EventEmitter(), { mainFrame: {}, send(channel, data) { sent.push([channel, data]); }, setWindowOpenHandler() {} });
  }
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = contents(); panel = this; }
    getNativeWindowHandle() {}
    setVisibleOnAllWorkspaces() {}
    setBounds(bounds) { this.bounds = bounds; }
    getBounds() { return this.bounds || {x: 0, y: 0, width: 680, height: 68}; }
    show() {}
    focus() {}
    hide() {}
    isDestroyed() { return false; }
    destroy() { this.emit("closed"); }
    async loadFile() {}
  }
  const main = { webContents: contents(), isDestroyed: () => false, isMinimized: () => false, show() { mainShows++; }, focus() {} };
  let area = { x: -1920, y: 25, width: 1920, height: 1080 };
  const screen = Object.assign(new EventEmitter(), {
    getCursorScreenPoint: () => ({}),
    getDisplayNearestPoint: () => ({ workArea: area }),
    getDisplayMatching: () => ({ workArea: area }),
  });
  const desktop = { app: { isPackaged: false }, ipcMain, BrowserWindow: Window, screen,
    globalShortcut: { register(_key, callback) { toggle = callback; return true; }, unregister() {} } };
  const deps = { electron: desktop, "../security": { assertMainWindowSender: event => event.sender !== main.webContents },
    "../settings": { readSettings: () => ({}) }, "node:path": path };
  const file = require.resolve("../../electron/quick-panel");
  const context = { module: { exports: {} }, __dirname: path.dirname(file), require: key => key.endsWith("quick-panel-corners.node") ? () => {} : deps[key], setTimeout, clearTimeout, setImmediate };
  vm.runInNewContext(readFileSync(file, "utf8"), context, { filename: file });
  const dispose = context.module.exports.installQuickPanel(() => main);
  const send = (win, channel, ...args) => ipcMain.emit(channel, {sender: win.webContents, senderFrame: win.webContents.mainFrame}, ...args);
  try {
    send(main, "quick:ready", true);
    toggle();
    await new Promise(resolve => setImmediate(resolve));
    await t.test("fits content within the current work area and resizes on display changes", () => {
      const bar = panel.getBounds();
      assert.equal(bar.height, 68);
      assert.equal(bar.width, 680);
      send(panel, "quick:height", 220, false);
      assert.equal(panel.getBounds().height, 288);
      send(panel, "quick:height", 3000, false);
      const long = panel.getBounds();
      assert.equal(long.y, bar.y);
      assert.equal(long.width, 920);
      assert.equal(long.x + long.width / 2, bar.x + bar.width / 2);
      send(panel, "quick:height", 0, false);
      assert.deepEqual(panel.getBounds(), bar);
      assert.ok(long.height > 700 && long.y + long.height < area.y + area.height);
      send(panel, "quick:height", 3000, true);
      const split = panel.getBounds();
      assert.ok(split.width > long.width && split.width < 1350);
      send(panel, "quick:height", 3000, false);
      assert.deepEqual(panel.getBounds(), long);

      for (const [w, h] of [[1440, 900], [800, 560], [600, 400], [3440, 1440]]) {
        area = { x: -w, y: -h, width: w, height: h };
        screen.emit("display-metrics-changed", {}, { workArea: area }, ["workArea"]);
        const b = panel.getBounds();
        assert.ok(b.x > area.x && b.x + b.width < area.x + w);
        assert.ok(b.y > area.y && b.y + b.height < area.y + h);
        if (w === 1440) assert.ok(b.width > 680 && b.width < long.width && b.height < long.height);
        if (w === 3440) assert.ok(b.width <= 980 && b.height <= 960);
      }
      send(panel, "quick:height", 0, false);
      assert.equal(panel.getBounds().height, 68);
    });
    for (const kind of ["search", "ask"]) {
      send(panel, "quick:submit", kind, "青柚");
      const [channel, request] = sent.at(-1);
      assert.equal(channel, "quick:query");
      assert.equal(request.kind, kind);
      send(main, "quick:results", { ...request, ...(kind === "ask" ? {answerHtml: "<p>回答</p>", done: true} : {rows: [{id: "n", title: "青柚"}]}) });
      assert.equal(sent.at(-1)[0], "quick:render");
    }
    const count = sent.length;
    send(panel, "quick:submit", "detail", "unknown");
    send(panel, "quick:submit", "open", "unknown");
    assert.equal(sent.length, count);
    send(panel, "quick:submit", "detail", "n");
    const request = sent.at(-1)[1];
    assert.equal(request.kind, "detail");
    send(main, "quick:results", { ...request, detail: { title: "青柚", html: "<p>正文</p>", notice: "" } });
    assert.equal(sent.at(-1)[1].detail.html, "<p>正文</p>");
    assert.equal(mainShows, 0);
    assert.equal(sent.some(([channel]) => channel === "quick:action"), false);
    send(panel, "quick:submit", "open", "n");
    assert.equal(mainShows, 1);
    assert.equal(sent.at(-1)[1].action, "open");
  } finally { dispose(); }
});
