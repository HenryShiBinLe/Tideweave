# 脉序 · Tideweave

澜州联运区的离线图论解谜游戏。当前为 **0.1.0 可玩开发版**，覆盖最终设计表的 20 个玩法单元、49 个小关（含主线、选修与操作过渡）。本版使用原创程序城市示意与基础设施图形，尚未使用最终美术图。

## 便携版说明（当前未重新打包）

发布包已按要求从当前项目的 `release/` 目录删除，本轮没有重建。以下为便携版的目标与历史使用方式，不是当前试玩入口：支持 Windows 10/11 x64，解压整个 `Tideweave-win32-x64` 文件夹后双击 `Tideweave.exe`；内含 Chromium，无需目标电脑安装 Python、Node、Edge 或 WebView2。

**迁移时复制整个文件夹，不能只复制 EXE。** 正常情况下存档为 `data/progress.json`，备份为 `data/progress.json.bak`，一起复制即可续玩。请在可写目录（如用户文档、普通磁盘目录）运行。若目录不可写，将回退到系统用户目录并在设置中告知位置，迁移前通过设置导出存档。

游戏未做商业代码签名。Windows 可能提示未知发布者；不要通过关闭系统安全防护来绕过告警。先核对来源与 `release.json` 校验信息。其他电脑的真实硬件与驱动仍需试玩验证，不能以本机测试代替跨机认证。

## 当前本地试玩

本轮修改只更新本地源码和开发用 `dist/`，没有重建发布包。请在本目录双击 `Start-Tideweave.cmd`，或在 PowerShell 运行 `npm start`；两个入口都会先编译最新源码，再启动开发版 Electron。此前另存的旧发布包不包含本轮界面和交互修复。

开发版存档位于本目录 `data/`，与旧发布包的存档分开。首次试玩建议从章节地图第一关开始；关卡页显示目标和完整的基本操作，补充条件在底部“完整规则”按钮中查看。

## 玩法

- 章节目标在章末转场时展示：完成本章最后一个普通关后，先看本章总结，选择“前往下一章”才显示下一章目标，确认后进入关卡。浏览章节标签、直接进关或重玩都不弹出目标。
- 规划完成后运行，观察路径、传播或施工结果。可暂停、逐步、加速、跳过和返回编辑。
- 点选对象，使用撤销、重做与重置调整。不按试错、提示或旋转次数扣分。
- 基础规则随时可看。累计 3 次有效运行且尚未完美后，策略提示入口解锁，仍需主动打开。
- 完成本章全部普通关后开放本章所有选修单元，不要求徽记或后续章节成绩；单元内的小关仍按顺序开放。选修不阻塞下一章，章末可以选择继续主线或挑战本章选修。
- 完成任务后可在“筹算回放”查看过程；最短路、Prim/Kruskal、Floyd、强连通缩点和匹配增广会显示关键中间步骤；章末点明本章规律。
- 立体着色使用 Three.js 程序立方体与四面体。共享棱才相邻；展开图保留真实邻接与棱号。WebGL 不可用时回退到同数据展开图。
- UI 使用墨色、米白、水青、稻黄、赭金与朱红的语义配色：路线选择、当前任务、挑战徽记和错误反馈各自有稳定颜色，场景底色保持低饱和以突出棋盘。

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
```

发布打包与远程上传仅在用户明确要求时执行，本次源码上传不生成发布包。`npm run preview` 仅用于开发检查，会启动本机随机端口 HTTP 服务，实际桌面游戏不依赖该服务。已有依赖时无需重复安装。

离线标题字体已包含在 `assets/fonts/` 中，正常构建不需要原字体或 Python。只有增加标题用字、需要重新裁剪字体时，才需安装 `fonttools` 和 `brotli`，并运行 `python scripts/subset-display-font.py "原始思源宋体粗体.otf的路径"`；再运行 `npm run build`。

## 结构

- `src/levels.mjs`：关卡、前置、目标、提示和章末知识。
- `src/briefs.mjs`：从实际关卡参数生成白话目标、操作、可选规则与先解释后命名的知识总结。
- `src/engine.mjs`、`algorithms.mjs`：规则判定与算法。
- `src/main.mjs`、`game.css`：当前 UI 入口与样式。
- `src/board.mjs`、`solids.mjs`、`solid-view.mjs`：二维棋盘与共享面数据。
- `src/session.mjs`、`progress.mjs`：历史栈、进度与提示。
- `desktop/`：安全桌面壳、原子存档、导入导出。
- `tests/`、`scripts/verify-ui.mjs`：规则及逐关 UI 验证。
- `assets/`：替换素材目录；详见 `ASSETS_NEEDED.md`。

当前还应继续做新玩家难度试玩、最终美术替换和跨电脑兼容验证。自动测试不等于游戏体验已经达到成品质量。当前回放是可玩的过程说明，不等于完整的算法课程或代码级演示。

## Git / 发布

仓库为 `https://github.com/HenryShiBinLe/vibe1024`，默认分支为 `main`。本游戏位于仓库根下的 `Tideweave/`，与 `test0/`、`test1/` 同级；`Tideweave/package.json` 即项目入口，不额外嵌套一层游戏文件夹。

本地 Git 仓库位于游戏目录上一级，已接入同一远程历史，可直接在 `Tideweave/` 内继续修改。提交时只暂存本项目路径，保留 `test0/`、`test1/` 不变。未经用户明确指示不进行后续提交、推送、PR 或 release 上传。不得将密钥、`data/`、`node_modules/`、`work/`、`verification/` 或构建目录加入源码提交。
