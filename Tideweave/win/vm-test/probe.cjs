// 安装测试用的探针（由 win/vm-test/install-test.ps1 调用）。用装好的 exe 自带的 Node 运行：
//   set ELECTRON_RUN_AS_NODE=1 && Tideweave.exe probe.cjs <exe 目录> <set|get|launch> <记号> <结果文件>
//   set：启动游戏，在网页存储里写记号，走前端退出流程
//   get：启动游戏，读记号和基本状态，走前端退出流程
//   launch：启动游戏后保持运行（测试“游戏开着时升级”），只确认页面起来了
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [dir, mode, mark, outFile] = process.argv.slice(2);
const port = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { mode };

async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TIDEWEAVE_SYNC_SERVER;
  const child = spawn(path.join(dir, "Tideweave.exe"), [`--remote-debugging-port=${port}`], { cwd: dir, env, detached: true, stdio: "ignore" });
  let exited = false;
  child.on("exit", () => { exited = true; });
  child.unref();
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page" && t.url.startsWith("tideweave://")); } catch {}
  }
  if (!target) throw new Error("30 秒内没等到游戏页面");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
  const evaluate = (expression) => new Promise((r) => { const n = ++id; pending.set(n, (msg) => r(msg.result?.result?.value)); ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
  for (let i = 0; i < 40; i++) { if (await evaluate("!!document.querySelector('[data-action=\"resume\"]')")) break; await sleep(500); }
  out.url = await evaluate("location.href");
  out.homeShown = await evaluate("!!document.querySelector('[data-action=\"resume\"]')");
  out.sync = await evaluate("window.tideweave.sync");
  out.proxiedHealth = await evaluate("fetch('/api/v1/health').then(r=>r.status,()=>'failed')");
  // set、launch 都写一个记号（键名带记号本身）；get 读出所有记号
  if (mode === "set" || mode === "launch") out.markWritten = await evaluate(`(localStorage.setItem('tw-install-test-' + ${JSON.stringify(mark)}, '1'), ${JSON.stringify(mark)})`);
  if (mode === "get") out.marks = await evaluate("Object.keys(localStorage).filter(k=>k.startsWith('tw-install-test-')).map(k=>k.slice(16)).sort()");
  if (mode === "launch") return;
  evaluate("window.tideweave.quit()").catch(() => {});
  for (let i = 0; i < 20 && !exited; i++) await sleep(500);
  out.quit = exited ? "进程已结束" : "10 秒后进程还在";
}

main().catch((e) => { out.error = String(e.stack ?? e); }).finally(() => {
  fs.writeFileSync(outFile, JSON.stringify(out));
  process.exit(0);
});
