# LINK · 关系实验室

一个可以离线打开的**图论教学小游戏原型**。六个小谜题，让你先动手、再发现，最后才给这个想法起名字。

- 纯原生 **HTML + CSS + JavaScript**，零依赖、零构建、零网络请求
- 棋盘用 **SVG** 绘制（不是 Canvas），节点、线路、区域都可以直接点击
- 无倒计时、失败不扣生命、随时撤销、随时重来、进度自动保存

---

## 怎么打开

直接双击 `index.html` 用浏览器打开即可（推荐 Chrome / Edge / Firefox / Safari 的较新版本）。

如果浏览器在 `file://` 下限制了 localStorage，进度只会当次有效，游戏其他部分完全正常。想保证进度保存，可以用任意静态服务器打开：

```bash
# 任选一种，在项目目录里执行
python -m http.server 8000
npx serve .
```

然后访问 `http://localhost:8000/`。

---

## 文件结构

```
.
├── index.html     页面结构（顶栏 / 进度 / 关卡导航 / 棋盘 / 任务卡片 / 发现手册）
├── style.css      深色实验室仪表盘样式、SVG 元素样式、响应式与无障碍
├── game.js        关卡数据 + 图算法 + 渲染 + 交互 + 进度存储
└── README.md      本文件
```

---

## 六个实验

| # | 名称 | 章节 | 玩法类型 | 玩家的发现 |
|---|------|------|----------|-----------|
| 01 | 一线之隔 | 01 / 断开连接 | `edge-cut` 切断线路 | **桥** |
| 02 | 关键人物 | 01 / 断开连接 | `node-cut` 关闭服务器 | **割点** |
| 03 | 备用路线 | 01 / 断开连接 | `edge-cut` 切断 2 条 | **环与冗余路径** |
| 04 | 最后的保险 | 02 / 守护连接 | `defend` 新增 1 条线路 | **让桥进入环** |
| 05 | 五色街区？ | 03 / 分配颜色 | `color` 地图着色（3 色上限） | **图着色 · 奇环** |
| 06 | 中央公园 | 03 / 分配颜色 | `color` 地图着色（4 色上限） | **图着色 · 完全图** |

每关流程固定为 **OBSERVE → EXPERIMENT → DISCOVER**：先看通关条件，再动手试，通关后右侧卡片才写出概念名字与解释，并写入「发现手册」。

### 关卡设计要点

- **01** 三角形 + 桥 + 三角形。切掉三角形里的任意一条线，网络仍然连通；只有切掉那条唯一的通路，网络才会分成两组。
- **02** 中间那台服务器是两边唯一的交集，关掉它网络就散成两半。
- **03** 六个节点围成一圈。切一条不够（还能绕行），必须在「相隔较远」的两处各切一条才会断开。
- **04** 网络里存在一条脆弱连接，只加一条新线要让它进入一个环，这样任意一条线断开后消息都还能绕行。
- **05** 五个街区围成一环（奇环）。两色交替涂到最后会撞色，必须启用第三色。
- **06** 四个区域两两相邻（K4），四块地必须四种颜色。

---

## 操作与快捷键

| 操作 | 方式 |
|------|------|
| 选择 / 切断线路 | 点击线路（着色关无此操作） |
| 关闭 / 恢复服务器 | 点击服务器（再点一次可恢复） |
| 铺设新线路（04 关） | 依次点击两台服务器，再点「运行故障测试」 |
| 涂色（05 / 06 关） | 先点调色板选颜色，再点区域；同色再点一次可清除 |
| 撤销 | 点「↶ 撤销」或按 `U` / `Ctrl+Z` |
| 重来 | 点「↻ 重来」或按 `R` |
| 切换关卡 | 点击关卡导航（未解锁的关卡不可点） |
| 键盘操作棋盘 | `Tab` 聚焦元素 → 方向键在元素间移动 → `Enter` / `空格` 执行 |
| 快速选色 | `1` `2` `3` `4` |

---

## 反馈原则（不剧透）

- 不在操作前标出答案：不给可疑边着色、不显示「答案在这里」、不自动演示最优解
- 线路切断后只表现为虚线断开，不会预告它是不是桥
- 只在**失败之后**才提示「网络仍然连通。」
- 着色冲突时**只标红相邻同色的那条边界**，不指出该改成什么颜色
- 防御关卡只有在玩家点了「运行故障测试」之后，才把失效线路标红

---

## 进度存储

- 存储介质：`localStorage`
- 键名：`link-lab-progress`
- 值：已完成关卡的编号数组，例如 `[1,2,3]`
- 解锁规则：第 1 关始终可玩；完成第 N 关后解锁第 N+1 关；已完成的关卡可以随时重玩
- 「发现手册」里集齐 6 条发现后，会出现「从第一关再玩一次」，会清空进度并重新开始

---

## 代码结构（game.js）

```
1. 关卡数据 LEVELS        —— 节点坐标、边、通关条件、概念与解释
2. 颜色数据 COLORS        —— 四种颜色的名称、色值、符号
3. 运行时状态             —— currentLevel / phase / removedEdges / removedNodes
                             / addedEdges / colors / history / completedLevels
4. DOM 引用与工具         —— $ / pad2 / L / isColorLevel
5. 图算法                 —— countComponents / isBridge / isArticulationPoint
                             / networkIsResilient / findColorConflicts / allEdgesNow
6. 进度存储               —— loadProgress / saveProgress / isUnlocked
7. 街区几何               —— polar / sectorPath / colorGeometry
8. 渲染                   —— renderNav / renderBoard / renderPalette / renderLegend
9. 任务卡片               —— renderMission / setStatus / setPrimary
10. 交互                  —— handleEdgeClick / handleNodeClick / handleRegionClick
                             / runFaultTest / evaluateCut / evaluateColors
                             / succeed / undo / resetLevel / saveSnapshot
11. 启动                  —— init()
```

### 核心算法

**连通分量**（BFS/DFS，可用 `removedNodes` 暂时移走若干节点）：

```js
function countComponents(nodes, edges, removedNodes = []) { /* ... */ }
```

**桥**：临时移除某条边，看网络是否被拆开。

```js
function isBridge(edgeIndex) {
  const copiedEdges = edges.filter((_, index) => index !== edgeIndex);
  return countComponents(nodes, copiedEdges) > 1;
}
```

**割点**：临时关闭某个节点，看网络是否被拆开。

```js
function isArticulationPoint(nodeIndex) {
  const remainingNodes = nodes.filter((_, index) => index !== nodeIndex);
  const remainingEdges = edges.filter(([a, b]) => a !== nodeIndex && b !== nodeIndex);
  return countComponents(remainingNodes, remainingEdges) > 1;
}
```

> 说明：`game.js` 里的实现直接用 `countComponents(nodes, edges, [nodeIndex])`，避免先过滤节点导致下标整体前移。

**网络韧性**：逐条模拟删除每一条边，只要有一次断开就不算韧性网络。

```js
function networkIsResilient() {
  for (let i = 0; i < allEdges.length; i++) {
    const copiedEdges = allEdges.filter((_, index) => index !== i);
    if (countComponents(nodes, copiedEdges) > 1) return false;
  }
  return true;
}
```

**着色冲突**：

```js
function findColorConflicts(colors, adjacency) {
  return adjacency.filter(([a, b]) => colors[a] !== null && colors[a] === colors[b]);
}
```

通关判定：

```js
const allPainted  = colors.every(color => color !== null);
const noConflict  = findColorConflicts(colors, adjacency).length === 0;
const withinLimit = new Set(colors).size <= level.limit;
const success     = allPainted && noConflict && withinLimit;
```

**撤销**：每次改动前保存完整快照。

```js
function saveSnapshot() {
  history.push({
    removedEdges: [...removedEdges],
    removedNodes: [...removedNodes],
    addedEdges: addedEdges.map(edge => [...edge]),
    colors: [...colors]
  });
}
```

---

## 无障碍与移动端

- 顶部有「跳到关卡操作」的 skip link，可直接跳到任务卡片
- 棋盘元素带 `role="button"` 与中文 `aria-label`，支持 `Tab` / 方向键 / `Enter`
- `#live-status` 是 `aria-live="polite"` 区域，状态变化会被读屏播报
- 键盘焦点有可见的描边（`:focus-visible`）
- 尊重 `prefers-reduced-motion`，会关闭过渡动画
- 宽度 ≤ 1060px 时任务卡片移到棋盘下方；≤ 680px 时压缩顶栏与页脚，按钮变为等宽

---

## 调试接口

`game.js` 末尾把纯函数挂在了 `window.LINK` 上（只读用途，不影响玩法），方便在控制台里验证：

```js
LINK.countComponents(LINK.LEVELS[0].nodes, LINK.LEVELS[0].edges)  // 1
LINK.isBridge(3)                                                   // true —— 第 1 关的桥
LINK.getState()                                                    // 当前完整状态
```

---

## 已知限制

- `file://` 下部分浏览器会限制 `localStorage`，此时进度不跨会话保留
- 街区地图是游戏化的示意布局，用来表达「谁和谁相邻」，不是真实地理边界
- 界面语言为中文，暂未做 i18n
