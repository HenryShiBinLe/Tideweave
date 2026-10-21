# Windows 同步版外壳（win/）

带云同步的 Windows 版。队友的离线版（`desktop/`、`scripts/package.mjs`、`npm run package`）原样保留，两个版本互不影响。做法与 Mac 版（`mac/`）一致。

## 和离线版的区别

| | 离线版（desktop/） | 同步版（win/） |
|---|---|---|
| 页面地址 | `file://…/dist/index.html` | `tideweave://app/index.html`（自定义协议，见 `protocol.cjs`） |
| 云同步 | 无 | 有。`/api/` 请求由主进程转发给同步服务，对网页来说是同源请求 |
| 网页能否联网 | 不能（拦截 http/https/ws） | 同样不能，拦截规则不变；同步只走主进程转发 |
| 存档 | exe 旁边的 `data/progress.json` | exe 旁边的 `data/runtime/`（网页存储，与网页版、Mac 版同一套同步层）；整个文件夹拷走仍可带走进度 |
| 旧存档 | — | 第一次启动时把 `data/progress.json` 迁移进网页存储（只做一次；网页存储已有进度就不动） |

其余（单实例、窗口大小、权限全部拒绝、导出导入、关窗前存档确认、最小化时暂停音乐）都照离线版的做法。存档的格式检查复用 `desktop/storage.cjs`。

## 文件

- `main.cjs`：主进程。
- `preload.cjs`：与离线版相同的 `window.tideweave` 接口，外加 `sync: true` 和旧存档迁移。
- `protocol.cjs`：`tideweave://app/` 的处理逻辑：读 `dist/`（支持 Range，音频要用）、防目录穿越、转发 `/api/`。不依赖 Electron，测试见 `tests/win-shell.test.mjs`。
- `config.cjs`：默认同步服务地址 `http://31.58.87.41:8080`。测试时可用环境变量 `TIDEWEAVE_SYNC_SERVER` 临时改，设为空字符串则不联网。
- `package.mjs`：打包脚本。

## 本机运行和打包

```bash
npm run start:win-sync     # 构建后用本机 Electron 运行同步版（Mac 上也能跑，便于调试）
npm run package:win-sync   # 打包到 release/win-sync/Tideweave-win32-x64/Tideweave.exe
```

- 打包用 Node 22（脚本里已写成 `npx -y node@22`）。Node 24.16 起有个流的回归（nodejs/node#62557），packager 解压 Electron 用的 extract-zip 2.0.1 → yauzl 2.x 会在解压途中永远停住、进程静默退出（10/21 实测 Node 26.3 会卡住，Node 22.23 正常）。在受影响的 Node 上直接运行 `win/package.mjs` 会报错说明原因。
- Mac 上也能打 Windows 包：packager 会下载同版本的 win32-x64 Electron（缓存在本机），写 exe 文件信息用的是纯 JS 的 resedit，不需要 Wine。
- 发布目录里有 `data/`（玩家存档）时拒绝覆盖，规矩和离线版脚本一样。

## 验证记录

- 10/21 Mac 上用本机 Electron 跑冒烟测试，Windows 11（Parallels 虚拟机）上跑打包好的 exe，两边测试项相同，全部通过：
  - 页面地址是 `tideweave://app/index.html`，`sync` 为 true；
  - 旧存档迁移（主音量 0.37 作记号）；
  - 网页直连同步服务被拦截，同源 `/api/` 转发成功；
  - 4 个音频都能播放；
  - 开启云同步后状态是“已同步”；
  - 走前端的退出流程后进程自行结束。
- 第一次测试时虚拟机连的是 Mac 上的测试同步服务（`TIDEWEAVE_SYNC_SERVER`）。Mac 上的网页版用 exe 生成的同步码接上了，状态“已同步”；服务端日志里两边的请求都在。
- 控制台里有一条 `GET /api/v1/save 404`：开启同步时先拉取云端，新同步码在云端还不存在，拿到 404 后再创建（`src/sync/sync.mjs` 的设计）。网页版也一样，不是错误。
- 10/21 19:13 用默认的线上同步服务（`http://31.58.87.41:8080`，不设环境变量）在虚拟机里再测一次，测试项同上，全部通过。同源转发到美国 VPS 的健康检查用时 583 ms；开启同步后状态为“已同步”。线上服务端用 `admin.mjs list` 查到这个测试码的版本 1，保存时间和 exe 显示的一致；日志里的请求顺序是“查询 404 → 创建 → 拉取”。这个测试码（THZN-3X7Z-GBTT，空进度）留在了线上，服务端没有删除命令。
- 没测：在真实 Windows 电脑上的声音听感，以及开着同步时断网、恢复的情况。断网、恢复的逻辑是同步层共用的，有单元测试覆盖。
