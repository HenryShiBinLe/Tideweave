# Mac 版（mac/）

Mac 专用的原生外壳：AppKit 窗口和菜单 + 系统自带的 WKWebView，加载同一份 `dist/` 前端，不打包 Chromium（App 约 50 MB，安装镜像约 58 MB）。只支持 Apple 芯片（M1 及以后）、macOS 13+。

## 构建

只需 Xcode 命令行工具，不需要完整 Xcode。

```bash
npm run package:mac   # 构建 release/mac/Tideweave.app
npm run start:mac     # 构建后直接打开
npm run dmg:mac       # 构建并打成安装镜像 release/mac/Tideweave-<版本>.dmg
```

已有最新 `dist/` 时，可用 `SKIP_WEB_BUILD=1 bash mac/build.sh` 跳过前端编译；已有 App 时，可用 `SKIP_APP_BUILD=1 bash mac/make-dmg.sh` 只做镜像。

安装镜像里有 App、“应用程序”文件夹的替身（拖进去即安装）和 [首次打开说明.txt](首次打开说明.txt)。

## 和页面的接口

向页面提供与 Windows 版（`desktop/`）相同的 `window.tideweave` 接口：退出、导出导入、关窗前存档，并带 `sync: true`。

- **存档**：照网页版存在网页存储里（`~/Library/WebKit/local.tideweave.mac`），和网页版用同一套同步码；不写进 App 包，重新构建不会丢档。早期版本留在 `~/Library/Application Support/Tideweave/progress.json` 的进度，会在首次启动时自动迁入。
- **云同步**：页面加载自 `tideweave://app/`（`Sources/BundleSchemeHandler.swift`），网页本身不能联网，`/api/` 请求由外壳转发给同步服务。默认地址见 `Info.plist` 的 `TideweaveSyncServer`（`http://31.58.87.41:8080`），可用 `defaults write local.tideweave.mac SyncServer <地址>` 改。
- **操作习惯**：⌘Q / ⌘W 退出前先存档，并尽量推送到云端（最多等 3 秒）；⌘Z 撤销，⌃⌘F 全屏；标题栏颜色自动跟随页面顶部。
- **调试**：`defaults write local.tideweave.mac WebInspector -bool true` 后，可用 Safari 的网页检查器调试页面。

## 签名

只有 ad-hoc 签名，没有苹果开发者签名和公证。10/21 用 `syspolicy_check distribution` 检查：签名本身有效，所以不会被系统判为“已损坏”；但没有公证，从网上下载的副本（带隔离标记）第一次打开时会被拒绝。玩家要到“系统设置 → 隐私与安全性”点“仍要打开”，只需一次。彻底解决需要 Apple Developer ID 签名并公证。

## 验证记录

- 10/21：
  - 4 个音频经 `tideweave://` 加载后都能播放；最小化时页面收到 `visibilitychange`，音乐暂停。
  - 安装镜像在本机模拟“下载”状态（加隔离标记）后，从拖入“应用程序”、被系统拦住到在设置里放行，全流程人工走通。
