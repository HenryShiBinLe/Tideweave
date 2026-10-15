/* ==========================================================================
 * LINK · 关系实验室
 * 原生 HTML + CSS + JavaScript，无任何外部依赖，可离线打开。
 *
 * 目录：
 *   1. 关卡数据 LEVELS
 *   2. 颜色数据 COLORS
 *   3. 运行时状态
 *   4. DOM 引用与工具
 *   5. 图算法（连通分量 / 桥 / 割点 / 网络韧性 / 着色冲突）
 *   6. 进度存储
 *   7. 街区几何计算
 *   8. 渲染
 *   9. 任务卡片
 *  10. 交互
 *  11. 启动
 * ========================================================================== */

'use strict';

/* ------------------------------------------------------------- 1. 关卡数据 */

const LEVELS = [
  {
    id: 1,
    name: '一线之隔',
    chapter: '01 / 断开连接',
    type: 'edge-cut',
    limit: 1,
    title: '一线之隔',
    story: '两组服务器正在交换消息。你只有一次断开线路的机会，让它们无法再全部互相联系。',
    goal: '最多切断 1 条线，让网络分成至少 2 组。',
    help: '点击一条线路，将它切断。',
    concept: '桥',
    explanation: '这条线是两边唯一的通路。去掉它，网络就分开了。图论把这样的边叫作“桥”。',
    nodes: [
      [130, 235],
      [260, 135],
      [260, 335],
      [440, 235],
      [570, 135],
      [570, 335]
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 0],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 3]
    ]
  },

  {
    id: 2,
    name: '关键人物',
    chapter: '01 / 断开连接',
    type: 'node-cut',
    limit: 1,
    title: '关键人物',
    story: '线路变多了，这次你可以关闭一台服务器。关闭后，与它相连的所有线路也会消失。',
    goal: '最多关闭 1 台服务器，让其余服务器分成至少 2 组。',
    help: '点击一台服务器，将它关闭。',
    concept: '割点',
    explanation: '两边都绕不开这台服务器。关掉它，剩下的网络就分开了。这种节点叫作“割点”。',
    nodes: [
      [145, 150],
      [145, 320],
      [350, 235],
      [550, 150],
      [550, 320]
    ],
    edges: [
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 3],
      [2, 4],
      [3, 4]
    ]
  },

  {
    id: 3,
    name: '备用路线',
    chapter: '01 / 断开连接',
    type: 'edge-cut',
    limit: 2,
    title: '备用路线',
    story: '服务器围成了一圈。一条线路断了，消息好像还能从另一边绕过去。',
    goal: '最多切断 2 条线，让网络分成至少 2 组。',
    help: '点击线路，可以连续切断两条。',
    concept: '环与冗余路径',
    explanation: '围成一圈，就有了绕行路线。第一条线断了，另一边还能走；再切一条，网络才真正分开。',
    nodes: [
      [200, 135],
      [400, 95],
      [600, 185],
      [560, 335],
      [350, 375],
      [150, 295]
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0]
    ]
  },

  {
    id: 4,
    name: '最后的保险',
    chapter: '02 / 守护连接',
    type: 'defend',
    limit: 1,
    title: '最后的保险',
    story: '现在你是网络运维。你只能新建一条线路，让整个网络抵抗一次线路故障。',
    goal: '只加 1 条新线，使任意一条线路断开后，所有服务器仍能互通。',
    help: '依次点击两个服务器来加线，再运行故障测试。',
    concept: '让桥进入环',
    explanation: '把两端接起来，脆弱的连接就进入了一个环。任意一条线断开时，消息都能绕行。',
    nodes: [
      [105, 145],
      [95, 315],
      [245, 235],
      [350, 145],
      [350, 315],
      [475, 235],
      [610, 145],
      [610, 315]
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 0],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 3],
      [5, 6],
      [6, 7],
      [7, 5]
    ]
  },

  {
    id: 5,
    name: '五色街区？',
    chapter: '03 / 分配颜色',
    type: 'color',
    limit: 3,
    title: '五色街区？',
    story: '五个街区共用一张地图。共享一段边界的街区不能使用同一种颜色。',
    goal: '涂满 5 个街区，相邻不同色，最多使用 3 色。',
    help: '先选颜色，再点击街区。只碰到一个角不算相邻。',
    concept: '图着色 · 奇环',
    explanation: '两种颜色交替绕一圈后，首尾会撞色，所以必须使用第三种颜色。',
    regions: [
      { name: '北岸' },
      { name: '东丘' },
      { name: '南园' },
      { name: '西港' },
      { name: '林地' }
    ],
    adjacency: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0]
    ]
  },

  {
    id: 6,
    name: '中央公园',
    chapter: '03 / 分配颜色',
    type: 'color',
    limit: 4,
    title: '中央公园',
    story: '四个区域彼此都相邻。看起来只有四块地，但它们之间的关系非常紧密。',
    goal: '涂满所有区域，相邻不同色，使用尽可能少的颜色。',
    help: '先选颜色，再点击区域。',
    concept: '图着色 · 完全图',
    explanation: '这四个区域两两相邻，每一个都必须使用不同颜色。这就是四个节点两两连接的完全图。',
    regions: [
      { name: '北城' },
      { name: '东城' },
      { name: '西城' },
      { name: '公园' }
    ],
    adjacency: [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3]
    ]
  }
];

/* ------------------------------------------------------------- 2. 颜色数据 */

const COLORS = [
  { name: '珊瑚', value: '#b8583e', symbol: '●' },
  { name: '海蓝', value: '#376d9f', symbol: '≈' },
  { name: '苔绿', value: '#537c50', symbol: '✳' },
  { name: '鸢尾', value: '#86609d', symbol: '◆' }
];

const STORAGE_KEY = 'link-lab-progress';

/* ----------------------------------------------------------- 3. 运行时状态 */

let currentLevel = 0;
let phase = 'intro';            // intro / playing / success

let removedEdges = [];
let removedNodes = [];
let addedEdges = [];
let colors = [];
let history = [];
let completedLevels = [];

let selectedColor = 0;          // 调色板当前选中的颜色
let pendingNode = null;         // 防御关：已选中的第一个节点
let testFailures = [];          // 防御关：故障测试中失效的线路（allEdgesNow 的下标）
let conflictBorders = [];       // 着色关：相邻同色的边界对

/* ------------------------------------------------------ 4. DOM 与工具函数 */

const $ = id => document.getElementById(id);

const el = {
  board: $('board'),
  boardCaption: $('board-caption'),
  boardCode: $('board-code'),
  levelNav: $('level-nav'),
  chapter: $('chapter'),
  levelNumber: $('level-number'),
  missionContent: $('mission-content'),
  liveStatus: $('live-status'),
  primary: $('primary-action'),
  quietNote: $('quiet-note'),
  palette: $('palette'),
  legend: $('legend'),
  undo: $('undo'),
  reset: $('reset'),
  notebook: $('notebook-dialog'),
  notebookEntries: $('notebook-entries'),
  discoveryCount: $('discovery-count'),
  totalComplete: $('total-complete'),
  openNotebook: $('open-notebook'),
  closeNotebook: $('close-notebook'),
  replayAll: $('replay-all')
};

const pad2 = n => String(n).padStart(2, '0');
const L = () => LEVELS[currentLevel];
const isColorLevel = () => L().type === 'color';
const has = (list, v) => list.indexOf(v) !== -1;

/* ---------------------------------------------------------------- 5. 算法 */

/**
 * 计算网络中有几个独立的连通部分。
 * @param {Array} nodes 节点数组（这里只用它的长度）
 * @param {Array} edges 边数组，每项是 [a, b]
 * @param {Array} removedNodes 被关闭的节点下标
 */
function countComponents(nodes, edges, removedNodes = []) {
  const gone = new Set(removedNodes);
  const adj = new Map();

  for (let i = 0; i < nodes.length; i++) {
    if (!gone.has(i)) adj.set(i, []);
  }

  for (const [a, b] of edges) {
    if (gone.has(a) || gone.has(b)) continue;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }

  const seen = new Set();
  let count = 0;

  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    count++;
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const cur = queue.pop();
      const nbs = adj.get(cur) || [];
      for (const nb of nbs) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        queue.push(nb);
      }
    }
  }

  return count;
}

/** 这条边是不是桥：临时移除它，网络是否被拆开。 */
function isBridge(edgeIndex) {
  const lv = L();
  const copiedEdges = lv.edges.filter((_, index) => index !== edgeIndex);
  return countComponents(lv.nodes, copiedEdges) > 1;
}

/** 这个节点是不是割点：临时关闭它，网络是否被拆开。 */
function isArticulationPoint(nodeIndex) {
  const lv = L();
  return countComponents(lv.nodes, lv.edges, [nodeIndex]) > 1;
}

/** 当前（含新增线路的）网络，是否任意一条边断开后仍然连通。 */
function networkIsResilient() {
  const lv = L();
  const allEdges = allEdgesNow();
  if (countComponents(lv.nodes, allEdges) > 1) return false;

  for (let i = 0; i < allEdges.length; i++) {
    const copiedEdges = allEdges.filter((_, index) => index !== i);
    if (countComponents(lv.nodes, copiedEdges) > 1) return false;
  }

  return true;
}

/** 找出相邻且同色的边界。 */
function findColorConflicts(colors, adjacency) {
  return adjacency.filter(([a, b]) => {
    return colors[a] !== null &&
           colors[a] !== undefined &&
           colors[a] === colors[b];
  });
}

/** 当前实际存在的线路：基础线路去掉已切断的，再加上新增的。 */
function allEdgesNow() {
  const lv = L();
  const base = lv.edges || [];
  const kept = base.filter((_, index) => !has(removedEdges, index));
  return kept.concat(addedEdges.map(edge => [...edge]));
}

function edgeExists(edges, a, b) {
  return edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/* ------------------------------------------------------------ 6. 进度存储 */

function loadProgress() {
  completedLevels = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      completedLevels = parsed
        .map(Number)
        .filter(n => Number.isInteger(n) && n >= 1 && n <= LEVELS.length);
    }
  } catch (err) {
    completedLevels = [];
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completedLevels));
  } catch (err) {
    /* 隐私模式或 file:// 受限时静默忽略 */
  }
}

function isUnlocked(index) {
  if (index === 0) return true;
  if (has(completedLevels, LEVELS[index].id)) return true;
  return has(completedLevels, LEVELS[index - 1].id);
}

/* -------------------------------------------------------- 7. 街区几何计算 */

/** 极坐标：0 度在正上方，顺时针增大。 */
function polar(cx, cy, r, deg) {
  const a = deg * Math.PI / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function sectorPath(cx, cy, R, r0, a0, a1) {
  const [x1, y1] = polar(cx, cy, R, a0);
  const [x2, y2] = polar(cx, cy, R, a1);
  const large = (a1 - a0) > 180 ? 1 : 0;

  if (r0 <= 0) {
    return `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
  }

  const [u1, v1] = polar(cx, cy, r0, a0);
  const [u2, v2] = polar(cx, cy, r0, a1);
  return `M ${u1} ${v1} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} ` +
         `L ${u2} ${v2} A ${r0} ${r0} 0 ${large} 0 ${u1} ${v1} Z`;
}

/**
 * 把邻接关系画成一张街区地图：
 *   5 个区域 → 5 个扇形（每个扇形只与左右相邻，首尾相接处只碰一个角）
 *   4 个区域 → 3 个扇形 + 1 个中央区（两两相邻）
 */
function colorGeometry(lv) {
  const cx = 400, cy = 232;
  const n = lv.regions.length;
  const hasCenter = n === 4;
  const sectorCount = hasCenter ? n - 1 : n;
  const R = 205;
  const r0 = hasCenter ? 100 : 0;
  const step = 360 / sectorCount;
  const centerIndex = hasCenter ? n - 1 : null;

  const regionPaths = [];
  for (let i = 0; i < sectorCount; i++) {
    regionPaths.push(sectorPath(cx, cy, R, r0, i * step, (i + 1) * step));
  }
  if (hasCenter) regionPaths.push(null);   // 中央区用 <circle> 画

  const borders = lv.adjacency.map(([a, b]) => {
    if (centerIndex !== null && (a === centerIndex || b === centerIndex)) {
      const k = (a === centerIndex) ? b : a;
      const a0 = k * step, a1 = (k + 1) * step;
      const [x1, y1] = polar(cx, cy, r0, a0);
      const [x2, y2] = polar(cx, cy, r0, a1);
      const large = (a1 - a0) > 180 ? 1 : 0;
      return { a, b, d: `M ${x1} ${y1} A ${r0} ${r0} 0 ${large} 1 ${x2} ${y2}` };
    }

    const wrap = (a === 0 && b === sectorCount - 1) || (b === 0 && a === sectorCount - 1);
    const ang = wrap ? 360 : Math.max(a, b) * step;
    const [x1, y1] = polar(cx, cy, r0, ang);
    const [x2, y2] = polar(cx, cy, R, ang);
    return { a, b, d: `M ${x1} ${y1} L ${x2} ${y2}` };
  });

  return { cx, cy, R, r0, step, sectorCount, centerIndex, regionPaths, borders };
}

/* ---------------------------------------------------------------- 8. 渲染 */

function renderAll() {
  renderNav();
  renderProgress();
  renderMission();
  renderBoard();
  renderPalette();
  renderLegend();
  renderControls();
  renderNotebook();
}

function renderProgress() {
  el.discoveryCount.textContent = `${completedLevels.length} / ${LEVELS.length}`;
  el.totalComplete.textContent = pad2(completedLevels.length);
}

function renderNav() {
  el.levelNav.innerHTML = LEVELS.map((lv, i) => {
    const done = has(completedLevels, lv.id);
    const unlocked = isUnlocked(i);
    const active = i === currentLevel;
    const classes = ['level-chip'];
    if (active) classes.push('is-active');
    if (done) classes.push('is-done');

    const mark = done
      ? '<span class="chip-done">✓</span>'
      : (unlocked ? '' : '<span class="chip-lock">🔒</span>');

    return `<button type="button" class="${classes.join(' ')}" data-level="${i}"` +
           `${unlocked ? '' : ' disabled'} aria-current="${active ? 'true' : 'false'}">` +
           `<span class="chip-num">${pad2(lv.id)}</span>` +
           `<span class="chip-name">${unlocked ? lv.name : '未解锁'}</span>` +
           `${mark}</button>`;
  }).join('');
}

/** 重新渲染前记住焦点，渲染后还原，键盘操作不丢焦点。 */
function focusSelector() {
  const active = document.activeElement;
  if (!active || typeof active.getAttribute !== 'function') return null;
  const e = active.getAttribute('data-edge');
  const n = active.getAttribute('data-node');
  const r = active.getAttribute('data-region');
  if (e !== null) return `[data-edge="${e}"]`;
  if (n !== null) return `[data-node="${n}"]`;
  if (r !== null) return `[data-region="${r}"]`;
  return null;
}

function restoreFocus(selector) {
  if (!selector || typeof el.board.querySelector !== 'function') return;
  const next = el.board.querySelector(selector);
  if (next && typeof next.focus === 'function') next.focus();
}

function renderBoard() {
  const selector = focusSelector();
  if (isColorLevel()) renderColorBoard();
  else renderNetworkBoard();
  restoreFocus(selector);
}

const SVG_DEFS =
  '<defs>' +
  '<filter id="node-shadow" x="-70%" y="-70%" width="240%" height="240%">' +
  '<feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.42"/>' +
  '</filter>' +
  '</defs>';

function renderNetworkBoard() {
  const lv = L();
  const nodes = lv.nodes;
  const base = lv.edges || [];
  const live = allEdgesNow();
  const baseCount = base.length;
  const interactive = phase === 'playing';
  const out = [SVG_DEFS];

  /* 线路 */
  out.push('<g class="layer-edges">');

  base.forEach(([a, b], i) => {
    if (!has(removedEdges, i)) return;
    const [x1, y1] = nodes[a], [x2, y2] = nodes[b];
    out.push(`<line class="edge edge-cut" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  });

  live.forEach(([a, b], i) => {
    const [x1, y1] = nodes[a], [x2, y2] = nodes[b];
    const classes = ['edge'];
    if (i >= baseCount) classes.push('edge-added');
    if (has(testFailures, i)) classes.push('edge-fail');
    out.push(`<line class="${classes.join(' ')}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  });

  out.push('</g>');

  /* 线路点击热区 */
  if (interactive && lv.type === 'edge-cut') {
    out.push('<g class="layer-hits">');
    base.forEach(([a, b], i) => {
      const [x1, y1] = nodes[a], [x2, y2] = nodes[b];
      const cut = has(removedEdges, i);
      const label = `线路 ${a + 1} 到 ${b + 1}${cut ? '，已切断，回车恢复' : '，回车切断'}`;
      out.push(`<line class="edge-hit" data-edge="${i}" tabindex="0" role="button"` +
               ` aria-label="${label}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    });
    out.push('</g>');
  }

  /* 服务器 */
  out.push('<g class="layer-nodes">');
  nodes.forEach(([x, y], i) => {
    const off = has(removedNodes, i);
    const classes = ['node'];
    if (off) classes.push('node-off');
    if (pendingNode === i) classes.push('node-pending');

    const focusable = interactive && (lv.type === 'node-cut' || lv.type === 'defend');
    const attrs = focusable ? ' tabindex="0" role="button"' : '';
    const label = `服务器 ${i + 1}${off ? '，已关闭，回车恢复' : '，回车关闭'}`;

    out.push(
      `<g class="node-wrap" transform="translate(${x},${y})">` +
        `<g class="${classes.join(' ')}" data-node="${i}"${attrs} aria-label="${label}">` +
          (focusable ? '<circle class="node-hit" r="38"/>' : '') +
          '<circle class="node-ring" r="25"/>' +
          '<circle class="node-core" r="19"/>' +
          `<text class="node-label">${i + 1}</text>` +
          (off ? '<text class="node-cross">✕</text>' : '') +
        '</g>' +
      '</g>'
    );
  });
  out.push('</g>');

  el.board.innerHTML = out.join('');
}

function renderColorBoard() {
  const lv = L();
  const g = colorGeometry(lv);
  const interactive = phase === 'playing';
  const out = [SVG_DEFS];

  const isConflicting = i => conflictBorders.some(([a, b]) => a === i || b === i);

  /* 区域 */
  out.push('<g class="layer-regions">');
  for (let i = 0; i < lv.regions.length; i++) {
    const painted = colors[i] !== null && colors[i] !== undefined;
    const classes = ['region'];
    if (painted) classes.push('is-painted');
    if (isConflicting(i)) classes.push('is-conflict');

    const attrs = interactive ? ' tabindex="0" role="button"' : '';
    const style = painted ? ` style="fill:${COLORS[colors[i]].value}"` : '';
    const name = `${lv.regions[i].name}${painted ? '，已涂' + COLORS[colors[i]].name : '，未涂色'}`;
    const path = g.regionPaths[i];

    if (path === null) {
      out.push(`<circle class="${classes.join(' ')}" data-region="${i}"${attrs}` +
               ` aria-label="${name}"${style} cx="${g.cx}" cy="${g.cy}" r="${g.r0}"/>`);
    } else {
      out.push(`<path class="${classes.join(' ')}" data-region="${i}"${attrs}` +
               ` aria-label="${name}"${style} d="${path}"/>`);
    }
  }
  out.push('</g>');

  /* 边界：相邻同色时只把这条边界标红 */
  out.push('<g class="layer-borders">');
  g.borders.forEach(({ a, b, d }) => {
    const bad = conflictBorders.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    out.push(`<path class="border${bad ? ' border-conflict' : ''}" d="${d}"/>`);
  });
  out.push('</g>');

  /* 标签 */
  out.push('<g class="layer-labels">');
  const labelR = g.centerIndex === null ? g.R * 0.62 : (g.R + g.r0) / 2;
  lv.regions.forEach((region, i) => {
    let x, y;
    if (g.centerIndex === i) {
      x = g.cx;
      y = g.cy + 5;
    } else {
      const [px, py] = polar(g.cx, g.cy, labelR, (i + 0.5) * g.step);
      x = px;
      y = py + 5;
    }
    const painted = colors[i] !== null && colors[i] !== undefined;
    const mark = painted ? ' ' + COLORS[colors[i]].symbol : '';
    out.push(`<text class="region-label" x="${x}" y="${y}">${region.name}${mark}</text>`);
  });
  out.push('</g>');

  el.board.innerHTML = out.join('');
}

function renderPalette() {
  const lv = L();
  if (lv.type !== 'color') {
    el.palette.hidden = true;
    el.palette.innerHTML = '';
    return;
  }

  el.palette.hidden = false;
  el.palette.innerHTML = COLORS.map((color, i) => {
    const active = i === selectedColor;
    return `<button type="button" class="swatch${active ? ' is-active' : ''}" data-color="${i}"` +
           ` style="--swatch:${color.value}" aria-pressed="${active}">` +
           `<i class="swatch-mark">${color.symbol}</i>${color.name}<kbd>${i + 1}</kbd></button>`;
  }).join('');
}

function renderLegend() {
  const lv = L();

  if (lv.type === 'color') {
    el.legend.innerHTML =
      '<span class="legend-item"><i class="legend-swatch"></i>未涂色</span>' +
      '<span class="legend-item"><i class="legend-swatch legend-conflict"></i>相邻同色</span>';
  } else if (lv.type === 'defend') {
    el.legend.innerHTML =
      '<span class="legend-item"><i class="legend-line"></i>原有线路</span>' +
      '<span class="legend-item"><i class="legend-line legend-new"></i>新线路</span>' +
      '<span class="legend-item"><i class="legend-line legend-fail"></i>失效线路</span>';
  } else {
    el.legend.innerHTML =
      '<span class="legend-item"><i class="legend-line"></i>线路</span>' +
      '<span class="legend-item"><i class="legend-line legend-cut"></i>已切断</span>';
  }
}

function renderControls() {
  el.undo.disabled = !(phase === 'playing' && history.length > 0);
  el.reset.disabled = false;
}

/* ------------------------------------------------------------ 9. 任务卡片 */

function setStatus(text, kind = '') {
  el.liveStatus.textContent = text;
  el.liveStatus.className = kind;
}

function setPrimary(label, handler) {
  el.primary.hidden = false;
  el.primary.textContent = label;
  el.primary.onclick = handler;
}

function hidePrimary() {
  el.primary.hidden = true;
  el.primary.onclick = null;
}

function renderMission() {
  const lv = L();

  el.chapter.textContent = lv.chapter;
  el.levelNumber.textContent = pad2(lv.id);
  el.boardCaption.textContent = isColorLevel() ? '街区地图 / MAP' : '网络拓扑 / NETWORK';
  el.boardCode.textContent = 'EXPERIMENT ' + pad2(lv.id);

  if (phase === 'success') {
    const last = currentLevel === LEVELS.length - 1;
    const all = completedLevels.length === LEVELS.length;

    el.missionContent.innerHTML =
      '<p class="eyebrow eyebrow-ok">✓ EXPERIMENT COMPLETE</p>' +
      '<h2 class="mission-title">漂亮，实验成功。</h2>' +
      '<p class="story">你刚刚发现了</p>' +
      `<p class="concept">${lv.concept}</p>` +
      `<p class="story">${lv.explanation}</p>` +
      (all ? '<p class="story" style="margin-top:10px">六个实验全部完成，发现手册已经写满。</p>' : '');

    setStatus('✓ 达成通关条件', 'ok');
    setPrimary(last ? '打开发现手册' : '下一个实验 →', last ? openNotebook : goNextLevel);
    el.quietNote.textContent = last ? '也可以在下方重玩任意一关。' : '新的实验已经解锁。';
    return;
  }

  const blocks =
    '<div class="mission-block"><h3>通关条件</h3>' +
    `<p>${lv.goal}</p></div>` +
    '<div class="mission-block"><h3>操作说明</h3>' +
    `<p>${lv.help}</p></div>`;

  if (phase === 'intro') {
    el.missionContent.innerHTML =
      `<p class="eyebrow">${lv.chapter}</p>` +
      `<h2 class="mission-title">${lv.name}</h2>` +
      `<p class="story">${lv.story}</p>` +
      blocks;

    setStatus('');
    setPrimary('开始实验', startPlaying);
    el.quietNote.textContent = '先看清目标，再动手。';
    return;
  }

  /* playing */
  el.missionContent.innerHTML =
    `<p class="eyebrow">${lv.name}</p>` + blocks;

  if (lv.type === 'defend') setPrimary('运行故障测试', runFaultTest);
  else hidePrimary();

  el.quietNote.textContent = '键盘：Tab 选择 · 回车执行 · U 撤销 · R 重来';
}

/* --------------------------------------------------------------- 10. 交互 */

function saveSnapshot() {
  history.push({
    removedEdges: [...removedEdges],
    removedNodes: [...removedNodes],
    addedEdges: addedEdges.map(edge => [...edge]),
    colors: [...colors]
  });
}

function startLevel(index) {
  if (index < 0 || index >= LEVELS.length) return;
  if (!isUnlocked(index)) return;

  currentLevel = index;
  phase = 'intro';

  removedEdges = [];
  removedNodes = [];
  addedEdges = [];
  history = [];
  testFailures = [];
  pendingNode = null;
  selectedColor = 0;

  const lv = L();
  colors = lv.type === 'color' ? new Array(lv.regions.length).fill(null) : [];
  conflictBorders = [];

  renderAll();

  if (typeof el.board.focus === 'function') el.board.focus({ preventScroll: true });
}

function startPlaying() {
  if (phase !== 'intro') return;
  phase = 'playing';
  renderMission();
  renderBoard();
  renderPalette();
  renderControls();

  if (isColorLevel()) {
    setStatus('选择一种颜色，然后点击区域。');
  } else {
    setStatus('');
  }
  el.quietNote.textContent = '键盘：Tab 选择 · 回车执行 · U 撤销 · R 重来';
}

function goNextLevel() {
  const next = currentLevel + 1;
  if (next < LEVELS.length) startLevel(next);
  else openNotebook();
}

/* ---- 网络关：点击线路 ---- */

function handleEdgeClick(edgeIndex) {
  if (phase !== 'playing') return;
  const lv = L();
  if (lv.type !== 'edge-cut') return;

  if (has(removedEdges, edgeIndex)) {
    saveSnapshot();
    removedEdges = removedEdges.filter(i => i !== edgeIndex);
    renderBoard();
    renderControls();
    evaluateCut();
    return;
  }

  if (removedEdges.length >= lv.limit) {
    setStatus(`最多只能切断 ${lv.limit} 条线路，先撤销一条。`, 'warn');
    return;
  }

  saveSnapshot();
  removedEdges.push(edgeIndex);
  renderBoard();
  renderControls();
  evaluateCut();
}

/* ---- 网络关：点击服务器 ---- */

function handleNodeClick(nodeIndex) {
  if (phase !== 'playing') return;
  const lv = L();

  if (lv.type === 'node-cut') {
    if (has(removedNodes, nodeIndex)) {
      saveSnapshot();
      removedNodes = removedNodes.filter(i => i !== nodeIndex);
      renderBoard();
      renderControls();
      evaluateCut();
      return;
    }
    if (removedNodes.length >= lv.limit) {
      setStatus(`最多只能关闭 ${lv.limit} 台服务器，先撤销一次。`, 'warn');
      return;
    }
    saveSnapshot();
    removedNodes.push(nodeIndex);
    renderBoard();
    renderControls();
    evaluateCut();
    return;
  }

  if (lv.type === 'defend') {
    pickDefendNode(nodeIndex);
  }
}

function pickDefendNode(nodeIndex) {
  const lv = L();

  if (pendingNode === null) {
    pendingNode = nodeIndex;
    setStatus(`已选中服务器 ${nodeIndex + 1}，再选一台来铺设新线路。`);
    renderBoard();
    return;
  }

  if (pendingNode === nodeIndex) {
    pendingNode = null;
    setStatus('已取消选择。');
    renderBoard();
    return;
  }

  if (edgeExists(lv.edges, pendingNode, nodeIndex) || edgeExists(addedEdges, pendingNode, nodeIndex)) {
    setStatus('这两台服务器已经直接相连了，换一对试试。', 'error');
    return;
  }

  saveSnapshot();
  if (addedEdges.length >= lv.limit) addedEdges = [];
  addedEdges.push([pendingNode, nodeIndex]);
  const pair = `${pendingNode + 1} 和 ${nodeIndex + 1}`;

  pendingNode = null;
  testFailures = [];
  renderBoard();
  renderControls();
  setStatus(`已在 ${pair} 之间铺好新线路，运行故障测试看看。`);
}

/* ---- 网络关：判定 ---- */

function evaluateCut() {
  const lv = L();
  const edges = allEdgesNow();
  const components = countComponents(lv.nodes, edges, removedNodes);
  const used = lv.type === 'node-cut' ? removedNodes.length : removedEdges.length;

  if (components >= 2) {
    succeed();
    return;
  }

  if (used >= lv.limit) {
    setStatus('网络仍然连通。', 'error');
    el.quietNote.textContent = '可以撤销，再换一条试试。';
    return;
  }

  setStatus(lv.type === 'node-cut'
    ? `已关闭 ${used} / ${lv.limit} 台服务器。`
    : `已切断 ${used} / ${lv.limit} 条线路。`);
}

function runFaultTest() {
  if (phase !== 'playing') return;
  const lv = L();
  const allEdges = allEdgesNow();

  if (!allEdges.length) return;

  if (countComponents(lv.nodes, allEdges) > 1) {
    setStatus('网络现在就是断开的，先撤销。', 'error');
    return;
  }

  const failures = [];
  for (let i = 0; i < allEdges.length; i++) {
    const copiedEdges = allEdges.filter((_, index) => index !== i);
    if (countComponents(lv.nodes, copiedEdges) > 1) failures.push(i);
  }

  testFailures = failures;
  renderBoard();

  if (!failures.length) {
    succeed();
    return;
  }

  setStatus('故障测试失败：切断高亮的线路后，网络分成了两组。', 'error');
  el.quietNote.textContent = addedEdges.length
    ? '换一对服务器，让脆弱的线路也进入一个环。'
    : '先用两台服务器铺一条新线路。';
}

/* ---- 着色关 ---- */

function handleRegionClick(regionIndex) {
  if (phase !== 'playing' || !isColorLevel()) return;

  saveSnapshot();
  colors[regionIndex] = (colors[regionIndex] === selectedColor) ? null : selectedColor;
  renderControls();
  renderBoard();
  renderPalette();
  evaluateColors();
}

function selectColor(index) {
  if (!isColorLevel()) return;
  if (index < 0 || index >= COLORS.length) return;
  selectedColor = index;
  renderPalette();
  setStatus(`已选择「${COLORS[index].name}」，点击区域涂色。`);
}

function evaluateColors() {
  const lv = L();
  conflictBorders = findColorConflicts(colors, lv.adjacency);
  renderBoard();

  const total = colors.length;
  const painted = colors.filter(c => c !== null && c !== undefined).length;
  const used = new Set(colors.filter(c => c !== null && c !== undefined)).size;

  if (!painted) {
    setStatus('选择一种颜色，然后点击区域。');
    return;
  }

  if (conflictBorders.length) {
    setStatus(`有 ${conflictBorders.length} 处相邻同色。`, 'error');
    return;
  }

  if (used > lv.limit) {
    setStatus(`已经用掉 ${used} 种颜色，超过了 ${lv.limit} 色上限。`, 'error');
    return;
  }

  if (painted < total) {
    setStatus(`已涂 ${painted} / ${total} 个区域。`);
    return;
  }

  succeed();
}

/* ---- 通关 / 撤销 / 重来 ---- */

function succeed() {
  const lv = L();
  phase = 'success';

  if (!has(completedLevels, lv.id)) {
    completedLevels.push(lv.id);
    completedLevels.sort((a, b) => a - b);
    saveProgress();
  }

  renderNav();
  renderProgress();
  renderNotebook();
  renderMission();
  renderBoard();
  renderControls();
  renderPalette();
}

function undo() {
  if (phase !== 'playing' || !history.length) return;

  const snapshot = history.pop();
  removedEdges = [...snapshot.removedEdges];
  removedNodes = [...snapshot.removedNodes];
  addedEdges = snapshot.addedEdges.map(edge => [...edge]);
  colors = [...snapshot.colors];
  testFailures = [];
  pendingNode = null;

  renderBoard();
  renderPalette();
  renderControls();

  if (isColorLevel()) {
    conflictBorders = findColorConflicts(colors, L().adjacency);
    renderBoard();
    const painted = colors.filter(c => c !== null && c !== undefined).length;
    setStatus(painted ? `已涂 ${painted} / ${colors.length} 个区域。` : '选择一种颜色，然后点击区域。');
    return;
  }

  if (L().type === 'defend') {
    setStatus('已撤销一步。');
    return;
  }

  const lv = L();
  const used = lv.type === 'node-cut' ? removedNodes.length : removedEdges.length;
  setStatus(used ? `已处理 ${used} / ${lv.limit}。` : '');
}

function resetLevel() {
  removedEdges = [];
  removedNodes = [];
  addedEdges = [];
  history = [];
  testFailures = [];
  pendingNode = null;
  conflictBorders = [];

  const lv = L();
  colors = lv.type === 'color' ? new Array(lv.regions.length).fill(null) : [];

  if (phase === 'success') phase = 'playing';

  renderBoard();
  renderPalette();
  renderControls();

  if (phase === 'playing') {
    setStatus(isColorLevel() ? '选择一种颜色，然后点击区域。' : '');
    el.quietNote.textContent = '键盘：Tab 选择 · 回车执行 · U 撤销 · R 重来';
  }
}

/* ---- 发现手册 ---- */

function renderNotebook() {
  el.notebookEntries.innerHTML = LEVELS.map(lv => {
    const found = has(completedLevels, lv.id);
    return `<article class="note${found ? ' is-found' : ''}">` +
      `<header><span class="note-num">${pad2(lv.id)}</span>` +
      `<h3>${found ? lv.name : '尚未发现'}</h3>` +
      `${found ? '<span class="note-check">✓</span>' : ''}</header>` +
      (found
        ? `<p class="note-concept">${lv.concept}</p><p class="note-body">${lv.explanation}</p>`
        : '<p class="note-body">完成这个实验后，你的发现会写在这里。</p>') +
      '</article>';
  }).join('');

  el.replayAll.hidden = completedLevels.length < LEVELS.length;
}

function openNotebook() {
  renderNotebook();
  if (typeof el.notebook.showModal === 'function') {
    if (!el.notebook.open) el.notebook.showModal();
  } else {
    el.notebook.setAttribute('open', '');
  }
}

function closeNotebook() {
  if (typeof el.notebook.close === 'function') el.notebook.close();
  else el.notebook.removeAttribute('open');
}

function replayAll() {
  const ok = typeof window.confirm !== 'function' ||
    window.confirm('清空发现手册，并从第一个实验重新开始？');
  if (!ok) return;

  completedLevels = [];
  saveProgress();
  closeNotebook();
  renderNotebook();
  renderProgress();
  startLevel(0);
}

/* ---- 键盘 ---- */

function moveFocus(key) {
  if (typeof el.board.querySelectorAll !== 'function') return;
  const items = Array.prototype.slice.call(
    el.board.querySelectorAll('[data-edge], [data-node], [data-region]')
  );
  if (!items.length) return;

  const current = items.indexOf(document.activeElement);
  let next = current;

  if (key === 'Home') next = 0;
  else if (key === 'End') next = items.length - 1;
  else if (key === 'ArrowRight' || key === 'ArrowDown') next = (current + 1 + items.length) % items.length;
  else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (current - 1 + items.length) % items.length;

  if (next !== current || current === -1) items[next < 0 ? 0 : next].focus();
}

function activateTarget(target) {
  if (!target || typeof target.getAttribute !== 'function') return false;

  const e = target.getAttribute('data-edge');
  const n = target.getAttribute('data-node');
  const r = target.getAttribute('data-region');

  if (e !== null) { handleEdgeClick(Number(e)); return true; }
  if (n !== null) { handleNodeClick(Number(n)); return true; }
  if (r !== null) { handleRegionClick(Number(r)); return true; }
  return false;
}

function bindEvents() {
  el.board.addEventListener('click', event => {
    activateTarget(event.target);
  });

  el.board.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      if (activateTarget(event.target)) event.preventDefault();
      return;
    }
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(event.key) !== -1) {
      event.preventDefault();
      moveFocus(event.key);
    }
  });

  el.levelNav.addEventListener('click', event => {
    const chip = event.target.closest ? event.target.closest('[data-level]') : null;
    if (!chip) return;
    const index = Number(chip.getAttribute('data-level'));
    if (!isUnlocked(index)) return;
    startLevel(index);
  });

  el.palette.addEventListener('click', event => {
    const swatch = event.target.closest ? event.target.closest('[data-color]') : null;
    if (!swatch) return;
    selectColor(Number(swatch.getAttribute('data-color')));
  });

  el.undo.addEventListener('click', undo);
  el.reset.addEventListener('click', resetLevel);
  el.openNotebook.addEventListener('click', openNotebook);
  el.closeNotebook.addEventListener('click', closeNotebook);
  el.replayAll.addEventListener('click', replayAll);

  if (typeof el.notebook.addEventListener === 'function') {
    el.notebook.addEventListener('click', event => {
      if (event.target === el.notebook) closeNotebook();
    });
  }

  document.addEventListener('keydown', event => {
    const tag = (event.target && event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    const key = event.key;

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (key === 'u' || key === 'U') { undo(); return; }
    if (key === 'r' || key === 'R') { resetLevel(); return; }
    if (isColorLevel() && '1234'.indexOf(key) !== -1) {
      selectColor(Number(key) - 1);
    }
  });
}

/* --------------------------------------------------------------- 11. 启动 */

function init() {
  loadProgress();
  bindEvents();
  startLevel(0);
}

init();

/* 便于调试与自动化测试：把纯函数挂到 window 上（不影响玩法）。 */
if (typeof window !== 'undefined') {
  window.LINK = {
    /* 只读：数据与纯函数 */
    LEVELS,
    COLORS,
    countComponents,
    isBridge,
    isArticulationPoint,
    networkIsResilient,
    findColorConflicts,
    allEdgesNow,
    getState: () => ({
      currentLevel, phase, removedEdges, removedNodes, addedEdges, colors, history, completedLevels
    }),
    /* 调试：可直接跳到某关或驱动一次操作 */
    startLevel,
    debug: {
      startPlaying,
      handleEdgeClick,
      handleNodeClick,
      handleRegionClick,
      selectColor,
      runFaultTest,
      undo,
      resetLevel
    }
  };
}
