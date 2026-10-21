// 云同步 · 修改时间
//
// 存档里没有时间字段（约定：时间不进存档），"哪份更新"由同步层自己记：
// 每次本机存档时和上一次比较，变了的现场型字段记下当前时间。现场型字段指
// 每关的编辑现场 records[ID].state、上次所在关 last、上次查看的章节 chapter。
// 时间只用来决定现场型字段取哪一份，不影响成绩；设备之间的时钟偏差因此只会影响"继续游戏"的位置。
//
// 数据形状：{ fields: { "records/<关卡 ID>/state": 毫秒, last: 毫秒, chapter: 毫秒 }, savedAt: 毫秒 }
// savedAt 是整份存档最近一次变化的时间，某字段没有单独记录时用它兜底。
import { isObject, stableJSON } from "./util.mjs";

export const statePath = (id) => `records/${id}/state`;
const TIMED_TOP_KEYS = ["last", "chapter"];

export const emptyClock = () => ({ fields: {}, savedAt: 0 });

// 清洗外来的时间数据（云端、本机存储都可能是坏的），只保留有限数字
export function cleanClock(clock) {
  const result = emptyClock();
  if (!isObject(clock)) return result;
  if (isObject(clock.fields)) {
    for (const [path, time] of Object.entries(clock.fields)) if (Number.isFinite(time)) result.fields[path] = time;
  }
  if (Number.isFinite(clock.savedAt)) result.savedAt = clock.savedAt;
  return result;
}

// 某字段的修改时间：没有单独记录就用整份存档的时间，都没有按最旧（0）处理。
// 例如设备第一次同步时本地已有的进度，没有逐关时间，就按整份存档的时间判断（约定第一部分）。
export function timeOf(clock, path) {
  const time = clock?.fields?.[path] ?? clock?.savedAt;
  return Number.isFinite(time) ? time : 0;
}

// 本机每次存档后调用：比较存档前后两份，给变化了的现场型字段记上 now，返回新的时间数据（不修改传入的对象）。
// before 必须是上一次存档的深拷贝；存档对象会被游戏原地修改，直接拿引用比较永远相同。
export function touch(clock, before, after, now = Date.now()) {
  const next = cleanClock(clock);
  const oldRecords = isObject(before?.records) ? before.records : {};
  const newRecords = isObject(after?.records) ? after.records : {};
  for (const id of new Set([...Object.keys(oldRecords), ...Object.keys(newRecords)])) {
    if (stableJSON(newRecords[id]?.state) !== stableJSON(oldRecords[id]?.state)) next.fields[statePath(id)] = now;
  }
  for (const key of TIMED_TOP_KEYS) {
    if (stableJSON(after?.[key]) !== stableJSON(before?.[key])) next.fields[key] = now;
  }
  // 设置不同步，只改了设置不算存档变化，免得为此推送一次内容相同的存档
  const syncable = (save) => (isObject(save) ? { ...save, settings: undefined } : save);
  if (stableJSON(syncable(after)) !== stableJSON(syncable(before))) next.savedAt = now;
  return next;
}
