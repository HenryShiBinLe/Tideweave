// 云同步服务端 · 存储
//
// 目录结构：<数据目录>/saves/<哈希前两位>/<哈希>/v/<12 位版本号>.json
// - 哈希是同步码的 SHA-256：磁盘上不出现同步码本身，数据目录泄露也拿不到同步码；
// - 每个版本一个文件，内容是客户端推送的信封（服务端不解析里面的进度）；文件的修改时间就是保存时间；
// - 版本号从 1 开始单调递增，最新版本就是编号最大的文件。没有单独的“当前版本”指针，
//   所以不会出现指针和文件对不上的情况，写到一半断电也只会留下没生效的临时文件。
//
// 并发：同一进程内，同一个同步码的写入排队进行；不同进程（比如服务和运维脚本同时写）靠 link()
// 不覆盖已有文件的特性保证同一个版本号只会写成功一次，失败的一方按冲突处理。
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DAY = 24 * 3600 * 1000;
const pad = (rev) => String(rev).padStart(12, "0");
const versionFile = (dir, rev) => path.join(dir, `${pad(rev)}.json`);

export const hashCode = (code) => crypto.createHash("sha256").update(code).digest("hex");

// 按北京时间算“哪一天”，用于每天保留一个历史版本
const dayOf = (ms) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * @param {object} options
 * @param {string} options.dir 数据目录
 * @param {number} [options.keepRecent=20] 每个同步码保留最近几个版本
 * @param {number} [options.keepDays=7] 另外在最近几天里，每天保留最后一个版本
 */
export function createStore({ dir, keepRecent = 20, keepDays = 7 }) {
  const locks = new Map();

  const versionsDir = (code) => {
    const hash = hashCode(code);
    return path.join(dir, "saves", hash.slice(0, 2), hash, "v");
  };

  // 同一个同步码的操作排队执行：前一个结束（无论成败）再开始下一个
  function withLock(code, task) {
    const key = hashCode(code);
    const previous = locks.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    const tail = current.catch(() => {});
    locks.set(key, tail);
    tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return current;
  }

  // 列出已有的版本号（升序）；目录不存在说明这个同步码还没有存档
  async function listRevs(vdir) {
    let names;
    try {
      names = await fs.readdir(vdir);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    return names
      .map((name) => /^(\d{12})\.json$/.exec(name))
      .filter(Boolean)
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);
  }

  // 尽力把目录项落盘（新文件的“存在”本身也要写进磁盘）；有的平台不支持对目录 fsync，失败就算了
  async function syncDir(vdir) {
    try {
      const handle = await fs.open(vdir, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {}
  }

  // 保留最近 keepRecent 个版本，外加最近 keepDays 天里每天的最后一个版本，其余删除
  async function prune(vdir, now) {
    const revs = await listRevs(vdir);
    if (revs.length <= keepRecent) return;
    const keep = new Set(revs.slice(-keepRecent));
    const lastOfDay = new Map();
    for (const rev of revs) {
      let mtimeMs;
      try {
        ({ mtimeMs } = await fs.stat(versionFile(vdir, rev)));
      } catch {
        continue; // 已被别处删掉的版本
      }
      if (now - mtimeMs > keepDays * DAY) continue;
      const day = dayOf(mtimeMs);
      lastOfDay.set(day, Math.max(lastOfDay.get(day) ?? 0, rev));
    }
    for (const rev of lastOfDay.values()) keep.add(rev);
    await Promise.all(revs.filter((rev) => !keep.has(rev)).map((rev) => fs.rm(versionFile(vdir, rev), { force: true })));
  }

  // 读最新版本：{ rev, text, savedAt } 或 null
  async function get(code) {
    const vdir = versionsDir(code);
    const revs = await listRevs(vdir);
    if (!revs.length) return null;
    const rev = revs.at(-1);
    const file = versionFile(vdir, rev);
    const [text, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    return { rev, text, savedAt: stat.mtimeMs };
  }

  /**
   * 写入新版本。
   * @param {string} code 同步码
   * @param {string} text 信封的 JSON 文本
   * @param {object} options
   * @param {number|null} options.expect null：只在还没有存档时创建（If-None-Match: *）；数字：当前版本号必须等于它（If-Match）
   * @param {number} [options.version] 信封里的存档版本；云端已存的存档版本更高时拒绝，防止旧版本设备覆盖新格式
   * @returns {{ok: true, rev} | {ok: false, reason: "conflict", rev} | {ok: false, reason: "newer-version", version}}
   */
  function put(code, text, { expect, version, now = Date.now() }) {
    return withLock(code, async () => {
      const vdir = versionsDir(code);
      const revs = await listRevs(vdir);
      const current = revs.at(-1) ?? null;
      if (expect === null ? current !== null : current !== expect) return { ok: false, reason: "conflict", rev: current };
      if (current !== null && version !== undefined) {
        let stored = null;
        try {
          stored = JSON.parse(await fs.readFile(versionFile(vdir, current), "utf8"));
        } catch {}
        const storedVersion = stored?.save?.version;
        if (Number.isInteger(storedVersion) && storedVersion > version) return { ok: false, reason: "newer-version", version: storedVersion };
      }
      await fs.mkdir(vdir, { recursive: true });
      const rev = (current ?? 0) + 1;
      const temporary = path.join(vdir, `.tmp-${process.pid}-${crypto.randomUUID()}`);
      const handle = await fs.open(temporary, "w");
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        // link() 遇到已存在的文件会失败而不是覆盖：别的进程抢先写了同一个版本号时，这里按冲突处理
        await fs.link(temporary, versionFile(vdir, rev));
      } catch (error) {
        if (error.code === "EEXIST") return { ok: false, reason: "conflict", rev };
        throw error;
      } finally {
        await fs.rm(temporary, { force: true });
      }
      await syncDir(vdir);
      // 新版本已经写成功；清理旧版本失败不影响这次写入，下次写入时会再清理
      await prune(vdir, now).catch(() => {});
      return { ok: true, rev };
    });
  }

  // 历史版本列表（新的在前）：版本号、保存时间、大小、写入设备
  async function versions(code) {
    const vdir = versionsDir(code);
    const revs = await listRevs(vdir);
    const list = [];
    for (const rev of revs.reverse()) {
      try {
        const file = versionFile(vdir, rev);
        const [stat, text] = await Promise.all([fs.stat(file), fs.readFile(file, "utf8")]);
        let device = null;
        try {
          device = JSON.parse(text).device ?? null;
        } catch {}
        list.push({ rev, savedAt: new Date(stat.mtimeMs).toISOString(), size: stat.size, device });
      } catch (error) {
        if (error.code !== "ENOENT") throw error; // 刚好被清理掉的旧版本，跳过
      }
    }
    return list;
  }

  // 读某个历史版本的信封文本；不存在返回 null
  async function version(code, rev) {
    try {
      return await fs.readFile(versionFile(versionsDir(code), rev), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  // 回滚：把旧版本的内容作为一个新版本写回（不删除任何版本，回滚本身也能再回滚）
  async function restore(code, rev) {
    const text = await version(code, rev);
    if (text === null) throw new Error(`版本 ${rev} 不存在`);
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await get(code);
      const result = await put(code, text, { expect: latest?.rev ?? null });
      if (result.ok) return result.rev;
    }
    throw new Error("回滚时一直和其他写入冲突，请稍后重试");
  }

  // 统计：同步码数量和占用空间（运维用）
  async function stats() {
    let codes = 0, bytes = 0, files = 0;
    const root = path.join(dir, "saves");
    for (const shard of await fs.readdir(root).catch(() => [])) {
      for (const hash of await fs.readdir(path.join(root, shard)).catch(() => [])) {
        const vdir = path.join(root, shard, hash, "v");
        const revs = await listRevs(vdir);
        if (!revs.length) continue;
        codes++;
        for (const rev of revs) {
          bytes += (await fs.stat(versionFile(vdir, rev))).size;
          files++;
        }
      }
    }
    return { codes, files, bytes };
  }

  return { get, put, versions, version, restore, stats };
}
