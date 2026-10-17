import { palette, paletteText, colorNames } from "./assets.mjs";
import { solids, faceTopology } from "./solids.mjs";
import { walkEdges, criticalSchedule, floydStages, groups } from "./algorithms.mjs";
import { faultProbe, initialState } from "./engine.mjs";
import { icons } from 'lucide';
const escapeHTML = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function patternDefs() {
  return `<defs><pattern id="graph-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M18 20H22M20 18V22" fill="none" stroke="#b6c4b4" stroke-width=".8"/></pattern>${palette.map((color, i) => `<pattern id="pat-${i}" width="${12 + i * 3}" height="${12 + i * 3}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="${color}"/><path d="M-3 3L3 -3M0 ${12 + i * 3}L${12 + i * 3} 0M${9 + i * 3} ${15 + i * 3}L${15 + i * 3} ${9 + i * 3}" stroke="white" stroke-opacity=".08" stroke-width="1.5"/></pattern>`).join("")}<marker id="direction" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L9 4L0 8" fill="#536c65"/></marker></defs>`;
}
const paths = /* @__PURE__ */ new Set(["dfs", "euler", "shortest", "postman", "routes"]);
function facilityGlyph(node) {
  const name = node.side === 'left' ? 'Users' : node.side === 'right' ? 'BriefcaseBusiness' : /仓|货|客户/.test(node.label) ? 'Warehouse' : /泵|渠|井|阀|水/.test(node.label) ? 'Waves' : /电/.test(node.label) ? 'Zap' : /田|区/.test(node.label) ? 'LandPlot' : /源|调度|中继|接收/.test(node.label) ? 'RadioTower' : /桥|闸/.test(node.label) ? 'Dam' : 'Building2';
  const parts = (icons[name] ?? icons.Building2)[2].map(([tag,attrs])=>`<${tag} ${Object.entries(attrs).map(([k,v])=>`${k}="${escapeHTML(v)}"`).join(' ')}/>`).join('');
  return `<svg class="station-glyph" x="-13" y="-14" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${parts}</svg>`;
}
export function edgeGeometry(l, e) {
  const a = l.nodes[e.a], b = l.nodes[e.b];
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  const paired = l.directed && l.edges.some(other => other.a === e.b && other.b === e.a);
  const bend = e.bend ?? (paired ? [(a.x + b.x) / 2 - dy / length * 70, (a.y + b.y) / 2 + dx / length * 70] : null);
  const task = ['topo', 'cycle', 'schedule'].includes(l.type);
  const endpoint = (node, toward) => {
    const vx = toward.x - node.x, vy = toward.y - node.y;
    const scale = task ? Math.min(60 / Math.abs(vx), 40 / Math.abs(vy)) : 34 / Math.hypot(vx, vy);
    return {x: node.x + vx * scale, y: node.y + vy * scale};
  };
  const control = bend ? {x: bend[0], y: bend[1]} : null;
  const start = endpoint(a, control ?? b), end = endpoint(b, control ?? a);
  const point = t => control ? {
    x: (1-t)**2*start.x + 2*(1-t)*t*control.x + t*t*end.x,
    y: (1-t)**2*start.y + 2*(1-t)*t*control.y + t*t*end.y
  } : {x: start.x + (end.x-start.x)*t, y: start.y + (end.y-start.y)*t};
  return {d: `M${start.x} ${start.y} ${control ? `Q${control.x} ${control.y}` : 'L'} ${end.x} ${end.y}`, label: point(.5), point};
}
function graphBoard(l, s, ui = {}) {
  const frame = ui.frame, result = ui.result;
  const path = frame?.path ?? (l.type === "routes" ? s.routes[ui.target ?? 0] : paths.has(l.type) ? s.path : l.type === "cycle" ? s.order : []);
  const walked = walkEdges(l, path);
  const edgeEditable = ["forest", "mst", "matching", "cut", "reinforce"].includes(l.type) || l.type === "fault" && l.faultKind === "edge";
  const nodeEditable = !edgeEditable && l.type !== "floyd";
  const weighted = ["mst", "shortest", "routes", "postman", "reinforce", "floyd"].includes(l.type);
  const nodeSelected = ["reach", "isolation"].includes(l.type) || l.type === "fault" && l.faultKind === "node";
  let probe = null;
  if (l.type === "fault" && s.probe !== null) probe = faultProbe(l, s.probe);
  const edges = l.edges.map((e, i) => {
    const a = l.nodes[e.a], b = l.nodes[e.b], geometry = edgeGeometry(l, e);
    const {x: mx, y: my} = geometry.label;
    const editable = !ui.readOnly && edgeEditable && (l.type !== "reinforce" || e.candidate);
    const selected = edgeEditable && s.selected.includes(i), isWalked = walked.includes(i), live = frame?.edges?.includes(i), conflict = result?.edges?.includes(i);
    const disabled = probe && (l.faultKind === "edge" ? s.probe === i : e.a === s.probe || e.b === s.probe);
    const cls = ["network-edge", editable ? "editable" : "", selected ? "selected" : "", isWalked ? "walked" : "", live ? "live" : "", conflict ? "conflict" : "", e.candidate ? "candidate" : "", disabled ? "removed" : "", l.directed ? "dependency" : "", frame?.focusEdges?.includes(i) ? 'replay-focus' : ''].join(" ");
    return `<g class="${cls}" ${editable ? `data-edge="${i}" role="button" tabindex="0" aria-label="${escapeHTML(a.label + "至" + b.label)}${weighted ? "，" + (e.w ?? 1) : ""}" aria-pressed="${selected}"` : ""}><title>${escapeHTML(a.label + "—" + b.label)}</title><path class="edge-bed" d="${geometry.d}"/>${editable ? `<path class="edge-hit" d="${geometry.d}"/>` : ""}<path class="edge-line" d="${geometry.d}" ${l.directed ? 'marker-end="url(#direction)"' : ""}/>${weighted && (l.type !== "reinforce" || e.candidate) ? `<g class="weight"><rect x="${mx - 15}" y="${my - 14}" width="30" height="28" rx="3"/><text x="${mx}" y="${my + 5}">${e.w ?? 1}</text></g>` : ""}${l.type === "postman" && walked.filter((j) => j === i).length > 1 ? `<text class="repeat-label" x="${mx + 24}" y="${my - 8}">×${walked.filter((j) => j === i).length}</text>` : ""}</g>`;
  }).join("");
  const plan = l.type === "schedule" ? criticalSchedule(l, s.boosts) : null;
  const nodes = l.nodes.map((n, i) => {
    const selected = nodeSelected && s.selected.includes(i), visited = path.includes(i), current = path.at(-1) === i && paths.has(l.type), active = frame?.active?.includes(i), lit = frame?.nodes?.includes(i), conflict = result?.nodes?.includes(i);
    let color = s.labels[i] >= 0 ? palette[s.labels[i]] : null;
    if (probe) color = palette[probe.groups.findIndex((g) => g.includes(i))] ?? null;
    const ord = s.order.indexOf(i), isTask = ["topo", "cycle", "schedule"].includes(l.type), removed = probe && l.faultKind === "node" && s.probe === i;
    let meta = i === l.source ? "起点" : i === l.target ? "目标" : "";
    if (l.type === "broadcast") meta = i === s.source ? "发射源" : l.fixedSource && i === l.target ? "接收站" : meta;
    if (current) meta = '当前位置';
    if (l.type === "schedule") meta = `${n.duration - (s.boosts[i] ?? 0)} 天 · 加速 ${s.boosts[i]}`;
    if (l.type === "topo" && ord >= 0) meta = `顺序 ${ord + 1}`;
    if (l.type === 'cycle') meta = ord < 0 ? '待排查' : ord === 0 ? '循环起点' : `环内第 ${ord+1} 项`;
    if (l.type === 'floyd') meta = i === l.stage ? '本轮开放中转' : i < l.stage ? '已开放中转' : '只能起终，不可中转';
    if (s.labels[i] >= 0 && ["scc", "groups"].includes(l.type)) meta = `分组 ${s.labels[i] + 1}`;
    if (frame?.values) meta = `${frame.nodes.includes(i) ? '已确认' : '暂定'} ${Number.isFinite(frame.values[i]) ? frame.values[i] : '∞'}`;
    if (n.detail) meta = n.detail;
    const cls = ["station", nodeEditable ? "editable" : "", selected ? "selected" : "", visited ? "visited" : "", current ? "current" : "", active ? "active" : "", lit ? "lit" : "", conflict ? "conflict" : "", removed ? "removed" : ""].join(" ");
    const enabled = !ui.readOnly && nodeEditable && !(l.type === "broadcast" && l.fixedSource);
    const shape = isTask ? `<rect class="station-base" x="-52" y="-28" width="104" height="64" rx="2"/><rect class="station-body" x="-52" y="-32" width="104" height="64" rx="2"/>` : `<path class="station-base" d="M-28 -19H28V30H-28Z"/><path class="station-body" d="M-28 -26H20L28 -18V24H-28Z"/>`;
    return `<g class="${cls}" transform="translate(${n.x} ${n.y})" ${color ? `style="--group-color:${color};--group-ink:${paletteText[palette.indexOf(color)]}"` : ""} ${enabled ? `data-node="${i}" role="button" tabindex="0" aria-label="${escapeHTML(n.label + "，" + meta)}" aria-pressed="${selected}"` : ""}><title>${escapeHTML(n.label + " · " + meta)}</title>${shape}${!isTask && s.labels[i] < 0 ? facilityGlyph(n) : ""}${current ? '<path class="dispatch-token" d="M-8 -48H5L13 -40L5 -32H-8L0 -40Z"/>' : ""}<text class="station-name" y="${isTask ? 5 : 48}">${escapeHTML(n.label)}</text><text class="station-meta" y="${isTask ? 53 : 69}">${escapeHTML(meta)}</text>${s.labels[i] >= 0 ? `<text class="group-number" x="0" y="5">${s.labels[i] + 1}</text>` : ""}${plan ? `<text class="schedule-range" y="74">第 ${plan.starts[i]}—${plan.ends[i]} 天</text>` : ""}</g>`;
  }).join("");
  let annotation = "";
  if (probe) annotation = `<text class="graph-note" x="500" y="550">本次停用后：${probe.groups.length} 片网络 · 下一次测试自动恢复原图</text>`;
  return `<svg class="graph-svg" viewBox="0 0 1000 600" role="group" aria-label="${escapeHTML(l.title)}棋盘">${patternDefs()}<rect width="1000" height="600" fill="url(#graph-grid)" opacity=".65"/><path d="M30 40H70M30 40V70M970 560H930M970 560V530" class="board-corners"/>${edges}${nodes}${annotation}</svg>`;
}
function regionBoard(l, s, ui = {}) {
  const regions = l.nodes.map((n, i) => `<g class="region ${ui.result?.nodes?.includes(i) ? "conflict" : ""}" data-node="${i}" role="button" tabindex="0" aria-label="${escapeHTML(n.label)}，${s.colors[i] >= 0 ? colorNames[s.colors[i]] : "未着色"}"><polygon points="${n.polygon.map((p) => p.join(",")).join(" ")}" fill="${s.colors[i] < 0 ? "#e1e7de" : `url(#pat-${s.colors[i]})`}"/><text x="${n.x}" y="${n.y}" fill="${s.colors[i] < 0 ? "#243c35" : paletteText[s.colors[i]]}">${escapeHTML(n.label)}</text><text class="region-index" x="${n.x}" y="${n.y + 22}" fill="${s.colors[i] < 0 ? "#476053" : paletteText[s.colors[i]]}">${s.colors[i] < 0 ? "未着色" : String(s.colors[i] + 1).padStart(2, "0")}</text></g>`).join("");
  const adj = ui.adjacency ? l.edges.map((e) => `<line x1="${l.nodes[e.a].x}" y1="${l.nodes[e.a].y}" x2="${l.nodes[e.b].x}" y2="${l.nodes[e.b].y}" class="adjacency-line"/>`).join("") : "";
  return `<svg class="graph-svg" viewBox="0 0 1000 600" role="group" aria-label="区域地图">${patternDefs()}${regions}${adj}</svg>`;
}
function netBoard(l, s, result) {
  const spec = solids[l.solid], edges = faceTopology(spec), cell = 140;
  const faces = spec.net.map((p, i) => {
    const polygon = l.solid === "cube" ? [[p[0], p[1]], [p[0] + cell, p[1]], [p[0] + cell, p[1] + cell], [p[0], p[1] + cell]] : p;
    const x = polygon.reduce((a, p2) => a + p2[0], 0) / polygon.length, y = polygon.reduce((a, p2) => a + p2[1], 0) / polygon.length;
    const markings = polygon.map((a, j) => {
      const b = polygon[(j + 1) % polygon.length], vertices = spec.netVertices[i];
      const key = [vertices[j], vertices[(j + 1) % vertices.length]].sort((a2, b2) => a2 - b2).join("-");
      const edge = edges.find((e) => e.key === key), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      return `<text class="net-edge-label" x="${mx + (x - mx) * 0.16}" y="${my + (y - my) * 0.16 + 4}" fill="${s.colors[i] < 0 ? "#273f36" : paletteText[s.colors[i]]}">${String(edge.id + 1).padStart(2, "0")}</text>`;
    }).join("");
    return `<g class="region ${result?.nodes?.includes(i) ? "conflict" : ""}" role="button" tabindex="0" data-node="${i}" aria-label="${spec.labels[i]}面，${s.colors[i] >= 0 ? colorNames[s.colors[i]] : "未着色"}"><polygon points="${polygon.map((p2) => p2.join(",")).join(" ")}" fill="${s.colors[i] < 0 ? "#e1e7de" : `url(#pat-${s.colors[i]})`}"/><text x="${x}" y="${y + 5}" fill="${s.colors[i] < 0 ? "#273f36" : paletteText[s.colors[i]]}">${spec.labels[i]}</text>${markings}</g>`;
  }).join("");
  return `<svg class="graph-svg net-svg" viewBox="${spec.netViewBox??`100 40 800 ${l.solid === 'cube'?480:630}`}" role="group" aria-label="多面体展开图，面内棱号相同表示共享棱">${patternDefs()}${faces}</svg>`;
}
function floydTable(l, s) {
  const stage = floydStages(l)[l.stage];
  const value=n=>Number.isFinite(n)?n:'不通';
  return `<div class="pair-grid">${l.nodes.flatMap((a, i) => l.nodes.filter((_, j) => j > i).map((b) => {
    const j = l.nodes.indexOf(b), key = `${i}-${j}`;
    return `<button data-pair="${key}" class="pair-option ${s.pairs.includes(key) ? "selected" : ""}" aria-pressed="${s.pairs.includes(key)}"><strong>${a.label}—${b.label}</strong><span>原用时 <b>${value(stage.before[i][j])}</b></span><small>经${l.nodes[l.stage].label}：${value(stage.before[i][l.stage])} + ${value(stage.before[l.stage][j])}</small></button>`;
  })).join("")}</div>`;
}
function timeline(l, s) {
  const plan = criticalSchedule(l, s.boosts), total = Math.max(1, plan.total);
  return `<div class="timeline" aria-label="施工时间线">${l.nodes.map((n, i) => `<div class="timeline-row"><span>${n.label}</span><div><i style="left:${plan.starts[i] / total * 100}%;width:${(plan.ends[i] - plan.starts[i]) / total * 100}%">${plan.ends[i] - plan.starts[i]} 天</i></div></div>`).join("")}<p>并行施工 · 总工期 ${plan.total} 天</p></div>`;
}
function condensedBoard(l, reduced) {
  const nodes = reduced.components.map((members, i) => ({
    label: `互达区 ${i + 1}`, detail: members.map(n => l.nodes[n].label).join('·'),
    x: reduced.components.length === 1 ? 500 : 140 + 720 * i / (reduced.components.length - 1), y: 290
  }));
  const graph = { title: '强连通缩点', nodes, edges: reduced.edges, type: 'groups', directed: true };
  const state = initialState(graph); state.labels = nodes.map((_, i) => i);
  return graphBoard(graph, state, { readOnly: true });
}
function distanceTable(l, matrix) {
  const cell = value => Number.isFinite(value) ? value : '∞';
  return `<table class="replay-matrix" aria-label="已开放中转站的距离矩阵"><thead><tr><th scope="col">站点</th>${l.nodes.map(n => `<th scope="col">${escapeHTML(n.label)}</th>`).join('')}</tr></thead><tbody>${l.nodes.map((n, i) => `<tr><th scope="row">${escapeHTML(n.label)}</th>${matrix[i].map(v => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
export {
  condensedBoard,
  distanceTable,
  escapeHTML,
  floydTable,
  graphBoard,
  netBoard,
  patternDefs,
  regionBoard,
  timeline
};
