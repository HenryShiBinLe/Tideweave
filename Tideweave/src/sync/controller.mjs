// 云同步 · 调度（同步层的核心）
//
// 负责“什么时候同步、同步结果怎么交给游戏”，规则见 docs/云同步-技术方案.md 第四、六部分：
// - 存档照旧先写本机（localStorage，键名不变），同步在后台进行；同步失败只影响同步状态，不影响游戏；
// - 存档后 5 秒内没有新改动就推送；启动时、切回页面时、网络恢复时、页面在前台时每分钟同步一次；
// - 拉到新进度时，如果前端说现在不能应用（玩家在关卡里），就等能应用时再同步一次并应用；
// - 同步期间玩家又存了档：这一轮的结果不应用（它基于旧存档），马上再同步一轮；
// - 应用云端进度前，把本机存档备份到 tideweave-sync-backup；
// - 失败后退避重试：5 秒起，每次翻倍，最长 5 分钟；被限流时至少等服务端要求的时间。
// 不碰界面：存储、计时器、页面事件、网络都可以注入，所以能在 Node 里测试。
import { createClient as createHttpClient, SyncError } from "./client.mjs";
import { syncOnce as defaultSyncOnce } from "./sync.mjs";
import { touch, cleanClock } from "./clock.mjs";
import { generateCode, parseCode, formatCode } from "./code.mjs";
import { isObject, stableJSON } from "./util.mjs";
import { normalize } from "../progress.mjs";

export const PROGRESS_KEY = "tideweave-progress"; // 游戏本来就用的本机存档键，不改
export const META_KEY = "tideweave-sync"; // 同步层自己的数据：同步码、设备标识、修改时间
export const BACKUP_KEY = "tideweave-sync-backup"; // 应用云端进度前的本机存档备份

const MESSAGES = {
  off: "未开启云同步",
  idle: "等待同步",
  syncing: "正在同步…",
  ok: "已同步",
  offline: "连不上同步服务，稍后自动重试",
  error: "同步出错，稍后自动重试",
  paused: "云端存档来自更新版本的游戏，请先更新游戏",
};

// 设置不同步：比较“存档有没有变”时不看设置
const syncable = (save) => (isObject(save) ? { ...save, settings: undefined } : save);

/**
 * 创建同步层。
 * @param {object} options
 * @param {Storage} options.storage 本机存储（浏览器里传 localStorage）
 * @param {string} [options.server] 同步服务地址，和网页同源时留空
 * @param {typeof fetch} [options.fetch] 测试时注入
 * @param {EventTarget|null} [options.events] 监听 online 事件的对象，浏览器里是 window
 * @param {Document|null} [options.page] 监听 visibilitychange 的对象，浏览器里是 document
 * @param {number} [options.debounceMs] 存档后多久没有新改动就推送
 * @param {number} [options.pollMs] 页面在前台时多久同步一次
 * @param {number} [options.applyCheckMs] 有待应用的进度时，多久问一次前端能不能应用
 * @param {number} [options.retryMinMs] / [options.retryMaxMs] 失败后的重试间隔范围
 */
export function createSyncController(options = {}) {
  const {
    storage,
    server = "",
    fetch,
    createClient = (code) => createHttpClient({ code, baseUrl: server, ...(fetch ? { fetch } : {}) }),
    syncOnce = defaultSyncOnce,
    now = () => Date.now(),
    events = typeof window === "undefined" ? null : window,
    page = typeof document === "undefined" ? null : document,
    debounceMs = 5000,
    pollMs = 60000,
    applyCheckMs = 2000,
    retryMinMs = 5000,
    retryMaxMs = 300000,
  } = options;
  if (!storage) throw new Error("同步层需要本机存储");
  const setT = (fn, ms) => globalThis.setTimeout(fn, ms);
  const clearT = (id) => globalThis.clearTimeout(id);

  const read = (key) => {
    try {
      return JSON.parse(storage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };

  // 同步层自己的数据，坏了就当没开启（不影响游戏存档）
  const saved = read(META_KEY) ?? {};
  const meta = {
    code: parseCode(typeof saved.code === "string" ? saved.code : ""),
    created: saved.created === true, // 云端是否已有这个同步码；没有时第一次推送用“新建”
    device: typeof saved.device === "string" && /^d-[0-9a-z]{8}$/.test(saved.device) ? saved.device : `d-${generateCode().slice(0, 8).toLowerCase()}`,
    clock: cleanClock(saved.clock),
    lastSyncAt: Number.isFinite(saved.lastSyncAt) ? saved.lastSyncAt : null,
  };
  const persist = () => write(META_KEY, meta);
  persist();

  let snapshot = null; // 最近一次存档的深拷贝，和本机存储里的一致
  let version = 0; // 每次存档内容变化加一，用来判断同步期间玩家有没有新改动
  let pushedVersion = 0; // 云端已经包含到哪个版本的本机改动
  let hooks = { apply: () => {}, canApply: () => true };
  let state = meta.code ? "idle" : "off", message = "";
  let paused = false, pendingApply = false, started = false;
  let busy = false, current = Promise.resolve(), again = false, failures = 0;
  const timers = { debounce: null, retry: null, apply: null, poll: null };
  const listeners = new Set();

  const status = () => ({
    state,
    code: meta.code ? formatCode(meta.code) : null,
    lastSyncAt: meta.lastSyncAt,
    message: message || MESSAGES[state],
    dirty: !!meta.code && version !== pushedVersion,
    pendingApply,
  });
  function setState(next, text = "") {
    state = next;
    message = text;
    const snap = status();
    for (const fn of listeners) {
      try {
        fn(snap);
      } catch {}
    }
  }
  function clear(name) {
    if (timers[name] === null) return;
    name === "poll" ? globalThis.clearInterval(timers[name]) : clearT(timers[name]);
    timers[name] = null;
  }
  function later(name, ms, fn) {
    clear(name);
    timers[name] = setT(() => {
      timers[name] = null;
      fn();
    }, ms);
  }

  // 一轮同步：把当前本机存档交给 syncOnce（拉取 → 合并 → 推送）
  async function round(create) {
    const startVersion = version;
    const result = await syncOnce(createClient(meta.code), { save: snapshot, clock: meta.clock }, { device: meta.device, create });
    return { result, startVersion };
  }

  // 把合并后的进度交给游戏
  function applyResult(local) {
    write(BACKUP_KEY, { at: now(), save: snapshot }); // 先备份，万一同步出问题还能找回
    snapshot = structuredClone(local.save);
    meta.clock = local.clock;
    write(PROGRESS_KEY, snapshot); // 先写本机存储：就算前端没立刻保存，刷新后读到的也是新进度
    pendingApply = false;
    clear("apply");
    try {
      hooks.apply(structuredClone(local.save));
    } catch {}
  }

  // 有待应用的进度时，定时问前端现在能不能应用；能了就再同步一轮（用最新的本机存档重新合并）再应用
  function watchApply() {
    later("apply", applyCheckMs, () => {
      if (!pendingApply) return;
      if (hooks.canApply()) runSync();
      else watchApply();
    });
  }

  function handle(result, startVersion) {
    if (result.status === "ok") {
      meta.created = true;
      meta.lastSyncAt = now();
      failures = 0;
      pushedVersion = startVersion; // 这一轮开始时的本机改动已经在云端了
      if (version !== startVersion) {
        again = true; // 同步期间玩家又存了档：这一轮的合并结果基于旧存档，不应用，马上再同步
      } else if (result.localChanged) {
        if (hooks.canApply()) applyResult(result.local);
        else {
          pendingApply = true;
          watchApply();
        }
      } else {
        pendingApply = false;
        meta.clock = result.local.clock;
      }
      setState("ok");
    } else if (result.status === "not-found") {
      // 云端本来有、现在没了（比如服务器数据被清空）：下一轮按新建推送，把本机进度补上去
      meta.created = false;
      again = true;
      setState("idle", "云端没有这份存档，正在重新上传");
    } else if (result.status === "newer-version" || result.status === "incompatible") {
      paused = true;
      setState("paused", result.status === "newer-version" ? MESSAGES.paused : "认不出云端存档的格式，已暂停同步");
    } else {
      // conflict：几轮都被别的设备抢先，过一会儿再试
      later("retry", retryMinMs, runSync);
      setState("idle", "云端正忙，稍后重试");
    }
  }

  function fail(error) {
    failures++;
    let delay = Math.min(retryMinMs * 2 ** (failures - 1), retryMaxMs);
    if (error instanceof SyncError) {
      if (error.kind === "rate-limited") delay = Math.max(delay, (error.retryAfter ?? 30) * 1000);
      setState(error.kind === "offline" ? "offline" : "error", error.kind === "offline" ? "" : error.message);
    } else {
      delay = retryMaxMs; // 合并自检失败之类：本机和云端都没动，隔久一点再试
      setState("error", `同步出错：${error.message}。本机进度没有受影响`);
    }
    later("retry", delay, runSync);
  }

  // 同步一轮；正在同步时只做标记，这一轮结束后再补一轮
  function runSync() {
    if (!meta.code || paused || !started) return Promise.resolve(status());
    if (busy) {
      again = true;
      return current;
    }
    busy = true;
    clear("debounce");
    clear("retry");
    setState("syncing");
    current = (async () => {
      try {
        const { result, startVersion } = await round(!meta.created);
        handle(result, startVersion);
      } catch (error) {
        fail(error);
      } finally {
        busy = false;
        persist();
        if (again) {
          again = false;
          later("debounce", debounceMs, runSync);
        }
      }
      return status();
    })();
    return current;
  }

  const isVisible = () => !page || page.visibilityState !== "hidden";
  function onVisibility() {
    // 切回页面时拉一次；切走时如果有没推送的改动，赶紧推一次
    if (isVisible() || version !== pushedVersion) runSync();
  }
  function onOnline() {
    failures = 0;
    runSync();
  }

  return {
    // 读本机存档，返回值和原来 main.mjs 里读 localStorage 的写法一样：{ data }
    load() {
      return { data: read(PROGRESS_KEY) };
    },

    /**
     * 开始工作。前端读完档、normalize 之后调用一次。
     * @param {object} hooks
     * @param {object} [hooks.progress] 前端当前用的存档（normalize 之后的）
     * @param {(progress: object) => void} [hooks.apply] 拉到新进度时调用：替换存档、保存、重画（约定第六部分第 3 处）
     * @param {() => boolean} [hooks.canApply] 现在能不能应用新进度（玩家在关卡里时返回 false）
     */
    start({ progress, apply, canApply } = {}) {
      if (started) return;
      started = true;
      snapshot = structuredClone(progress ?? normalize(read(PROGRESS_KEY)));
      hooks = { apply: apply ?? (() => {}), canApply: canApply ?? (() => true) };
      page?.addEventListener?.("visibilitychange", onVisibility);
      events?.addEventListener?.("online", onOnline);
      timers.poll = globalThis.setInterval(() => {
        if (isVisible()) runSync();
      }, pollMs);
      timers.poll?.unref?.(); // 在 Node 里（测试）不因为这个定时器而不退出；浏览器里没有 unref，跳过
      if (meta.code) runSync();
      else setState("off");
    },

    // 存档：照旧先写本机，再安排推送。写本机失败时抛错，和原来 localStorage.setItem 失败时一样
    save(progress) {
      if (!write(PROGRESS_KEY, progress)) throw new Error("本机存档写入失败");
      const changed = snapshot === null || stableJSON(syncable(progress)) !== stableJSON(syncable(snapshot));
      if (snapshot !== null) meta.clock = touch(meta.clock, snapshot, progress, now());
      snapshot = structuredClone(progress);
      if (!changed) return;
      version++;
      persist();
      if (meta.code && started && !paused) later("debounce", debounceMs, runSync);
      if (meta.code && state === "ok") setState("ok"); // 让界面显示“有未同步的改动”
    },

    // 开启云同步：本地生成新同步码（断网也能开启，联网后自动在云端新建）
    async enable() {
      if (!meta.code) {
        meta.code = generateCode();
        meta.created = false;
        paused = false;
        failures = 0;
        persist();
        setState("idle");
      }
      await runSync();
      return status();
    },

    // 输入已有的同步码：云端必须已有这个码，否则不保存（免得输错一位就建了个空码）
    async join(input) {
      const code = parseCode(input);
      if (!code) return { ok: false, reason: "invalid", message: "同步码格式不对：应为 12 位字母和数字" };
      while (busy) await current.catch(() => {});
      busy = true;
      const previous = { code: meta.code, created: meta.created };
      clear("debounce");
      clear("retry");
      meta.code = code;
      meta.created = true; // 按“已存在”同步：云端没有就返回 not-found
      paused = false;
      setState("syncing");
      try {
        const { result, startVersion } = await round(false);
        if (result.status === "not-found") {
          Object.assign(meta, previous);
          setState(meta.code ? "idle" : "off");
          return { ok: false, reason: "not-found", message: "云端没有这个同步码，请检查输入" };
        }
        failures = 0;
        handle(result, startVersion);
        return { ok: result.status === "ok", reason: result.status, message: status().message };
      } catch (error) {
        Object.assign(meta, previous);
        setState(meta.code ? "idle" : "off");
        const offline = error instanceof SyncError && error.kind === "offline";
        return { ok: false, reason: offline ? "offline" : "error", message: offline ? "连不上同步服务，请联网后再输入" : error.message };
      } finally {
        busy = false;
        persist();
        if (again) {
          again = false;
          later("debounce", debounceMs, runSync);
        }
      }
    },

    // 关闭云同步：忘掉同步码，本机进度保留；云端那份不删，以后输入同一个码还能接上
    disable() {
      meta.code = null;
      meta.created = false;
      paused = false;
      pendingApply = false;
      failures = 0;
      for (const name of ["debounce", "retry", "apply"]) clear(name);
      persist();
      setState("off");
      return status();
    },

    syncNow: () => runSync(),
    status,

    // 订阅状态变化（给设置里的同步状态显示用），返回取消订阅的函数
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // 停止所有计时器和事件监听（测试用，页面里一般用不到）
    stop() {
      for (const name of Object.keys(timers)) clear(name);
      page?.removeEventListener?.("visibilitychange", onVisibility);
      events?.removeEventListener?.("online", onOnline);
      started = false;
      return current;
    },
  };
}
