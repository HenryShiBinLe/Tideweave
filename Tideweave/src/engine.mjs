import { groups, strongGroups, distances, shortest, edgeBetween, walkEdges, pathCost, sum, sameSet, mst, chromatic, maximumMatching, criticalSchedule, optimalBoost, faults, floydStages, postman, eulerWalk, cycle, subsets } from "./algorithms.mjs";
import { treeReplay, componentReplay, matchingReplay } from './replays.mjs';
function initialState(l) {
  return { selected: [], labels: l.nodes.map(() => -1), colors: l.nodes.map(() => -1), path: [l.source ?? 0], routes: (l.targets ?? []).map(() => [l.source ?? 0]), source: l.source ?? 0, prediction: 0, boosts: l.nodes.map(() => 0), pairs: [], netVisited: false, order: [], probe: null };
}
const toggle = (a, x) => a.includes(x) ? a.filter((v) => v !== x) : [...a, x];
function act(l, old, kind, id, option = 0) {
  const s = structuredClone(old);
  if (kind === "predict") {
    s.prediction = Math.max(0, Math.min(20, id));
    return s;
  }
  if (kind === "net") {
    s.netVisited = true;
    return s;
  }
  if (kind === "pair") {
    s.pairs = toggle(s.pairs, id);
    return s;
  }
  if (kind === "probe") {
    s.probe = id;
    return s;
  }
  if (kind === "edge") {
    if (!l.edges[id]) throw new Error("请选择现有线路。");
    if (["forest", "mst", "matching", "cut"].includes(l.type) || l.type === "fault" && l.faultKind === "edge" || l.type === "reinforce" && l.edges[id].candidate) s.selected = toggle(s.selected, id);
    return s;
  }
  if (!l.nodes[id]) throw new Error("请选择现有设施。");
  switch (l.type) {
    case "reach":
    case "isolation":
      if (l.type === "isolation" && (id === l.source || id === l.target)) throw new Error("源点与核心不能隔离。");
      s.selected = toggle(s.selected, id);
      break;
    case "groups":
    case "scc":
      s.labels[id] = s.labels[id] === option ? -1 : option;
      break;
    case "color":
    case "solid":
      s.colors[id] = option;
      break;
    case "fault":
      if (l.faultKind === "node") s.selected = toggle(s.selected, id);
      break;
    case "broadcast":
      if (!l.fixedSource) s.source = id;
      break;
    case "schedule":
      s.boosts[id] = (s.boosts[id] + 1) % l.nodes[id].duration;
      break;
    case "topo":
      s.order = s.order.includes(id) ? s.order.slice(0, s.order.indexOf(id)) : [...s.order, id];
      break;
    case "cycle":
      if (!s.order.length) s.order = [id];
      else if (edgeBetween(l, s.order.at(-1), id) !== -1) s.order.push(id);
      else throw new Error("这两个工序之间没有对应方向的依赖。");
      break;
    case "dfs":
    case "euler":
    case "postman":
    case "shortest":
    case "routes": {
      const path = l.type === "routes" ? s.routes[option] : s.path;
      if (edgeBetween(l, path.at(-1), id) === -1) throw new Error("请选择与当前位置直接相连的设施。");
      path.push(id);
      break;
    }
  }
  return s;
}
function faultProbe(l, id) {
  const removed = l.faultKind === "node" ? [id] : [];
  const indices = l.faultKind === "edge" ? l.edges.map((_, i) => i).filter((i) => i !== id) : null;
  return { groups: groups(l, indices, removed), removed };
}
function partitionValid(labels, expected) {
  return expected.every((g) => g.every((n) => labels[n] === labels[g[0]])) && new Set(expected.map((g) => labels[g[0]])).size === expected.length;
}
function broadcastFrames(l, source, removed = []) {
  const unweighted = { ...l, edges: l.edges.map((e) => ({ ...e, w: 1 })) };
  const d = distances(unweighted, source, null, removed), finite = d.filter(Number.isFinite);
  const frames = [];
  for (let i = 0; i <= Math.max(0, ...finite); i++) frames.push({ nodes: d.map((v, j) => v <= i ? j : -1).filter((j) => j >= 0), active: d.map((v, j) => v === i ? j : -1).filter((j) => j >= 0), edges: [], caption: `第 ${i} 轮 · ${d.filter((v) => v <= i).length} 处收到信号` });
  return { d, frames };
}
function routeFrames(l, path) {
  return path.map((n, i) => ({ path: path.slice(0, i + 1), nodes: [...new Set(path.slice(0, i + 1))], active: [n], edges: walkEdges(l, path.slice(0, i + 1)), caption: `${l.nodes[n].label} · 累计 ${pathCost(l, path.slice(0, i + 1))}` }));
}
const edgeCost = (l, ids) => sum(ids.map((i) => l.edges[i].w ?? 1));
function reinforcementValid(l, chosen) {
  const indices = l.edges.map((e, i) => !e.candidate || chosen.includes(i) ? i : -1).filter((i) => i >= 0);
  if (groups(l, indices).length !== 1) return false;
  if (l.faultKind === "edge") return indices.every((i) => groups(l, indices.filter((j) => i !== j)).length === 1);
  return l.nodes.every((_, i) => groups(l, indices, [i]).length <= 1);
}
function isolationResult(l, chosen) {
  const { d, frames } = broadcastFrames(l, l.source, chosen);
  return { safe: !Number.isFinite(d[l.target]), infected: d.filter(Number.isFinite).length, frames, d };
}
function optimization(l) {
  switch (l.type) {
    case "mst":
      return mst(l).cost;
    case "color":
    case "solid":
      return chromatic(l).count;
    case "shortest":
      return pathCost(l, shortest(l, l.source, l.target));
    case "routes":
      return sum(l.targets.map((t) => pathCost(l, shortest(l, l.source, t))));
    case "schedule":
      return optimalBoost(l)?.cost ?? Infinity;
    case "matching":
      return maximumMatching(l).length;
    case "broadcast":
      return l.fixedSource ? distances(l, l.source)[l.target] : Math.min(...l.nodes.map((_, i) => Math.max(...distances(l, i))));
    case "postman":
      return postman(l).total;
    case "forest":
      return l.nodes.length - groups(l).length;
    case "isolation":
      return Math.min(...subsets(l.nodes.map((_, i) => i).filter((i) => i !== l.source && i !== l.target), l.budget).map((s) => {
        const r = isolationResult(l, s);
        return r.safe ? r.infected : Infinity;
      }));
    case "cut":
      return Math.min(...subsets(l.edges.map((_, i) => i)).filter((s) => {
        const keep = l.edges.map((_, i) => i).filter((i) => !s.includes(i));
        return !Number.isFinite(distances(l, l.source, keep)[l.target]);
      }).map((s) => s.length));
    case "reinforce":
      return Math.min(...subsets(l.edges.map((e, i) => e.candidate ? i : -1).filter((i) => i >= 0)).filter((s) => reinforcementValid(l, s)).map((s) => edgeCost(l, s)));
    default:
      return 0;
  }
}
function evaluate(l, s) {
  const r = { valid: true, pass: false, perfect: false, metric: 0, unit: "", message: "", nodes: [], edges: [], frames: [], insight: l.insight };
  const incomplete = (message) => ({ ...r, valid: false, message });
  switch (l.type) {
    case "reach": {
      if (!s.selected.length) return incomplete("先标出至少一处设施。");
      const { d, frames } = broadcastFrames(l, l.source), expected = d.map((v, i) => Number.isFinite(v) ? i : -1).filter((i) => i >= 0);
      r.pass = sameSet(s.selected, expected);
      r.nodes = l.nodes.map((_, i) => s.selected.includes(i) !== expected.includes(i) ? i : -1).filter((i) => i >= 0);
      r.frames = frames;
      r.metric = expected.length;
      r.unit = "处可达";
      r.message = r.pass ? "所有相通的设施都已确认。" : `有 ${r.nodes.length} 处标记与实际传播不符。`;
      break;
    }
    case "groups":
    case "scc": {
      if (s.labels.includes(-1)) return incomplete("还有设施尚未分组。");
      const expected = l.type === "scc" ? strongGroups(l) : groups(l);
      r.pass = partitionValid(s.labels, expected);
      r.metric = expected.length;
      r.unit = "片网络";
      r.message = r.pass ? "分组完成，边界已确认。" : l.type === "scc" ? "有组内不能往返，或有互达区域被拆开。" : "同组应互相可达，不同组应彼此失联。";
      r.frames = expected.map((ns, i) => ({ nodes: ns, active: ns, edges: [], caption: `${l.type === "scc" ? "互达区" : "连通区"} ${i + 1} · ${ns.length} 处设施` }));
      break;
    }
    case "dfs": {
      if (s.path.length < 2) return incomplete("先规划一段巡检路线。");
      if(s.path[0]!==l.source||walkEdges(l,s.path).some(i=>i<0))return incomplete('巡检必须从起点沿现有线路行进。');
      const required=l.requiredNodes??groups(l).find(g=>g.includes(l.source));
      const seen = /* @__PURE__ */ new Set([s.path[0]]), stack = [s.path[0]];
      let legal = true;
      for (const n of s.path.slice(1)) {
        const here = stack.at(-1);
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        } else if (l.strict) {
          const unvisited = l.edges.some((e) => e.a === here && !seen.has(e.b) || e.b === here && !seen.has(e.a));
          if (unvisited || stack.at(-2) !== n) {
            legal = false;
            break;
          }
          stack.pop();
        } else stack.push(n);
      }
      r.pass = required.every(i=>seen.has(i)) && legal;
      r.metric = new Set(s.path).size;
      r.unit = "处巡检";
      r.frames = routeFrames(l, s.path);
      r.message = r.pass ? "巡检完成，所有设施已探明。" : !legal ? "这次回溯时仍有未探索支路，或未沿探索来路返回。" : `还有 ${required.filter(i=>!seen.has(i)).length} 处设施未巡检。`;
      break;
    }
    case "euler":
    case "postman":
    case "shortest":
    case "routes": {
      const paths = l.type === "routes" ? s.routes : [s.path];
      if (paths.some((p) => p.length < 2)) return incomplete("先为每份任务规划一段路线。");
      if (paths.some((p) => p[0] !== l.source || walkEdges(l, p).some((i) => i < 0))) return incomplete("路线必须从起点沿现有连接连续行进。");
      r.metric = sum(paths.map((p) => pathCost(l, p)));
      r.unit = l.type === "postman" ? "里程" : "用时";
      r.frames = paths.flatMap((p, i) => routeFrames(l, p).map((f) => ({ ...f, caption: (paths.length > 1 ? `运单 ${i + 1} · ` : "") + f.caption })));
      if (l.type === "euler" || l.type === "postman") {
        const es = walkEdges(l, s.path), covered = new Set(es);
        r.pass = covered.size === l.edges.length && (l.type === "euler" ? es.length === covered.size : s.path.at(-1) === l.source);
        r.message = r.pass ? "全部线路已完成巡运。" : covered.size < l.edges.length ? `还有 ${l.edges.length - covered.size} 条线路未巡运。` : l.type === "euler" ? "这次路线重复经过了街道。" : "所有线路已巡过，还需要返回巡运站。";
        if (l.type === "euler") {
          r.unit = "条线路";
          r.metric = es.length;
        }
      } else {
        const targets = l.type === "routes" ? l.targets : [l.target];
        const arrived = paths.every((p, i) => p.at(-1) === targets[i]);
        r.pass = arrived && r.metric <= l.budget;
        r.message = !arrived ? "还有运单尚未到达目的站。" : r.pass ? "物资已按时送达。" : `已送达，但总用时超出 ${r.metric - l.budget}。`;
      }
      break;
    }
    case "broadcast": {
      const { d, frames } = broadcastFrames(l, s.source);
      r.frames = frames;
      r.metric = l.fixedSource ? d[l.target] : Math.max(...d);
      r.unit = "轮";
      r.pass = s.prediction === r.metric && (l.fixedSource || r.metric <= l.limit);
      r.message = s.prediction !== r.metric ? `实际需要 ${r.metric} 轮，与预测 ${s.prediction} 轮不同。` : r.pass ? "信号按预测抵达。" : "预测准确，但超过公开轮次限制。";
      break;
    }
    case "forest":
    case "mst": {
      if (!s.selected.length) return incomplete("先选择要保留或建设的线路。");
      const count = groups(l, s.selected).length, base = groups(l).length;
      r.metric = l.type === "mst" ? edgeCost(l, s.selected) : s.selected.length;
      r.unit = l.type === "mst" ? "造价" : "条线路";
      r.pass = count === base && (l.type !== "mst" || r.metric <= l.budget);
      r.message = count !== base ? `还剩 ${count} 片网络，目标为 ${base} 片。` : !r.pass ? `连接完整，但造价超出 ${r.metric - l.budget}。` : "设施全部接通。";
      r.frames = s.selected.map((_, i) => ({ nodes: [...new Set(s.selected.slice(0, i + 1).flatMap((j) => [l.edges[j].a, l.edges[j].b]))], active: [], edges: s.selected.slice(0, i + 1), caption: `${i + 1} 条线路 · ${groups(l, s.selected.slice(0, i + 1)).length} 片网络` }));
      break;
    }
    case "topo": {
      if (s.order.length !== l.nodes.length||new Set(s.order).size!==l.nodes.length) return incomplete("先将全部工序各安排一次。");
      r.edges = l.edges.map((e, i) => s.order.indexOf(e.a) > s.order.indexOf(e.b) ? i : -1).filter((i) => i >= 0);
      r.pass = r.edges.length === 0;
      r.metric = s.order.length;
      r.unit = "项工序";
      r.message = r.pass ? "前置全部满足，工程可以开工。" : `有 ${r.edges.length} 项依赖顺序不满足。`;
      r.frames = s.order.map((n, i) => ({ nodes: s.order.slice(0, i + 1), active: [n], edges: [], caption: `第 ${i + 1} 项 · ${l.nodes[n].label}` }));
      break;
    }
    case "cycle": {
      if (s.order.length < 2) return incomplete("先沿箭头选择依赖链。");
      r.pass = s.order.length >= 3 && s.order[0] === s.order.at(-1) && new Set(s.order.slice(0, -1)).size === s.order.length - 1 && walkEdges(l, s.order).every((i) => i >= 0);
      r.frames = routeFrames(l, s.order);
      r.metric = s.order.length - 1;
      r.unit = "段依赖";
      r.message = r.pass ? "这些任务确实在互相等待。" : "需要沿箭头走回起点，中间的任务不能重复。";
      break;
    }
    case "schedule": {
      const plan = criticalSchedule(l, s.boosts);
      r.metric = sum(s.boosts);
      r.unit = "份加速";
      r.pass = plan.total <= l.deadline && r.metric <= l.budget;
      r.message = r.pass ? `工程将在第 ${plan.total} 天完成。` : `工期 ${plan.total} 天，加速使用 ${r.metric} 份；需要同时满足两项限制。`;
      for (let day = 0; day <= plan.total; day++) r.frames.push({ nodes: l.nodes.map((_, i) => plan.ends[i] <= day ? i : -1).filter((i) => i >= 0), active: l.nodes.map((_, i) => plan.starts[i] <= day && day < plan.ends[i] ? i : -1).filter((i) => i >= 0), edges: [], caption: `第 ${day} 天 · ${plan.ends.filter((t) => t <= day).length} 项完成` });
      break;
    }
    case "color":
    case "solid": {
      if (l.tutorial && l.type === "solid") {
        r.pass = s.colors.some((c) => c >= 0) && s.netVisited;
        r.message = r.pass ? "同一个面的颜色已同步到展开图。" : "先给任意面上色，再打开一次展开图。";
        r.valid = r.pass;
        break;
      }
      if (s.colors.includes(-1)) return incomplete("还有区域或面尚未上色。");
      r.edges = l.edges.map((e, i) => s.colors[e.a] === s.colors[e.b] ? i : -1).filter((i) => i >= 0);
      r.nodes = [...new Set(r.edges.flatMap((i) => [l.edges[i].a, l.edges[i].b]))];
      r.pass = !r.edges.length;
      r.metric = new Set(s.colors).size;
      r.unit = "色";
      r.message = r.pass ? "全部相邻区域已区分。" : `有 ${r.edges.length} 组相邻区域使用了相同颜色。`;
      break;
    }
    case "matching": {
      if (!s.selected.length) return incomplete("先安排至少一个岗位。");
      const ends = s.selected.flatMap((i) => [l.edges[i].a, l.edges[i].b]);
      r.nodes = [...new Set(ends.filter((x, i) => ends.indexOf(x) !== i))];
      r.metric = s.selected.length;
      r.unit = "个岗位";
      r.pass = !r.nodes.length && r.metric >= l.coverage;
      r.message = r.nodes.length ? "有工班或岗位同时参加了多份安排。" : r.pass ? "岗位安排已确认。" : `已安排 ${r.metric} 个岗位，还未达到目标。`;
      r.frames = s.selected.map((id, i) => ({ nodes: s.selected.slice(0, i + 1).flatMap((j) => [l.edges[j].a, l.edges[j].b]), active: [l.edges[id].a, l.edges[id].b], edges: s.selected.slice(0, i + 1), caption: `${l.nodes[l.edges[id].a].label} → ${l.nodes[l.edges[id].b].label}` }));
      break;
    }
    case "fault": {
      const expected = faults(l, l.faultKind);
      r.pass = sameSet(s.selected, expected);
      r.metric = expected.length;
      r.unit = "处关键对象";
      r.message = r.pass ? "关键对象已全部确认。" : "标记与逐一停用后的连通变化不符，可以继续测试。";
      r.frames = s.selected.map((i) => {
        const p = faultProbe(l, i);
        return { nodes: p.groups[0] ?? [], active: [], edges: l.faultKind === "edge" ? [i] : [], caption: `停用${l.faultKind === "edge" ? "线路 " + (i + 1) : l.nodes[i].label} · ${p.groups.length} 片网络` };
      });
      break;
    }
    case "isolation": {
      const result = isolationResult(l, s.selected);
      r.metric = result.infected;
      r.unit = "台感染";
      r.frames = result.frames.map((f) => ({ ...f, caption: f.caption.replace("收到信号", "受影响") }));
      r.pass = result.safe && s.selected.length <= l.budget && !s.selected.includes(l.source) && !s.selected.includes(l.target);
      r.message = s.selected.length > l.budget ? "隔离数量超出公开预算。" : !result.safe ? "传播仍然到达了核心。" : "核心安全，传播已被隔断。";
      break;
    }
    case "cut": {
      const keep = l.edges.map((_, i) => i).filter((i) => !s.selected.includes(i));
      r.pass = !Number.isFinite(distances(l, l.source, keep)[l.target]);
      r.metric = s.selected.length;
      r.unit = "条停线";
      r.message = r.pass ? "两端已断开。" : "两端仍有可达路径。";
      r.frames = [{ nodes: groups(l, keep).find((g) => g.includes(l.source)) ?? [], active: [], edges: keep, caption: r.message }];
      break;
    }
    case "reinforce": {
      r.metric = edgeCost(l, s.selected);
      r.unit = "造价";
      r.pass = reinforcementValid(l, s.selected) && r.metric <= l.budget;
      r.message = r.pass ? "全网已通过逐一故障测试。" : r.metric > l.budget ? "加固造价超过预算。" : "仍有一次单独故障会让网络失联。";
      const selected = l.edges.map((e, i) => !e.candidate || s.selected.includes(i) ? i : -1).filter((i) => i >= 0);
      const objects = l.faultKind === "edge" ? selected : l.nodes.map((_, i) => i);
      r.frames = objects.map((i) => {
        const gs = groups(l, l.faultKind === "edge" ? selected.filter((j) => j !== i) : selected, l.faultKind === "node" ? [i] : []);
        return { nodes: gs[0] ?? [], active: [], edges: l.faultKind === "edge" ? selected.filter((j) => j !== i) : selected.filter((j) => l.edges[j].a !== i && l.edges[j].b !== i), caption: `单独停用 ${l.faultKind === "edge" ? "线路 " + (i + 1) : l.nodes[i].label} · 剩余 ${gs.length} 片网络` };
      });
      break;
    }
    case "floyd": {
      const stage = floydStages(l)[l.stage];
      r.pass = sameSet(s.pairs, stage.improved);
      r.metric = stage.improved.length;
      r.unit = "组改善";
      r.message = r.pass ? "本轮的距离变化全部记录完毕。" : "部分点对的改善标记与本轮更新不符。";
      r.frames = stage.improved.map((p) => {
        const [a, b] = p.split("-").map(Number);
        return { nodes: [a, b], active: [stage.k], edges: [], caption: `${l.nodes[a].label}—${l.nodes[b].label}：${stage.before[a][b] === Infinity ? "∞" : stage.before[a][b]} → ${stage.after[a][b]}` };
      });
      break;
    }
  }
  const optimizable = ["mst", "forest", "shortest", "routes", "color", "solid", "schedule", "postman", "broadcast", "matching", "isolation", "cut", "reinforce"];
  r.perfect = r.pass && !l.tutorial && (!optimizable.includes(l.type) || r.metric === optimization(l));
  if (!r.frames.length) r.frames = [{ nodes: r.pass ? l.nodes.map((_, i) => i) : r.nodes, active: [], edges: [], caption: r.message }];
  return r;
}
function solution(l) {
  const s = initialState(l);
  switch (l.type) {
    case "reach":
      s.selected = distances(l, l.source).map((d, i) => Number.isFinite(d) ? i : -1).filter((i) => i >= 0);
      break;
    case "groups":
    case "scc":
      (l.type === "scc" ? strongGroups(l) : groups(l)).forEach((g, i) => g.forEach((n) => s.labels[n] = i));
      break;
    case "dfs": {
      const seen = /* @__PURE__ */ new Set();
      s.path = [l.source];
      const visit = (n) => {
        seen.add(n);
        for (const e of l.edges.filter((e2) => e2.a === n || e2.b === n)) {
          const b = e.a === n ? e.b : e.a;
          if (!seen.has(b)) {
            s.path.push(b);
            visit(b);
            s.path.push(n);
          }
        }
      };
      visit(l.source);
      break;
    }
    case "euler":
      s.path = eulerWalk(l);
      break;
    case "postman":
      s.path = eulerWalk(l, postman(l).pairs.flatMap((p) => walkEdges(l, p)));
      break;
    case "shortest":
      s.path = shortest(l, l.source, l.target);
      break;
    case "routes":
      s.routes = l.targets.map((t) => shortest(l, l.source, t));
      break;
    case "broadcast":
      s.source = l.fixedSource ? l.source : l.nodes.findIndex((_, i) => Math.max(...distances(l, i)) === optimization(l));
      s.prediction = l.fixedSource ? distances(l, l.source)[l.target] : optimization(l);
      break;
    case "forest":
    case "mst":
      s.selected = mst(l).edges;
      break;
    case "topo": {
      while (s.order.length < l.nodes.length) s.order.push(l.nodes.findIndex((_, i) => !s.order.includes(i) && l.edges.filter((e) => e.b === i).every((e) => s.order.includes(e.a))));
      break;
    }
    case "cycle":
      s.order = cycle(l);
      break;
    case "schedule":
      s.boosts = optimalBoost(l).boosts;
      break;
    case "color":
    case "solid":
      s.colors = chromatic(l).colors;
      s.netVisited = true;
      break;
    case "matching":
      s.selected = maximumMatching(l);
      break;
    case "fault":
      s.selected = faults(l, l.faultKind);
      break;
    case "isolation":
      s.selected = subsets(l.nodes.map((_, i) => i).filter((i) => i !== l.source && i !== l.target), l.budget).find((a) => {
        const r = isolationResult(l, a);
        return r.safe && r.infected === optimization(l);
      });
      break;
    case "cut":
      s.selected = subsets(l.edges.map((_, i) => i), optimization(l)).find((a) => !Number.isFinite(distances(l, l.source, l.edges.map((_, i) => i).filter((i) => !a.includes(i)))[l.target]));
      break;
    case "reinforce":
      s.selected = subsets(l.edges.map((e, i) => e.candidate ? i : -1).filter((i) => i >= 0)).find((a) => reinforcementValid(l, a) && edgeCost(l, a) === optimization(l));
      break;
    case "floyd":
      s.pairs = floydStages(l)[l.stage].improved;
      break;
  }
  return s;
}
function algorithmReplay(l) {
  const solved = solution(l), result = { ...evaluate(l, solved), state: solved };
  if (l.type === 'mst' || l.type === 'forest') return { ...result, ...treeReplay(l) };
  if (l.type === 'scc') return { ...result, ...componentReplay(l) };
  if (l.type === 'matching') return { ...result, ...matchingReplay(l) };
  if (l.type === "shortest" || l.type === "routes") {
    const ds = l.nodes.map(() => Infinity), confirmed = /* @__PURE__ */ new Set(), frames = [];
    ds[l.source] = 0;
    while (confirmed.size < l.nodes.length) {
      const n = l.nodes.map((_, i) => i).filter((i) => !confirmed.has(i)).sort((a, b) => ds[a] - ds[b])[0];
      if (!Number.isFinite(ds[n])) break;
      confirmed.add(n);
      const updates = [];
      for (const e of l.edges) {
        if (e.a !== n && (l.directed || e.b !== n)) continue;
        const b = e.a === n ? e.b : e.a;
        const next = ds[n] + (e.w ?? 1);
        if (next < ds[b]) {
          updates.push(`${l.nodes[b].label} ${Number.isFinite(ds[b]) ? ds[b] : "∞"}→${next}`);
          ds[b] = next;
        }
      }
      frames.push({ nodes: [...confirmed], active: [n], edges: [], values: [...ds], caption: `确认 ${l.nodes[n].label} = ${ds[n]}${updates.length ? "；更新 " + updates.join("、") : ""}` });
    }
    return { ...result, algorithm: 'Dijkstra', frames };
  }
  if (l.type === "floyd") return { ...result, frames: floydStages(l).flatMap((stage) => [{ nodes: l.nodes.map((_, i) => i).filter((i) => i <= stage.k), active: [stage.k], edges: [], caption: `开放 ${l.nodes[stage.k].label} · ${stage.improved.length} 组距离改善`, matrix: stage.after }]) };
  return result;
}
export {
  act,
  algorithmReplay,
  evaluate,
  faultProbe,
  initialState,
  optimization,
  reinforcementValid,
  solution
};
