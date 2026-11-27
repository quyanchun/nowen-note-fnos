const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("palette", {
  query: value => ipcRenderer.send("quick:type", value),
  height: (value, expanded) => ipcRenderer.send("quick:height", value, expanded),
  draft: value => ipcRenderer.send("quick:draft", value),
  submit: (action, text = "") => ipcRenderer.send("quick:submit", action, text),
  onClear: callback => ipcRenderer.on("quick:clear", () => callback()),
  onReset: callback => ipcRenderer.on("quick:reset", (_event, state) => callback(state)),
  onResults: callback => ipcRenderer.on("quick:render", (_event, data) => callback(data)),
});
