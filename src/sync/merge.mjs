// 云同步 · 合并逻辑
//
// 把本机存档和云端原始存档按关卡合并。字段规则以 docs/协作约定-存档与云同步.md 第二、四部分为准，
// 实现时补充的细节见 docs/云同步-技术方案.md 第五部分；下面注释里的“第 N 条”指那一部分的编号。
// 纯函数：不碰界面、不读写存储、不联网，所以能直接在 Node 里测试。
import { levels, levelById, legacyLevelById } from "../levels.mjs";
import { evaluate } from "../engine.mjs";
import { cleanState, normalize, recordAttempt } from "../progress.mjs";
import { cleanClock, emptyClock, statePath, timeOf } from "./clock.mjs";
import { has, isObject, stableJSON } from "./util.mjs";

export const SAVE_VERSION = 1;

// 本模块认识的顶层字段和单关字段。其余字段（以后新增的）按“以较新的一份为准”合并，不会丢（第 6 条）。
const TOP_KEYS = new Set(["version", "records", "last", "chapter", "summaries", "briefings", "settings"]);
const RECORD_KEYS = new Set(["revision", "best", "bestMetric", "legacyBest", "legacy", "passed", "perfect", "attempts", "hintUnlocked", "state"]);

// 与 normalize() 相同的尝试次数清洗口径
const count = (n) => Math.max(0, Math.min(1e5, Math.floor(Number(n) || 0)));

// 用题目验证一份方案：先按题目清洗，再判定；没通过返回 null。
// 最后存回存档的是原样的 raw，而不是清洗后的 state（第 4 条：免得删掉新版本设备在方案里加的字段）。
function judge(level, raw) {
  if (!isObject(raw)) return null;
  const state = cleanState(level, raw);
  const result = evaluate(level, state);
  return result.valid && result.pass ? { raw, state, result } : null;
}

// 挑战者是否比现有最佳更好。不另抄评优规则，直接问 recordAttempt()（约定第四部分）：
// 在一份临时存档上把现有方案设为最佳，用挑战者调用一次，看最佳方案有没有被换掉。
// 以后 @aliezXDD 改了评优规则，这里自动跟着变。
function beats(level, incumbent, challenger) {
  const record = { best: incumbent.state, bestMetric: incumbent.result.metric, passed: true, perfect: !!incumbent.result.perfect, attempts: 0, hintUnlocked: false };
  const scratch = { records: { [level.id]: record } };
  recordAttempt(scratch, level, challenger.state, challenger.result);
  return scratch.records[level.id].best !== incumbent.state;
}

// 在候选方案里选出最好的一份，都无效返回 null。
// 调用方把云端的候选排在前面：平局时保留先出现的那份，两台设备反复同步不会来回替换同分方案（第 3 条）。
export function pickBest(level, candidates) {
  let best = null;
  for (const raw of candidates) {
    const candidate = judge(level, raw);
    if (candidate && (!best || beats(level, best, candidate))) best = candidate;
  }
  return best;
}

// 合并本模块不认识的字段（第 6 条）：只有一边有就照抄；两边都有，取整份存档较新的一边。
function mergeUnknown(cloudObject, localObject, knownKeys, cloudNewer) {
  const result = {};
  // 后写入的覆盖先写入的，所以较新的一边放在后面
  for (const source of cloudNewer ? [localObject, cloudObject] : [cloudObject, localObject]) {
    for (const [key, value] of Object.entries(source)) if (!knownKeys.has(key)) result[key] = value;
  }
  return result;
}

// 取并集（第 7 条）：去重、排序，保留本机不认识的取值（例如以后新增的第 6 章）
function union(a, b) {
  const items = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].filter((x) => typeof x === "number" || typeof x === "string");
  return [...new Set(items)].sort((x, y) => (typeof x !== typeof y ? (typeof x === "number" ? -1 : 1) : x < y ? -1 : x > y ? 1 : 0));
}

// 两边都有记录、修订号都不超过本机时，合并这一关（第 2 条最后一项）
function mergeRecord(level, cloudRecord, localRecord, cloudClock, localClock, cloudNewer) {
  const id = level.id, revision = level.revision ?? 1;
  const bestCandidates = [], legacyCandidates = [], states = [];
  for (const [record, clock] of [[cloudRecord, cloudClock], [localRecord, localClock]]) {
    // 与 normalize() 读档迁移同一口径：修订号不同的记录，旧成绩作为旧版成绩候选，编辑现场作废
    const changed = (record.revision ?? 1) !== revision;
    const archived = record.legacyBest ?? (changed ? record.best : null);
    if (archived) legacyCandidates.push(archived);
    if (changed) continue;
    if (record.best) bestCandidates.push(record.best);
    if (has(record, "state")) states.push({ value: record.state, time: timeOf(clock, statePath(id)) });
  }
  const best = pickBest(level, bestCandidates);
  const legacy = pickBest(legacyLevelById[id], legacyCandidates);
  // 编辑现场取修改时间较新的；时间相同保留云端的（云端排在前面，只有严格更新才替换）
  const state = states.reduce((chosen, s) => (!chosen || s.time > chosen.time ? s : chosen), null);
  const record = mergeUnknown(cloudRecord, localRecord, RECORD_KEYS, cloudNewer);
  Object.assign(record, {
    revision,
    best: best ? best.raw : null,
    // 派生字段按 normalize() 的口径算，只为让原始存档前后一致；读档时 normalize() 还会再算一遍
    bestMetric: best ? best.result.metric : null,
    legacyBest: legacy ? legacy.raw : null,
    legacy: !!legacy && !best,
    passed: !!best || !!legacy,
    perfect: !!best?.result.perfect || !!legacy?.result.perfect,
    attempts: Math.max(count(cloudRecord.attempts), count(localRecord.attempts)),
    hintUnlocked: !!cloudRecord.hintUnlocked || !!localRecord.hintUnlocked,
  });
  if (state) record.state = state.value;
  return { record, stateTime: state?.time };
}

// 自检（第 8 条）：原来在本机或云端已通过（已完美）的关卡，合并后必须仍然通过（仍然完美）。
// merged 和 sources 里的存档都要先经过 normalize()；skip 里的关卡不拿云端的成绩来比
// （云端那份修订号比本机新，本机验证不了，本机继续用自己的记录）。
export function checkNoRegression(merged, sources, skip = new Set()) {
  for (const level of levels) {
    const after = merged.records[level.id];
    for (const [name, source] of Object.entries(sources)) {
      if (name === "cloud" && skip.has(level.id)) continue;
      const before = source.records[level.id], where = name === "cloud" ? "云端" : "本机";
      if (before?.passed && !after?.passed) throw new Error(`合并自检失败：${level.id} 在${where}已通过，合并后却未通过`);
      if (before?.perfect && !after?.perfect) throw new Error(`合并自检失败：${level.id} 在${where}已完美，合并后却不完美`);
    }
  }
}

/**
 * 合并本机和云端的存档。
 *
 * @param {{save: object, clock?: object}} local 本机：save 是本机正在用的存档（normalize() 之后的），clock 是同步层记的修改时间
 * @param {{save: object, clock?: object} | null} cloud 云端信封里的 save 和 clock；云端还没有存档时传 null
 * @returns 下面三种之一：
 *   { status: "ok", cloud: {save, clock}, local: {save, clock}, cloudChanged, localChanged }
 *     cloud.save：推回云端的原始存档（不经过 normalize，保留本机不认识的内容）
 *     local.save：本机要用的存档（已经过 normalize）
 *     cloudChanged / localChanged：云端是否需要推送；本机进度是否有变化
 *   { status: "newer-version", version }：云端存档格式比本机新，暂停同步，不要推送（第 1 条）
 *   { status: "incompatible" }：认不出云端存档的格式，暂停同步，不要推送
 * 本机存档格式不对，或合并结果自检不通过时抛错；调用方应保留本机存档，不推送。
 * 不修改传入的对象。
 */
export function merge(local, cloud) {
  if (!isObject(local?.save) || local.save.version !== SAVE_VERSION || !isObject(local.save.records)) throw new Error("本机存档格式不兼容");
  // 先深拷贝两边，输出只引用拷贝，调用方之后再改原存档也不会影响合并结果
  const L = structuredClone(local.save), localClock = cleanClock(local.clock);
  const cloudMissing = cloud == null || cloud.save == null;
  const C = cloudMissing ? { version: SAVE_VERSION, records: {} } : structuredClone(cloud.save);
  const cloudClock = cloudMissing ? emptyClock() : cleanClock(cloud.clock);
  if (!isObject(C)) return { status: "incompatible" };
  if (Number.isInteger(C.version) && C.version > SAVE_VERSION) return { status: "newer-version", version: C.version };
  if (C.version !== SAVE_VERSION || !isObject(C.records)) return { status: "incompatible" };

  const cloudNewer = cloudClock.savedAt >= localClock.savedAt;
  const fields = { ...cloudClock.fields }; // 先沿用云端记的时间，下面逐项改成选中那份的时间
  const records = {};
  const keepLocal = new Map(); // 本机验证不了云端记录、继续用自己记录的关卡 → 本机记录（可能没有）

  // 整份照抄某一边的记录时，把那一边的编辑现场时间也带上，下次合并还能按真实时间比较
  const copy = (id, record, clock) => {
    records[id] = record;
    if (record && has(record, "state")) fields[statePath(id)] = timeOf(clock, statePath(id));
  };

  const ids = [...new Set([...Object.keys(C.records), ...Object.keys(L.records)])].sort();
  for (const id of ids) {
    const c = isObject(C.records[id]) ? C.records[id] : null;
    const l = isObject(L.records[id]) ? L.records[id] : null;
    const level = levelById[id];
    // 本机不认识的关卡：原样保留，两边都有时取云端的
    if (!level) {
      c ? copy(id, c, cloudClock) : copy(id, l, localClock);
      continue;
    }
    // 修订号比本机新（来自更新版本的设备）：本机验证不了，不做判断。
    // 推回云端的留修订号高的那份；本机继续用自己的记录，不会被看不懂的新题记录覆盖掉自己的成绩
    const revision = level.revision ?? 1;
    const tooNew = (r) => !!r && Number.isInteger(r.revision) && r.revision > revision;
    if (tooNew(c) || tooNew(l)) {
      tooNew(c) && (!tooNew(l) || c.revision >= l.revision) ? copy(id, c, cloudClock) : copy(id, l, localClock);
      keepLocal.set(id, l);
      continue;
    }
    // 只有一边有记录：照抄，读档时 normalize() 会清洗
    if (!c || !l) {
      c ? copy(id, c, cloudClock) : copy(id, l, localClock);
      continue;
    }
    const { record, stateTime } = mergeRecord(level, c, l, cloudClock, localClock, cloudNewer);
    records[id] = record;
    if (stateTime !== undefined) fields[statePath(id)] = stateTime;
  }

  const merged = mergeUnknown(C, L, TOP_KEYS, cloudNewer);
  merged.version = SAVE_VERSION;
  merged.records = records;
  // 上次所在关、上次查看的章节：取修改时间较新的，时间相同取云端的（第 5 条）
  for (const key of ["last", "chapter"]) {
    const inCloud = has(C, key), inLocal = has(L, key);
    if (!inCloud && !inLocal) continue;
    const cloudTime = timeOf(cloudClock, key), localTime = timeOf(localClock, key);
    const useLocal = inLocal && (!inCloud || localTime > cloudTime);
    merged[key] = useLocal ? L[key] : C[key];
    fields[key] = useLocal ? localTime : cloudTime;
  }
  merged.summaries = union(C.summaries, L.summaries);
  merged.briefings = union(C.briefings, L.briefings);
  // 设置不同步：推回云端的沿用云端原有的（云端还没有时用本机的），本机用自己的（第 7 条）
  merged.settings = has(C, "settings") ? C.settings : L.settings;
  const clock = { fields, savedAt: Math.max(cloudClock.savedAt, localClock.savedAt) };

  // 本机要用的版本：和推回云端的基本一样，只是设置用本机的，验证不了的关卡用本机自己的记录
  const localSave = { ...merged, settings: L.settings, records: { ...records } };
  const localFields = { ...fields };
  for (const [id, record] of keepLocal) {
    if (record) localSave.records[id] = record;
    else delete localSave.records[id];
    if (has(localClock.fields, statePath(id))) localFields[statePath(id)] = localClock.fields[statePath(id)];
    else delete localFields[statePath(id)];
  }
  const applied = normalize(localSave);
  const localBefore = normalize(L);
  checkNoRegression(applied, { local: localBefore, cloud: normalize(C) }, new Set(keepLocal.keys()));

  return {
    status: "ok",
    cloud: { save: merged, clock },
    local: { save: applied, clock: { fields: localFields, savedAt: clock.savedAt } },
    cloudChanged: cloudMissing || stableJSON(merged) !== stableJSON(C) || stableJSON(clock) !== stableJSON(cloudClock),
    localChanged: stableJSON(applied) !== stableJSON(localBefore),
  };
}
