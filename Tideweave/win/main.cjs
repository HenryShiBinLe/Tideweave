// 脉序 · Tideweave —— Windows 同步版主进程（我方外壳，与 Mac 版 mac/ 对应；队友的离线版 desktop/main.cjs 原样保留）
//
// 和离线版的区别只有三处，其余（便携存档目录、单实例、窗口、权限、导出导入、关窗存档确认）都照离线版的做法：
//   1. 页面从自定义协议 tideweave://app/ 加载（见 protocol.cjs），/api/ 请求由主进程转发给同步服务；
//   2. preload 暴露 sync: true，前端按网页版的方式存档和同步（进度存在网页存储里，位于 data/runtime/）；
//   3. 第一次以同步模式启动时，把离线版留下的 data/progress.json 迁移进网页存储（网页存储已有进度就不动）。
// 网页本身仍然不能联网：http/https/ws 请求照旧全部拦截，同步请求走主进程（Node 的 fetch，不经过网页会话）。
const { app, BrowserWindow, ipcMain, dialog, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { createStore, validate, MAX_BYTES } = require("../desktop/storage.cjs");
const { SCHEME, ENTRY, createHandler } = require("./protocol.cjs");

const { DEFAULT_SYNC_SERVER } = require("./config.cjs");

// 同步服务地址：默认是线上服务；测试时可用环境变量 TIDEWEAVE_SYNC_SERVER 临时改（设为空字符串则不联网）
const syncServer = process.env.TIDEWEAVE_SYNC_SERVER ?? DEFAULT_SYNC_SERVER;

app.setName("Tideweave");
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
// 自定义协议要在 ready 之前登记为“标准、安全”的协议，网页存储（localStorage）和 fetch 才能正常使用；
// stream 让 <audio> 可以按段读取
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

// 存档目录：和离线版一样优先用 exe 旁边的 data/（便携，整个文件夹拷走即可），不可写时退到系统用户目录
const root = app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, "..");
let directory = path.join(root, "data"), portable = true;
try {
  fs.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, ".write-check");
  fs.writeFileSync(probe, "");
  fs.unlinkSync(probe);
} catch {
  directory = path.join(app.getPath("userData"), "saves");
  portable = false;
  fs.mkdirSync(directory, { recursive: true });
}
const runtime = path.join(directory, "runtime");
app.setPath("userData", runtime);
app.setPath("sessionData", runtime);
const store = createStore(directory);
const migratedMarker = path.join(runtime, ".migrated-native-save");
const dist = path.resolve(__dirname, "../dist");

let win;
let closingConfirmed = false;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    protocol.handle(SCHEME, createHandler({ root: dist, syncServer }));
    win = new BrowserWindow({ width: 1440, height: 940, minWidth: 720, minHeight: 620, show: false, backgroundColor: "#f1f3ef", title: "脉序 · Tideweave", autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
    win.removeMenu();
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      if (url !== ENTRY) event.preventDefault();
    });
    win.webContents.on("will-attach-webview", (event) => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (_details, callback) => callback({ cancel: true }));

    // 只接受自己窗口主框架、且来自 tideweave://app/ 的请求
    const trusted = (event) => event.sender === win?.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url.startsWith(`${SCHEME}://`);
    const handle = (channel, fn) =>
      ipcMain.handle(channel, async (event, ...args) => {
        if (!trusted(event)) throw new Error("请求来源无效。");
        return fn(...args);
      });
    // 迁移只做一次：preload 在页面脚本运行前同步调用，拿到离线版的存档原文（没有或已迁移过时为 null）
    // 注意：给 event.returnValue 赋值时 Electron 就立即回复，之后再赋值无效，所以只在最后赋一次
    const migration = (event) => {
      if (!trusted(event) || fs.existsSync(migratedMarker)) return null;
      try {
        fs.mkdirSync(runtime, { recursive: true });
        fs.writeFileSync(migratedMarker, new Date().toISOString());
      } catch {}
      const loaded = store.load();
      return loaded.data ? JSON.stringify(loaded.data) : null;
    };
    ipcMain.on("save:migration", (event) => {
      event.returnValue = migration(event);
    });
    handle("save:load", () => ({ ...store.load(), portable, savePath: store.file }));
    handle("save:write", (value) => store.save(value));
    handle("save:export", async (value) => {
      const raw = validate(value), result = await dialog.showSaveDialog(win, { title: "导出进度", defaultPath: "Tideweave-progress.json", filters: [{ name: "Tideweave 存档", extensions: ["json"] }] });
      if (result.canceled) return false;
      fs.writeFileSync(result.filePath, raw, "utf8");
      return true;
    });
    handle("save:import", async () => {
      const result = await dialog.showOpenDialog(win, { title: "导入进度", properties: ["openFile"], filters: [{ name: "Tideweave 存档", extensions: ["json"] }] });
      if (result.canceled) return null;
      if (fs.statSync(result.filePaths[0]).size > MAX_BYTES) throw new Error("存档过大。");
      const value = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8"));
      validate(value);
      return value;
    });
    handle("window:fullscreen", () => {
      win.setFullScreen(!win.isFullScreen());
      return win.isFullScreen();
    });
    handle("window:quit", () => {
      app.quit();
    });
    handle("window:confirm-close", (ok) => {
      if (ok === true) {
        closingConfirmed = true;
        win.close();
      }
    });
    const notifyVisibility = () => win.webContents.send("window:visibility", win.isVisible() && !win.isMinimized());
    for (const event of ["minimize", "restore", "hide", "show"]) win.on(event, notifyVisibility);
    win.webContents.on("did-finish-load", notifyVisibility);
    // 关窗时先让前端存档（开着同步时还会尽量推送，最多等 3 秒），前端确认后才真正关闭
    win.on("close", (event) => {
      if (!closingConfirmed) {
        event.preventDefault();
        win.webContents.send("window:closing");
      }
    });
    win.once("ready-to-show", () => win.show());
    win.loadURL(ENTRY);
    win.on("closed", () => {
      win = null;
    });
  });
  app.on("window-all-closed", () => app.quit());
}
