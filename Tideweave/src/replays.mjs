import { groups, strongGroups } from './algorithms.mjs';

const endpoints = (l, edges) => [...new Set(edges.flatMap(i => [l.edges[i].a, l.edges[i].b]))];
const edgeName = (l, i) => `${l.nodes[l.edges[i].a].label}—${l.nodes[l.edges[i].b].label}`;

export function treeReplay(l) {
  const prim = l.unit === '03-01', chosen = [], frames = [];
  const candidates = l.edges.map((e, i) => i).filter(i => !l.edges[i].candidate)
    .sort((a, b) => (l.edges[a].w ?? 1) - (l.edges[b].w ?? 1) || a - b);
  const visited = new Set([l.source ?? 0]);
  const push = (caption, focusEdges = [], phase = 'inspect') => frames.push({
    nodes: prim ? [...visited] : endpoints(l, chosen), active: [], edges: [...chosen], focusEdges,
    state: { selected: [...chosen] }, caption, phase
  });
  if (prim) {
    push('Prim · 从电站起步，只比较连接网内与网外的线路。');
    while (visited.size < l.nodes.length) {
      const crossing = candidates.filter(i => visited.has(l.edges[i].a) !== visited.has(l.edges[i].b));
      if (!crossing.length) break;
      push(`跨出当前供电网的线路有 ${crossing.length} 条，比较其造价。`, crossing);
      const id = crossing[0], e = l.edges[id];
      chosen.push(id); visited.add(e.a); visited.add(e.b);
      push(`接入 ${edgeName(l, id)} · 造价 ${e.w ?? 1}，本次跨界线路中最低。`, [id], 'accept');
    }
  } else {
    push('Kruskal · 按造价由低到高检查线路；已相通的两端不必再连。');
    for (const id of candidates) {
      const e = l.edges[id], component = groups(l, chosen).find(g => g.includes(e.a));
      if (component.includes(e.b)) {
        push(`跳过 ${edgeName(l, id)} · 两端已经相通，再连会成环。`, [id], 'reject');
      } else {
        chosen.push(id);
        push(`接入 ${edgeName(l, id)} · 造价 ${e.w ?? 1}，合并两片网络。`, [id], 'accept');
      }
    }
  }
  push(`保留 ${chosen.length} 条线路 · 总造价 ${chosen.reduce((a, i) => a + (l.edges[i].w ?? 1), 0)}。`, [], 'complete');
  return { algorithm: prim ? 'Prim' : 'Kruskal', frames };
}

export function condensation(l) {
  const components = strongGroups(l).map(g => g.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  const labels = l.nodes.map((_, i) => components.findIndex(g => g.includes(i)));
  const edges = [];
  for (const e of l.edges) {
    const a = labels[e.a], b = labels[e.b];
    if (a !== b && !edges.some(x => x.a === a && x.b === b)) edges.push({ a, b, w: 1 });
  }
  return { components, labels, edges };
}

export function componentReplay(l) {
  const reduced = condensation(l), labels = l.nodes.map(() => -1);
  const frames = reduced.components.map((ns, i) => {
    ns.forEach(n => { labels[n] = i; });
    return { nodes: ns, active: ns, edges: [], state: { labels: [...labels] },
      caption: `互达区 ${i + 1}：${ns.map(n => l.nodes[n].label).join('、')} · 能沿箭头相互往返的最大组。` };
  });
  frames.push({ nodes: [], active: [], edges: [], condensed: reduced, phase: 'condensed',
    caption: '每组收为一个点，移除组内线路，保留组间方向；缩点后没有有向环。' });
  return { algorithm: '强连通缩点', frames };
}

export function matchingReplay(l) {
  let selected = [];
  const frames = [{ nodes: [], active: [], edges: [], state: { selected: [] },
    caption: '从空安排开始；沿未选与已选资格线交替寻找空岗位。', phase: 'start' }];
  // A complete alternating path is flipped at once, so every committed frame is a matching.
  for (const start of l.nodes.map((_, i) => i).filter(i => l.nodes[i].side === 'left')) {
    const parent = new Map([[start, null]]), queue = [start];
    let end = null;
    for (let q = 0; q < queue.length && end === null; q++) {
      const a = queue[q];
      for (let id = 0; id < l.edges.length; id++) {
        const e = l.edges[id];
        if (e.a !== a || selected.includes(id) || parent.has(e.b)) continue;
        parent.set(e.b, { from: a, edge: id });
        const occupied = selected.find(j => l.edges[j].b === e.b);
        if (occupied === undefined) { end = e.b; break; }
        const owner = l.edges[occupied].a;
        if (!parent.has(owner)) { parent.set(owner, { from: e.b, edge: occupied }); queue.push(owner); }
      }
    }
    if (end === null) {
      frames.push({ nodes: endpoints(l, selected), active: [start], edges: [...selected], state: { selected: [...selected] },
        caption: `${l.nodes[start].label} 暂无通往空岗位的交替链。`, phase: 'blocked' });
      continue;
    }
    const chain = [], route = [end];
    for (let n = end; n !== start;) {
      const p = parent.get(n); chain.unshift(p.edge); n = p.from; route.unshift(n);
    }
    frames.push({ nodes: endpoints(l, selected), active: [start, end], edges: [...selected], focusEdges: chain,
      state: { selected: [...selected] }, caption: `找到交替链：${route.map(n => l.nodes[n].label).join('—')}`, phase: 'path', augmentation: chain });
    selected = [...selected.filter(i => !chain.includes(i)), ...chain.filter(i => !selected.includes(i))];
    frames.push({ nodes: endpoints(l, selected), active: [start, end], edges: [...selected],
      state: { selected: [...selected] }, caption: `沿链取消旧安排、接入新安排 · 岗位数增至 ${selected.length}。`, phase: 'augment', augmentation: chain });
  }
  return { algorithm: '增广路径', frames };
}
