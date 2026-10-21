// Windows 版 · preload：向页面提供 window.tideweave（与 Mac 版 mac/ 的接口一致）
//   - 带 sync: true，前端据此启用云同步（见 src/sync/index.mjs 的 syncAvailable）；
//   - 页面脚本运行前，把早期离线版留下的存档迁移进网页存储（只做一次，网页存储已有进度就不动；与 Mac 版的迁移规则一致）。
const { contextBridge, ipcRenderer } = require("electron");

try {
  const raw = ipcRenderer.sendSync("save:migration");
  if (raw && !localStorage.getItem("tideweave-progress")) localStorage.setItem("tideweave-progress", raw);
} catch {}

contextBridge.exposeInMainWorld("tideweave", Object.freeze({
  load: () => ipcRenderer.invoke("save:load"),
  save: (data) => ipcRenderer.invoke("save:write", data),
  export: (data) => ipcRenderer.invoke("save:export", data),
  import: () => ipcRenderer.invoke("save:import"),
  fullscreen: () => ipcRenderer.invoke("window:fullscreen"),
  quit: () => ipcRenderer.invoke("window:quit"),
  sync: true,
  onClosing: (callback) => ipcRenderer.on("window:closing", () => callback()),
  confirmClose: (ok) => ipcRenderer.invoke("window:confirm-close", ok),
  onVisibility: (callback) => ipcRenderer.on("window:visibility", (_event, visible) => callback(visible)),
}));
