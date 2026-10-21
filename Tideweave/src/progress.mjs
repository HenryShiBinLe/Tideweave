import { levels, levelById, legacyLevelById } from "./levels.mjs";
import { initialState, evaluate } from "./engine.mjs";
import { walkEdges } from "./algorithms.mjs";
const fresh = () => ({ version: 1, records: {}, last: levels[0].id, chapter: 1, summaries: [], briefings: [], settings: { sound: true, volume: .8, effectsVolume: .5, music: true, musicVolume: .5, motion: true, speed: 1 } });
function cleanState(l, value) {
  const s = initialState(l);
  if (!value || typeof value !== "object") return s;
  const ints = (a, max, len = null) => Array.isArray(a) && a.length <= 2e3 && (len === null || a.length === len) && a.every((n) => Number.isInteger(n) && n >= 0 && n < max);
  const maxSelect = ["reach", "isolation"].includes(l.type) || l.type === "fault" && l.faultKind === "node" ? l.nodes.length : l.edges.length;
  if (ints(value.selected, maxSelect)) s.selected = [...new Set(value.selected)];
  for (const key of ["labels", "colors"]) if (Array.isArray(value[key]) && value[key].length === l.nodes.length && value[key].every((x) => Number.isInteger(x) && x >= -1 && x < 6)) s[key] = [...value[key]];
  const validPath = (p) => ints(p, l.nodes.length) && p.length && p[0] === (l.source ?? 0) && walkEdges(l, p).every((i) => i >= 0);
  if (validPath(value.path)) s.path = [...value.path];
  if (Array.isArray(value.routes) && value.routes.length === s.routes.length && value.routes.every(validPath)) s.routes = structuredClone(value.routes);
  if (ints(value.order, l.nodes.length) && (l.type === "topo" ? new Set(value.order).size === value.order.length : walkEdges(l, value.order).every((i) => i >= 0))) s.order = [...value.order];
  if (Number.isInteger(value.source) && value.source >= 0 && value.source < l.nodes.length && !l.fixedSource) s.source = value.source;
  if (Number.isInteger(value.prediction) && value.prediction >= 0 && value.prediction <= 20) s.prediction = value.prediction;
  if (Array.isArray(value.boosts) && value.boosts.length === l.nodes.length && value.boosts.every((b, i) => Number.isInteger(b) && b >= 0 && b < (l.nodes[i].duration ?? 1))) s.boosts = [...value.boosts];
  if (Array.isArray(value.pairs) && value.pairs.every((p) => /^\d-\d$/.test(p) && p.split("-").every((n) => Number(n) < l.nodes.length))) s.pairs = [...new Set(value.pairs)];
  s.netVisited = value.netVisited === true;
  return s;
}
function normalize(value) {
  const p = fresh();
  if (!value || value.version !== 1 || !value.records || typeof value.records !== "object") return p;
  for (const l of levels) {
    const r = value.records[l.id];
    if (!r || typeof r !== "object") continue;
    const revision=l.revision??1,changed=(r.revision??1)!==revision;
    const archived=r.legacyBest??(changed?r.best:null);
    const legacyBest=archived?cleanState(legacyLevelById[l.id],archived):null;
    const legacyResult=legacyBest?evaluate(legacyLevelById[l.id],legacyBest):null;
    const best = !changed && r.best ? cleanState(l, r.best) : null;
    const result = best ? evaluate(l, best) : null;
    p.records[l.id] = { revision, legacyBest:legacyResult?.pass?legacyBest:null, legacy:!!legacyResult?.pass&&!result?.pass, passed: !!result?.pass||!!legacyResult?.pass, perfect: !!result?.perfect||!!legacyResult?.perfect, attempts: Math.max(0, Math.min(1e5, Math.floor(Number(r.attempts) || 0))), hintUnlocked: !!r.hintUnlocked, state: changed?initialState(l):cleanState(l, r.state), best: result?.pass ? best : null, bestMetric: result?.pass ? result.metric : null };
  }
  if (levelById[value.last]) p.last = value.last;
  if (Number.isInteger(value.chapter) && value.chapter >= 1 && value.chapter <= 5) p.chapter = value.chapter;
  p.summaries = Array.isArray(value.summaries) ? value.summaries.filter((x) => Number.isInteger(x) && x >= 1 && x <= 5) : [];
  p.briefings = Array.isArray(value.briefings) ? [...new Set(value.briefings.filter(x=>Number.isInteger(x)&&x>=1&&x<=5))] : [];
  if (value.settings) {
    for (const k of ["sound", "music", "motion"]) if (typeof value.settings[k] === "boolean") p.settings[k] = value.settings[k];
    for (const k of ["volume", "effectsVolume", "musicVolume", "speed"]) if (Number.isFinite(value.settings[k])) p.settings[k] = Math.max(k === "speed" ? 0.5 : 0, Math.min(k === "speed" ? 3 : 1, value.settings[k]));
  }
  return p;
}
const unlocked = (p, l) => l.requires.every((id) => p.records[id]?.passed);
function recordAttempt(p, l, state, result) {
  const r = p.records[l.id] ??= { passed: false, perfect: false, attempts: 0, hintUnlocked: false };
  r.state = structuredClone(state);
  if (!result.valid) return r;
  if (!l.tutorial) {
    r.attempts++;
    if (r.attempts >= 3 && !result.perfect && !(r.best&&evaluate(l,r.best).perfect)) r.hintUnlocked = true;
  }
  if (result.pass) {
    const improve = !r.best || result.perfect && !evaluate(l,r.best).perfect || (l.type === "matching" ? result.metric > r.bestMetric : result.metric < r.bestMetric);
    if (improve) {
      r.best = structuredClone(state);
      r.bestMetric = result.metric;
    }
    r.passed = true;
    r.perfect ||= result.perfect;
    r.legacy=false;
  }
  r.revision=l.revision??1;
  return r;
}
export {
  cleanState,
  fresh,
  normalize,
  recordAttempt,
  unlocked
};
