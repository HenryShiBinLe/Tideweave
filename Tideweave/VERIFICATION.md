# Tideweave 验证记录

本记录对应 2026-10-17 的本地界面、功能配色、章节转场、选修解锁和操作说明更新。没有重建发布包，没有改动玩家存档。

## 已通过

- `npm test`：80 项规则、边界、初学者文案、线路几何、持久化、回放和选修解锁专项测试通过。
- `npm run verify:ui`：49 个小关都通过实际界面控件完成，检查 390、768、1440 宽度。
- `node scripts/verify-interactions.mjs`：立体面拾取、展开图同步、拖动与点击区分、WebGL 回退、故障测试恢复、章节推进通过。
- `node scripts/verify-replays.mjs`：Prim/Kruskal、增广路径、强连通缩点、Floyd 矩阵和玩家方案保护通过。
- 历史 `node scripts/verify-desktop.mjs`：原 0.1.0 打包 EXE 的离线启动和目录迁移通过；本轮未重新执行，也没有打包最新代码。
- `node scripts/verify-pointer.mjs`：67 条线路的真实鼠标命中、03-02.2 三种合法方案和桌面/手机截图通过。
- `node scripts/verify-local-desktop.mjs`：当前源码 Electron、规则弹窗和隔离关窗存档通过。
- `node scripts/verify-design.mjs`：章节地图不弹目标、离线字体、程序城市像素和 35 组桌面/移动关卡布局通过；没有横向溢出或说明文字裁切。
- `node scripts/verify-chapters.mjs`：五个章末、四次进入下一章前的目标确认、本章选修解锁、取消转场、旧版已读标记兼容、非章末重玩及选修结束后回到本章地图通过。

## 历史发布验证

- 目标：Windows 10/11 x64，内含 Chromium，离线运行。
- EXE：`Tideweave.exe`，SHA-256 记录在同目录 `release.json`。
- 原包约 346 MiB，含 12 份运行时依赖许可证；当前项目的 `release/` 已按要求删除，本轮没有恢复。
- 未做代码签名，也没有在第二台真实 Windows 电脑上验证硬件和驱动兼容性。

## 仍需人工确认

- 当前提交为开发版源码；不要用旧发布包判断当前界面。入口是 `Tideweave/Start-Tideweave.cmd`。

- 找没有学过图论的新玩家试玩，观察目标文字、难度递进、提示出现时机和是否愿意重试。
- 最终美术替换。现在只建议制作 1 张 A01 城市远景；节点外壳和巡运标记仍可继续使用程序图形。
- 在另一台 Windows 10/11 x64 电脑上从解压目录启动并移动整个文件夹测试存档。
