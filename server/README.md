# 云同步服务端

按同步码存取存档“信封”的小服务：带版本号防覆盖、保留历史版本，不解析进度内容。设计见 [docs/云同步-技术方案.md](../../docs/云同步-技术方案.md)。

- 零依赖，只用 Node 自带模块（Node 18.15+，部署用 Node 24 LTS）；
- 不依赖游戏代码，部署时只需要 `server/` 目录（同时托管网页版时再加 `dist/`）。

## 本机运行

在仓库根目录下：

```bash
node server/index.mjs
```

只开接口，数据存在 `server/data/`（已被 `.gitignore` 忽略）。同时托管网页版：先 `npm run build`，再 `STATIC_DIR=dist node server/index.mjs`，浏览器打开 `http://127.0.0.1:8080/`。

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `server/data` | 数据目录 |
| `STATIC_DIR` | 不设 | 顺带托管的网页目录（网页版 `dist/`），不设就不托管 |
| `CORS_ORIGINS` | `http://localhost:*,http://127.0.0.1:*` | 允许跨域访问的来源，逗号分隔；`:*` 表示任意端口 |
| `TRUST_PROXY` | `0` | 前面有 nginx、Caddy 这类转发服务时设为 `1`，按 `X-Forwarded-For` 认客户端 IP |
| `MIN_FREE_MB` | `500` | 磁盘剩余低于这个值时拒绝新建同步码 |

## 部署到国内服务器

前提：服务器能用 SSH 公钥登录，登录用户有 sudo 权限；安全组放行 TCP 22 和对外端口（默认 8080）。下面的命令在服务器上执行，除非特别说明。

**1. 装 Node**（从 npmmirror 下载，自动取最新的 v24 并核对校验和；ARM 服务器把 `linux-x64` 换成 `linux-arm64`。用 `.tar.gz` 而不用 `.tar.xz`：精简系统可能没装 `xz`，10/18 在美国 VPS 上演练时就卡在这一步）：

```bash
V=$(curl -sL https://registry.npmmirror.com/-/binary/node/index.json | grep -o '"version":"v24\.[0-9.]*"' | head -1 | cut -d'"' -f4)
cd /tmp && curl -fLO "https://registry.npmmirror.com/-/binary/node/$V/node-$V-linux-x64.tar.gz"
curl -fsL "https://registry.npmmirror.com/-/binary/node/$V/SHASUMS256.txt" | grep " node-$V-linux-x64.tar.gz\$" | sha256sum -c -
sudo mkdir -p /opt/node && sudo tar -xzf "node-$V-linux-x64.tar.gz" -C /opt/node --strip-components=1 && /opt/node/bin/node -v
```

**2. 建运行用户和程序目录**：

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin tideweave
sudo mkdir -p /opt/tideweave
```

**3. 上传代码**（在本机仓库根目录下执行；同时托管网页版时把 `dist/` 也传上去）：

```bash
rsync -av --delete --exclude data/ --rsync-path="sudo rsync" server/ 用户名@服务器IP:/opt/tideweave/server/
```

**4. 装成系统服务**：

```bash
sudo cp /opt/tideweave/server/tideweave-sync.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now tideweave-sync
curl -s http://127.0.0.1:8080/api/v1/health
```

服务器开了 ufw 防火墙的话再执行 `sudo ufw allow 8080/tcp`。最后用手机流量访问 `http://服务器IP:8080/api/v1/health`，看到 `{"ok":true}` 就通了。

**更新代码**：重复第 3 步，然后 `sudo systemctl restart tideweave-sync`。

## 没有 root 权限时（例如美国 VPS 上的 agent 账号）

用不了 systemd 时，改用 `server/run-user.sh`：后台常驻，崩溃 3 秒后自动重启，日志超过 20 MB 自动轮转；再用 crontab 的 `@reboot` 实现开机自启。下面的命令都在服务器的用户目录里执行，不需要 sudo。

**1. 把 Node 装到用户目录**（国外服务器从 nodejs.org 下载；国内服务器换成上面 npmmirror 的地址）：

```bash
V=v24.22.0; F=node-$V-linux-x64.tar.gz
mkdir -p ~/opt/node && cd ~/opt && curl -fsSLO https://nodejs.org/dist/$V/$F
curl -fsSL https://nodejs.org/dist/$V/SHASUMS256.txt | grep " $F\$" | sha256sum -c -
tar -xzf $F -C node --strip-components=1 && rm $F && ~/opt/node/bin/node -v
```

**2. 上传代码**（在本机仓库根目录下执行）：

```bash
rsync -az --delete --exclude data/ --exclude logs/ server/ 服务器:tideweave/server/
rsync -az --delete --exclude speedtest.html dist/ 服务器:tideweave/www/
rsync -az server/speedtest.html 服务器:tideweave/www/
```

**3. 写配置** `~/tideweave/tideweave.env`：

```bash
NODE=$HOME/opt/node/bin/node
HOST=0.0.0.0
PORT=8080
DATA_DIR=$HOME/tideweave/data
STATIC_DIR=$HOME/tideweave/www
LOG_DIR=$HOME/tideweave/logs
```

**4. 启动，并设置开机自启**（会保留 crontab 里原有的任务）：

```bash
~/tideweave/server/run-user.sh start ~/tideweave/tideweave.env
(crontab -l 2>/dev/null | grep -v -F tideweave/server/run-user.sh; echo "@reboot sleep 15 && $HOME/tideweave/server/run-user.sh start $HOME/tideweave/tideweave.env") | crontab -
```

查看状态、停止服务：把 `start` 换成 `status`、`stop`。

**防火墙**：服务器开着 ufw 时，普通进程监听的端口默认会被挡住。Docker 发布的端口会绕过 ufw，所以别的容器服务能访问，不代表 8080 也能访问。需要用有 sudo 的账号执行一次 `sudo ufw allow 8080/tcp`。

## 测速页

`server/speedtest.html` 部署在网页目录里，地址是 `http://服务器IP:8080/speedtest.html`。用手机流量打开，会测三项：第一次打开游戏要多久（并行下载首屏的四个文件）、同步一次要多久（5 轮“拉取 + 推送 27 KB 存档”）、接口往返延迟。用来判断这台服务器的网络够不够用。

## 运维

```bash
journalctl -u tideweave-sync -f                      # 看日志（只记 IP 前三段和同步码哈希前缀）
ADMIN="sudo -u tideweave DATA_DIR=/var/lib/tideweave-sync /opt/node/bin/node /opt/tideweave/server/admin.mjs"
$ADMIN stats                                          # 同步码数量和占用空间
$ADMIN list XXXX-XXXX-XXXX                            # 某个同步码的历史版本
$ADMIN show XXXX-XXXX-XXXX 12                         # 看某个版本的内容
$ADMIN restore XXXX-XXXX-XXXX 12                      # 把版本 12 写回为新版本（回滚）
sudo tar -czf ~/tideweave-sync-$(date +%F).tgz -C /var/lib tideweave-sync   # 备份数据
```

每个同步码保留最近 20 个版本，外加近 7 天每天最后一个版本。回滚只是把旧内容写成新版本，不删除任何版本；设备下次同步时会和它合并，累积型成绩（通关、徽记、尝试次数）不会因此减少。
