// 云同步 · 给前端用的入口
//
// 网页版在启动时创建一个同步层，读档、存档都经过它；桌面版（有 window.tideweave）不启用同步，保持离线。
// 前端接入的范围和方式见 docs/协作约定-存档与云同步.md 第六部分；改 main.mjs 之前要先和 @aliezXDD 打招呼。
import { createSyncController } from "./controller.mjs";

export { formatCode, parseCode } from "./code.mjs";
export { PROGRESS_KEY, META_KEY, BACKUP_KEY } from "./controller.mjs";

// 在 localStorage 里写这个键可以指定同步服务地址；正式部署时网页版和同步服务同源，不需要设置。
// 注意：index.html 的 CSP 只允许连同源（connect-src 'self'），填别的地址会被浏览器拦下。
// 本机开发请让同步服务同时托管网页：npm run build 后 STATIC_DIR=dist node server/index.mjs
export const SERVER_OVERRIDE_KEY = "tideweave-sync-server";

function serverAddress() {
  try {
    return globalThis.localStorage?.getItem(SERVER_OVERRIDE_KEY) || "";
  } catch {
    return "";
  }
}

// 当前环境能不能用云同步：网页版可以；Windows 桌面版（Electron 提供 window.tideweave）保持离线；
// Mac 原生版的 window.tideweave 带 sync: true，表示由它代理同步请求，照网页版的方式存档和同步
export const syncAvailable = () => typeof window !== "undefined" && (!window.tideweave || window.tideweave.sync === true) && typeof localStorage !== "undefined";

// 用浏览器的默认环境创建同步层（localStorage、window、document、同源服务地址）
export function createSync(options = {}) {
  return createSyncController({ storage: globalThis.localStorage, server: serverAddress(), ...options });
}
