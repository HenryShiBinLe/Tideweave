# Windows 版（desktop/）

Electron 外壳，加载同一份 `dist/` 前端，带云同步，做法与 Mac 版（`mac/`）一致：

- **页面地址**：`tideweave://app/index.html`（自定义协议，见 `protocol.cjs`）。不用 `file://`，因为 `file://` 页面的源是 null，同源请求和 CSP 的 `'self'` 都对不上。
- **云同步**：`/api/` 请求由主进程转发给同步服务，对网页来说是同源请求。网页本身不能联网，http/https/ws 请求全部拦截。
- **存档**：在 exe 旁边的 `data/runtime/`（网页存储，与网页版、Mac 版是同一套同步层）。整个文件夹拷走仍可带走进度。
- **旧存档**：早期离线版把进度存在 `data/progress.json`。第一次启动时迁移进网页存储，只做一次；网页存储已有进度就不动。
- **其余**：单实例、窗口大小、权限全部拒绝、导出导入、关窗前存档确认、最小化时暂停音乐。存档格式检查在 `storage.cjs`。

10/21 之前仓库里有两个 Windows 外壳：@aliezXDD 的离线版（`desktop/`，不联网，存档写 `progress.json`）和我们的同步版（`win/`）。当天合并成了这一个，离线版去掉。

## 文件

- `main.cjs`：主进程。
- `preload.cjs`：向页面提供 `window.tideweave` 接口（与 Mac 版一致），带 `sync: true`，负责旧存档迁移。
- `protocol.cjs`：`tideweave://app/` 的处理逻辑：读 `dist/`（支持 Range，音频要用）、防目录穿越、转发 `/api/`。不依赖 Electron，测试见 `tests/desktop-shell.test.mjs`。Range 的解析和服务端共用 `server/http-range.cjs`，打包时一起带上。
- `storage.cjs`：存档格式检查和原子写入（迁移、导出导入用）。
- `config.cjs`：默认同步服务地址 `http://31.58.87.41:8080`。测试时可用环境变量 `TIDEWEAVE_SYNC_SERVER` 临时改，设为空字符串则不联网。
- `package.mjs`：打包脚本（程序目录）。
- `installer/Tideweave.iss`：安装包脚本（Inno Setup 6）。同目录的 `ChineseSimplified.isl` 是它用的简体中文界面文字（来源见脚本注释）。
- `Tideweave.ico`：exe、安装包、快捷方式的图标，由 `make-icon.py` 从 Mac 版图标生成。
- `vm-test/`：在 Windows 虚拟机里跑的安装包全流程测试。

## 本机运行和打包

```bash
npm start          # 构建后用本机 Electron 运行（Mac 上也能跑，便于调试）
npm run package    # 打包到 release/windows/Tideweave-win32-x64/Tideweave.exe
```

- 打包用 Node 22（脚本里已写成 `npx -y node@22`）。Node 24.16 起有个流的回归（nodejs/node#62557），packager 解压 Electron 用的 extract-zip 2.0.1 → yauzl 2.x 会在解压途中永远停住、进程静默退出（10/21 实测 Node 26.3 会卡住，Node 22.23 正常）。在受影响的 Node 上直接运行 `desktop/package.mjs` 会报错说明原因。
- Mac 上也能打 Windows 包：packager 会下载同版本的 win32-x64 Electron（缓存在本机），写 exe 文件信息用的是纯 JS 的 resedit，不需要 Wine。
- 发布目录里有 `data/`（玩家存档）时拒绝覆盖。

## 安装包

发给玩家的是 `Tideweave-Setup-<版本>.exe`，双击安装。绿色版 zip（解压即用）作为备选。

- **按当前用户安装**到 `%LOCALAPPDATA%\Programs\Tideweave`：不需要管理员权限，不弹权限确认。
- 自动创建开始菜单快捷方式，桌面快捷方式默认勾选；“设置 → 应用”里能找到“脉序 · Tideweave”并卸载。
- 不让玩家选安装位置。放到网络共享或被重定向的文件夹时，Chromium 沙盒里的子进程启动不了，游戏一打开就闪退。10/21 在 Parallels 虚拟机里遇到过：虚拟机的“桌面”“文档”“下载”都映射到 Mac，日志里是 `GPU process launch failed: error_code=18`。
- 存档在安装目录的 `data\` 里。升级（覆盖安装）不动它，卸载也保留，重新安装后接着玩。
- 升级或卸载时如果游戏开着，会先问一句，然后关掉游戏：先发关闭消息，游戏照常存档、推送后退出；6 秒内没退出再强制结束。静默安装或卸载时不问，直接关。
- exe 和安装包都没有代码签名。玩家第一次运行时 Windows 会提示“Windows 已保护你的电脑”，点“更多信息 → 仍要运行”即可。

### 编译

安装包要在 Windows 上编译，本机用 Parallels 里的 Windows 11 虚拟机（共享文件夹 `Z:` = Mac 的用户目录）。

1. Mac 上：`npm run package`，得到 `release/windows/Tideweave-win32-x64/`。
2. 虚拟机里装 Inno Setup 6（10/21 装的是 6.7.3）。安装程序来自官方 GitHub 发布页，数字签名为 Pyrsys B.V.（Inno Setup 维护者的公司），按当前用户安装：`innosetup-6.7.3.exe /VERYSILENT /CURRENTUSER`。
3. 虚拟机里编译：

```bat
"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" /DSourceDir=Z:\vibe1024\release\windows\Tideweave-win32-x64 /DOutputDir=Z:\vibe1024\release\windows\installer /DAppVersion=0.1.0 Z:\vibe1024\desktop\installer\Tideweave.iss
```

4. 绿色版：Mac 上在 `release/windows/` 下 `zip -r -X -9 installer/Tideweave-Portable-<版本>.zip Tideweave-win32-x64`。打包前确认目录里没有 `data/`。
5. 测试：虚拟机里以当前用户运行 `powershell -ExecutionPolicy Bypass -File Z:\vibe1024\desktop\vm-test\install-test.ps1`。

### 安装包验证记录

- 10/21 Windows 11（ARM 版，Parallels）上用 `vm-test/install-test.ps1` 跑全流程，全部通过：
  1. 全新安装：10 秒；程序、开始菜单、桌面快捷方式、“应用和功能”条目（名称、版本、发布者、图标）都正确；
  2. 启动游戏：页面正常，`sync` 为 true，同步请求转发正常，网页存储写入记号 A；
  3. 游戏开着（写记号 B）时覆盖安装：游戏先被关掉，安装成功，没有残留进程；
  4. 游戏开着（写记号 C）时卸载：游戏被关掉，程序、快捷方式、卸载信息都清掉，只剩 `data\`；
  5. 重新安装：A、B、C 三个记号都在。C 也在，说明游戏是走正常退出流程关掉的，不是被强制结束的。
- 修过的两个问题：
  - 第一版游戏开着时卸载，会留下删不掉的 exe、dll、app.asar，因为 Inno 的卸载程序不会去关正在运行的程序；
  - 第一版游戏开着时升级失败、回滚（退出码 5）。重启管理器同时发现了系统服务 XtaCache（ARM 版 Windows 转译 x64 程序的缓存），没有权限关它，就整个放弃了，替换 `d3dcompiler_47.dll` 时“拒绝访问”。
  - 两个都改成了安装或卸载之前先自己关掉游戏（`installer/Tideweave.iss` 的 `[Code]`）。
- 没测：安装向导的图形界面。测试时虚拟机停在锁屏，向导是用静默参数跑的，向导里的文字和页面还要人工看一遍。

## 验证记录（程序本身）

- 10/21（合并外壳之前，当时在 `win/`）Mac 上用本机 Electron 跑冒烟测试，Windows 11（Parallels 虚拟机）上跑打包好的 exe，两边测试项相同，全部通过：
  - 页面地址是 `tideweave://app/index.html`，`sync` 为 true；
  - 旧存档迁移（主音量 0.37 作记号）；
  - 网页直连同步服务被拦截，同源 `/api/` 转发成功；
  - 4 个音频都能播放；
  - 开启云同步后状态是“已同步”；
  - 走前端的退出流程后进程自行结束。
- 第一次测试时虚拟机连的是 Mac 上的测试同步服务（`TIDEWEAVE_SYNC_SERVER`）。Mac 上的网页版用 exe 生成的同步码接上了，状态“已同步”；服务端日志里两边的请求都在。
- 控制台里有一条 `GET /api/v1/save 404`：开启同步时先拉取云端，新同步码在云端还不存在，拿到 404 后再创建（`src/sync/sync.mjs` 的设计）。网页版也一样，不是错误。
- 10/21 19:13 用默认的线上同步服务（`http://31.58.87.41:8080`，不设环境变量）在虚拟机里再测一次，测试项同上，全部通过。同源转发到美国 VPS 的健康检查用时 583 ms；开启同步后状态为“已同步”。线上服务端用 `admin.mjs list` 查到这个测试码的版本 1，保存时间和 exe 显示的一致；日志里的请求顺序是“查询 404 → 创建 → 拉取”。这个测试码（THZN-3X7Z-GBTT，空进度）留在了线上，服务端没有删除命令。
- 10/21 合并外壳后：`scripts/verify-local-desktop.mjs` 在 Mac 上通过（资源加载、立体关渲染、规则弹窗、关窗存档后重开进度还在）。`scripts/verify-audio.mjs` 在 Mac 上停在“道路编辑恰好一次点击音”这一步（实际 1 次、期望 2 次）。合并前的原始代码在 Mac 上同样停在这里，不是合并引起的；这个脚本是在 Windows 上写的，Windows 上没有重跑。
- 没测：在真实 Windows 电脑上的声音听感，以及开着同步时断网、恢复的情况。断网、恢复的逻辑是同步层共用的，有单元测试覆盖。
