# 脉序 · Tideweave

澜州联运区的离线图论解谜游戏。当前为 **0.1.0 可玩开发版**，覆盖最终设计表的 20 个玩法单元、49 个小关（含主线、选修与操作过渡）。本版使用原创程序城市示意与基础设施图形，尚未使用最终美术图。

## 便携版说明（当前未重新打包）

发布包已按要求从当前项目的 `release/` 目录删除，本轮没有重建。以下为便携版的目标与历史使用方式，不是当前试玩入口：支持 Windows 10/11 x64，解压整个 `Tideweave-win32-x64` 文件夹后双击 `Tideweave.exe`；内含 Chromium，无需目标电脑安装 Python、Node、Edge 或 WebView2。

**迁移时复制整个文件夹，不能只复制 EXE。** 正常情况下存档为 `data/progress.json`，备份为 `data/progress.json.bak`，一起复制即可续玩。请在可写目录（如用户文档、普通磁盘目录）运行。若目录不可写，将回退到系统用户目录并在设置中告知位置，迁移前通过设置导出存档。

游戏未做商业代码签名。Windows 可能提示未知发布者；不要通过关闭系统安全防护来绕过告警。先核对来源与 `release.json` 校验信息。其他电脑的真实硬件与驱动仍需试玩验证，不能以本机测试代替跨机认证。

## 当前本地试玩

本轮修改只更新本地源码和开发用 `dist/`，没有重建发布包。请在本目录双击 `Start-Tideweave.cmd`，或在 PowerShell 运行 `npm start`；两个入口都会先编译最新源码，再启动开发版 Electron。此前另存的旧发布包不包含本轮界面和交互修复。

开发版存档位于本目录 `data/`，与旧发布包的存档分开。主菜单的“开始游戏 / 继续游戏”直接进入当前进度；“章节选择”用于浏览主线路线与本章选修。选择关卡后先看目标，再按“进入关卡”。关卡页显示目标和基本操作，补充条件在底部“完整规则”查看。

2026-10-17 玩法修订保留 49 个关卡 ID，替换了重复地图并强化中后期规划。旧版已通关与徽记会保留，改变题目的编辑方案会重置；选关页标明“旧版已通关”，完成新版后记录新版方案。旧成绩不会被当成新题答案，回放会说明当前展示的是新版参考方案。详见 `GAMEPLAY_CHANGES.md`。

## Mac 原生版（Swift + WKWebView）

`mac/` 是 Mac 专用的原生外壳：AppKit 窗口和菜单 + 系统自带的 WKWebView，加载同一份 `dist/` 前端，不打包 Chromium（App 约 50 MB）。它向页面提供与 Electron 版相同的 `window.tideweave` 接口（退出、导出导入、关窗前存档），并带 `sync: true`：存档照网页版存在网页存储里，**开启云同步**。网页本身不能联网，`/api/` 请求由壳代理到同步服务（默认 `http://31.58.87.41:8080`，见 `mac/Info.plist` 的 `TideweaveSyncServer`，可用 `defaults write local.tideweave.mac SyncServer <地址>` 改）。

- 构建：在本目录运行 `npm run package:mac`（只需 Xcode 命令行工具，不需要完整 Xcode），产物为 `release/mac/Tideweave.app`；`npm run start:mac` 构建后直接打开。已有最新 `dist/` 时可用 `SKIP_WEB_BUILD=1 bash mac/build.sh` 跳过前端编译。
- 存档：在 App 的网页存储里（`~/Library/WebKit/local.tideweave.mac`），与网页版同一套同步码；不写进 App 包，重新构建不会丢档。早期版本留在 `~/Library/Application Support/Tideweave/progress.json` 的进度会在首次启动时自动迁入。
- 习惯：⌘Q / ⌘W 退出前先存档并尽量推送云端（最多等 3 秒）；⌘Z 撤销、⌃⌘F 全屏；标题栏自动跟随页面顶部颜色。
- 签名：仅 ad-hoc 签名、未公证，适合自用；拷到别的 Mac 首次打开需右键“打开”。
- 调试：`defaults write local.tideweave.mac WebInspector -bool true` 后可用 Safari 网页检查器。

## 玩法

- 章节目标在章末转场时展示：完成本章最后一个普通关后，先看本章总结，选择“前往下一章”才显示下一章目标，确认后进入关卡。浏览章节标签、直接进关或重玩都不弹出目标。
- 规划完成后运行，观察路径、传播或施工结果。可暂停、逐步、加速、跳过和返回编辑。
- 点选对象，使用撤销、重做与重置调整。不按试错、提示或旋转次数扣分。
- 基础规则随时可看。累计 3 次有效运行且尚未完美后，策略提示入口解锁，仍需主动打开。
- 完成本章全部普通关后开放本章所有选修单元，不要求徽记或后续章节成绩；单元内的小关仍按顺序开放。选修不阻塞下一章，章末可以选择继续主线或挑战本章选修。
- 完成任务后可在“筹算回放”查看过程；最短路、Prim/Kruskal、Floyd、强连通缩点和匹配增广会显示关键中间步骤；章末点明本章规律。
- 立体着色依次使用四面体操作入门、七面五棱柱、十四面截角八面体，全由 Three.js 程序生成，无模型文件。展开图按真实共享棱展开，保留配对棱号；WebGL 不可用时回退到同数据展开图。
- 部分后期配色关明确限制最多颜色数，最少色数仍作为徽记挑战。不能通过无限增加颜色绕过全部规划。
- UI 使用石墨、雾白、水青、稻黄、赭金与朱红的语义配色。独立主菜单、主线与选修切换、任务预览和出发按钮分工明确；场景与标识保持现代东方水利工程的原创表达。
- 主界面标题下明确标注“图论学习游戏”。关卡界面使用雾白标题与目标区、浅灰绿棋盘和炭黑操作栏，以少量暖橙突出“运行检查”，不再使用黄色上下边框；小圆角、切角、圆形工具键和胶囊开关按功能区分。页面切换、选章、选关和弹窗有短暂入场动效；连续编辑棋盘不会反复播放。设置与系统的减少动态效果选项均生效。

键盘支持 Tab/Enter/空格操作、Ctrl+Z 撤销、Ctrl+Shift+Z 重做、1–6 色样或分组选择。立体画布使用方向键旋转，面选择菜单及“着色”按钮提供不依赖鼠标的操作。

## 开发与构建

开发机需要 Node 22+（当前在 Node 24 验证）。

从仓库根目录进入 `Tideweave/` 后运行以下命令。首次安装开发依赖需要联网，游戏运行本身离线；已有依赖的本地目录可直接运行 `npm start`。

```powershell
npm ci
npm test
npm run build
npm start
npm run verify:ui
node scripts/verify-pointer.mjs
node scripts/verify-design.mjs
node scripts/verify-chapters.mjs
node scripts/verify-interactions.mjs
node scripts/verify-replays.mjs
node scripts/verify-local-desktop.mjs
node scripts/verify-overhaul.mjs
node scripts/verify-interface.mjs
```

发布打包与远程上传仅在用户明确要求时执行，本次源码上传不生成发布包。`npm run preview` 仅用于开发检查，会启动本机随机端口 HTTP 服务，实际桌面游戏不依赖该服务。已有依赖时无需重复安装。

离线标题字体已包含在 `assets/fonts/` 中，正常构建不需要原字体或 Python。只有增加标题用字、需要重新裁剪字体时，才需安装 `fonttools` 和 `brotli`，并运行 `python scripts/subset-display-font.py "原始思源宋体粗体.otf的路径"`；再运行 `npm run build`。

## 结构

- `src/levels.mjs`：关卡、前置、目标、提示和章末知识。
- `src/refinements.mjs`：当前玩法修订；旧题快照用于兼容既有存档。
- `src/briefs.mjs`：从实际关卡参数生成白话目标、操作、可选规则与先解释后命名的知识总结。
- `src/engine.mjs`、`algorithms.mjs`：规则判定与算法。
- `src/main.mjs`、`game.css`：当前 UI 入口与样式。
- `src/ui-motion.mjs`：界面入场动效、导航焦点与横向章节滚动位置保护。
- `src/board.mjs`、`solids.mjs`、`solid-view.mjs`：二维棋盘与共享面数据。
- `src/solid-nets.mjs`：按真实棱生成不重叠的多面体展开图。
- `src/session.mjs`、`progress.mjs`：历史栈、进度与提示。
- `desktop/`：安全桌面壳、原子存档、导入导出。
- `mac/`：Mac 原生壳（Swift / AppKit / WKWebView）与构建脚本，接口与 `desktop/` 一致。
- `tests/`、`scripts/verify-ui.mjs`：规则及逐关 UI 验证。
- `assets/`：替换素材目录；详见 `ASSETS_NEEDED.md`。

当前还应继续做新玩家难度试玩、最终美术替换和跨电脑兼容验证。自动测试不等于游戏体验已经达到成品质量。当前回放是可玩的过程说明，不等于完整的算法课程或代码级演示。

## Git / 发布

仓库为 `https://github.com/HenryShiBinLe/vibe1024`，默认分支为 `main`。本游戏位于仓库根下的 `Tideweave/`，与 `test0/`、`test1/` 同级；`Tideweave/package.json` 即项目入口，不额外嵌套一层游戏文件夹。

本地 Git 仓库位于游戏目录上一级，已接入同一远程历史，可直接在 `Tideweave/` 内继续修改。提交时只暂存本项目路径，保留 `test0/`、`test1/` 不变。未经用户明确指示不进行后续提交、推送、PR 或 release 上传。不得将密钥、`data/`、`node_modules/`、`work/`、`verification/` 或构建目录加入源码提交。
