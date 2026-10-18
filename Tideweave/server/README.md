# 云同步服务端

按同步码存取存档“信封”的小服务：带版本号防覆盖、保留历史版本，不解析进度内容。设计见 [docs/云同步-技术方案.md](../../docs/云同步-技术方案.md)。

- 零依赖，只用 Node 自带模块（Node 18.15+，部署用 Node 24 LTS）；
- 不依赖游戏代码，部署时只需要 `server/` 目录（同时托管网页版时再加 `dist/`）。

## 本机运行

在 `Tideweave/` 目录下：

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
| `TRUST_PROXY` | `0` | 前面有反向代理时设为 `1`，按 `X-Forwarded-For` 认客户端 IP |
| `MIN_FREE_MB` | `500` | 磁盘剩余低于这个值时拒绝新建同步码 |

## 部署到国内服务器

前提：服务器能用 SSH 公钥登录，登录用户有 sudo 权限；安全组放行 TCP 22 和对外端口（默认 8080）。下面的命令在服务器上执行，除非特别说明。

**1. 装 Node**（从 npmmirror 下载，自动取最新的 v24 并核对校验和；ARM 服务器把 `linux-x64` 换成 `linux-arm64`）：

```bash
V=$(curl -sL https://registry.npmmirror.com/-/binary/node/index.json | grep -o '"version":"v24\.[0-9.]*"' | head -1 | cut -d'"' -f4)
cd /tmp && curl -fLO "https://registry.npmmirror.com/-/binary/node/$V/node-$V-linux-x64.tar.xz"
curl -fsL "https://registry.npmmirror.com/-/binary/node/$V/SHASUMS256.txt" | grep "node-$V-linux-x64.tar.xz" | sha256sum -c -
sudo mkdir -p /opt/node && sudo tar -xJf "node-$V-linux-x64.tar.xz" -C /opt/node --strip-components=1 && /opt/node/bin/node -v
```

**2. 建运行用户和程序目录**：

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin tideweave
sudo mkdir -p /opt/tideweave
```

**3. 上传代码**（在本机 `Tideweave/` 目录下执行；同时托管网页版时把 `dist/` 也传上去）：

```bash
rsync -av --delete --exclude data/ --rsync-path="sudo rsync" server/ 用户名@服务器IP:/opt/tideweave/server/
```

**4. 装成系统服务**：

```bash
sudo cp /opt/tideweave/server/tideweave-sync.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now tideweave-sync
curl -s http://127.0.0.1:8080/api/v1/health
```

服务器开了 ufw 防火墙的话再执行 `sudo ufw allow 8080/tcp`。最后用手机流量（关掉代理）访问 `http://服务器IP:8080/api/v1/health`，看到 `{"ok":true}` 就通了。

**更新代码**：重复第 3 步，然后 `sudo systemctl restart tideweave-sync`。

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
