#!/usr/bin/env bash
# 云同步服务 · 没有 root 权限时的常驻脚本（例如美国 VPS 上的 agent 账号；有 root 时用 tideweave-sync.service）
#
#   server/run-user.sh start  [配置文件]   后台启动（已在运行就跳过）
#   server/run-user.sh stop   [配置文件]   停止
#   server/run-user.sh status [配置文件]   查看状态和健康检查
#
# 配置文件默认是同目录的 run-user.env，里面写 NODE、HOST、PORT、DATA_DIR、STATIC_DIR、LOG_DIR 等（见 README）。
# 开机自启：crontab 里加一行  @reboot sleep 15 && /路径/server/run-user.sh start /路径/配置文件
# 服务崩溃后 3 秒自动重启；日志写到 LOG_DIR/server.log，超过 20 MB 自动轮转，另外保留最近 3 份旧日志。
set -u
here="$(cd "$(dirname "$0")" && pwd)"
command="${1:-status}"
env_file="${2:-$here/run-user.env}"
if [ -f "$env_file" ]; then
  set -a
  . "$env_file"
  set +a
fi
NODE="${NODE:-node}"
LOG_DIR="${LOG_DIR:-$here/logs}"
log="$LOG_DIR/server.log"
pid_file="$LOG_DIR/run.pid"
mkdir -p "$LOG_DIR"

# 进程号文件可能是重启前留下的，进程号又被别的程序占用了，所以还要核对命令行确实是本脚本
running() {
  [ -f "$pid_file" ] || return 1
  local pid
  pid="$(cat "$pid_file")"
  [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q "run-user.sh"
}

case "$command" in
  start)
    if running; then
      echo "已经在运行（进程 $(cat "$pid_file")）"
      exit 0
    fi
    # setsid 让守护循环脱离当前登录会话，退出 SSH 后也继续运行
    setsid nohup "$0" run "$env_file" > /dev/null 2>&1 < /dev/null &
    sleep 2
    if running; then echo "已启动（进程 $(cat "$pid_file")），日志：$log"; else echo "启动失败，请看日志：$log"; exit 1; fi
    ;;
  stop)
    if running; then
      kill "$(cat "$pid_file")"
      echo "已停止"
    else
      echo "没有在运行"
    fi
    ;;
  status)
    if running; then echo "运行中（进程 $(cat "$pid_file")）"; else echo "没有在运行"; fi
    curl -s --max-time 3 "http://127.0.0.1:${PORT:-8080}/api/v1/health" && echo
    ;;
  run)
    # 守护循环，只由 start 调用
    echo $$ > "$pid_file"
    child=""
    rotator=""
    trap 'kill $child $rotator 2> /dev/null; rm -f "$pid_file"; exit 0' TERM INT
    # 日志轮转：每 10 分钟检查一次。服务以追加方式写日志，所以“复制一份再清空”是安全的
    (
      while sleep 600; do
        size="$(stat -c %s "$log" 2> /dev/null || echo 0)"
        if [ "$size" -gt $((20 * 1024 * 1024)) ]; then
          mv -f "$log.2" "$log.3" 2> /dev/null
          mv -f "$log.1" "$log.2" 2> /dev/null
          cp "$log" "$log.1" && : > "$log"
        fi
      done
    ) &
    rotator=$!
    while true; do
      "$NODE" "$here/index.mjs" >> "$log" 2>&1 &
      child=$!
      wait "$child"
      code=$?
      echo "{\"time\":\"$(date -u +%FT%TZ)\",\"level\":\"warn\",\"message\":\"服务退出（代码 $code），3 秒后重启\"}" >> "$log"
      sleep 3
    done
    ;;
  *)
    echo "用法：$0 start|stop|status [配置文件]"
    exit 1
    ;;
esac
