import { createElement, icons } from "lucide";
import { chapters, levels, levelById, units } from "./levels.mjs";
import { fresh, normalize, unlocked } from "./progress.mjs";
import { GameSession } from "./session.mjs";
import { evaluate, algorithmReplay } from "./engine.mjs";
import { graphBoard, regionBoard, netBoard, floydTable, timeline, condensedBoard, distanceTable } from "./board.mjs";
import { SolidView } from "./solid-view.mjs";
import { solids } from "./solids.mjs";
import { palette, paletteText, colorNames } from "./assets.mjs";
import { drawCity } from "./city.mjs";
import { captureUI, animateUI, syncMotion, dismissDialog, renderUI } from './ui-motion.mjs';
import {pathCost,criticalSchedule,floydStages,groups} from './algorithms.mjs';
import {assetManifest,chapterSceneKeys} from './assets.mjs';
import { syncAvailable, createSync } from './sync/index.mjs';
const availableAssets=typeof __ASSET_FILES__==='undefined'?[]:__ASSET_FILES__;
const loadedAssets=Object.fromEntries(availableAssets.map(id=>[id,assetManifest[id].path]));
const app = document.querySelector("#app");
const sessionCache=new Map();
// 云同步：网页版读档、存档都经过同步层（见 docs/协作约定-存档与云同步.md 第六部分）；桌面版不创建，保持离线
// 浏览器禁用站点数据时访问 localStorage 会抛错：这时不启用同步，游戏照原样运行（只是存不了档）
const sync=(()=>{try{return syncAvailable()?createSync():null;}catch{return null;}})();
const st = { screen: "home", chapter: 1, levelId: null, progress: fresh(), session: null, modal: null, player: null, timer: null, solid: null, net: false, tool: 0, target: 0, fault: "mark", probe: null, adjacency: false, speed: 1, saveMeta: {}, campaignTab:'main', selectedMission:null };
const icon = (name, size = 16) => createElement(icons[name] || icons.Circle, { width: size, height: size, "aria-hidden": "true" }).outerHTML;
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const l = () => levelById[st.levelId], r = () => st.progress.records[st.levelId] ?? {}, s = () => st.session?.state;
const viewState = () => st.player?.mode === 'replay' ? { ...st.player.state, ...st.player.frames[st.player.index]?.state } : s();
const typeLabel = (x) => ({reach:'找相通设施',groups:'分区标记',dfs:'巡检路线',broadcast:'传播预测',forest:'保留线路',scc:'互达分组',euler:'线路巡运',shortest:'路线规划',routes:'多份运单',floyd:'中转比较',postman:'闭环巡运',mst:'建设线路',topo:'工序排序',cycle:'找出循环',schedule:'安排加速',color:'区域上色',solid:'立体上色',matching:'岗位安排',fault:'故障测试',isolation:'隔离设备',cut:'停线断开',reinforce:'线路加固'}[x.type]??'图上操作');
const controlDetail = () => `<svg class="tw-control-detail" viewBox="0 0 48 36" aria-hidden="true" focusable="false"><path class="detail-plate" d="M20 2H46V22H34V34H8V24H20Z"/><path class="detail-track" d="M3 30H16V18H29V6H44M8 35H21V23H34V11H47"/><path class="detail-flow" pathLength="100" d="M3 30H16V18H29V6H44"/><circle class="detail-cap" cx="29" cy="6" r="2"/></svg>`;
const btn = (action2, text, ico = "", cls = "", extra = "") => `<button class="tw-btn ${cls}" data-action="${action2}" ${extra}>${ico ? icon(ico) : ""}<span>${esc(text)}</span>${['settings','quit','fullscreen'].includes(action2)?'':controlDetail()}</button>`;
const ib = (action2, label, ico, extra = "") => `<button class="tw-icon" data-action="${action2}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${icon(ico)}</button>`;
const reduced = () => !st.progress.settings.motion || matchMedia("(prefers-reduced-motion: reduce)").matches;
let toastTimer, saveQueue = Promise.resolve();
let soundContext;
function tone(success=false){
  if(!st.progress.settings.sound)return;
  try{soundContext??=new AudioContext();soundContext.resume();const oscillator=soundContext.createOscillator(),gain=soundContext.createGain();oscillator.frequency.value=success?640:350;gain.gain.setValueAtTime(st.progress.settings.volume*.07,soundContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,soundContext.currentTime+.13);oscillator.connect(gain);gain.connect(soundContext.destination);oscillator.start();oscillator.stop(soundContext.currentTime+.14);}catch{}
}
function toast(text) {
  let node = document.querySelector("#tw-toast");
  if (!node) {
    node = document.createElement("div");
    node.id = "tw-toast";
    document.body.append(node);
  }
  node.textContent = text;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3200);
}
function save() {
  const data = structuredClone(st.progress);
  saveQueue = saveQueue.then(async () => {
    try {
      if (window.tideweave) await window.tideweave.save(data);
      else if (sync) sync.save(data); // 照旧先写本机 localStorage，再由同步层在后台推送
      else localStorage.setItem("tideweave-progress", JSON.stringify(data));
      st.saveFailed=false;
    } catch (e) {
      st.saveFailed=true;
      toast("保存失败，请导出备份。");
    }
  });
  return saveQueue;
}
function stop() {
  clearTimeout(st.timer);
  st.timer = null;
  st.player = null;
}
function passed(id) {
  return !!st.progress.records[id]?.passed;
}
function unlock(id) {
  return unlocked(st.progress, levelById[id]);
}
function chapterDone(id) {
  return levels.filter((x) => x.chapter === id && !x.optional).every((x) => passed(x.id));
}
function header() {
  return `<header class="tw-header"><button class="tw-brand" data-action="title-home"><span class="tw-seal">脉</span><span><b>脉序</b><small>TIDEWEAVE</small></span></button><span class="tw-context">澜州联运区 <i>/</i> 联运调度署</span><div class="tw-header-actions">${ib("journal", "筹算回放", "BookOpen")}${ib("sound", st.progress.settings.sound ? "关闭音效" : "开启音效", st.progress.settings.sound ? "Volume2" : "VolumeX")}${ib("settings", "设置", "Settings")}</div></header>`;
}
function campaignNext() {
  const last=levelById[st.progress.last];
  if(last && unlock(last.id) && !passed(last.id))return last;
  return levels.find(x=>!x.optional&&!passed(x.id)&&unlock(x.id))??last??levels[0];
}
function missionTrace(level) {
  const coords=level.nodes.map((n,i)=>[n.x??100+(i%4)*180,n.y??100+Math.floor(i/4)*180]);
  const xs=coords.map(p=>p[0]),ys=coords.map(p=>p[1]);
  const minX=Math.min(...xs),minY=Math.min(...ys),width=Math.max(...xs)-minX||1,height=Math.max(...ys)-minY||1;
  const points=coords.map(([x,y])=>[22+(x-minX)/width*236,20+(y-minY)/height*112]);
  return `<svg class="tw-mission-trace" viewBox="0 0 280 152" aria-hidden="true" focusable="false">${level.edges.map(e=>`<path d="M${points[e.a]} L${points[e.b]}"/>`).join('')}${points.map(([x,y],i)=>`<rect x="${x-5}" y="${y-5}" width="10" height="10" class="${i===0?'origin':''}"/>`).join('')}</svg>`;
}
function home() {
  const next=campaignNext(),ch=chapters.find(c=>c.id===next.chapter),started=Object.keys(st.progress.records).length>0;
  const done=levels.filter(x=>!x.optional&&passed(x.id)).length,total=levels.filter(x=>!x.optional).length;
  return `<main class="tw-home">${header()}<div class="tw-home-scene"><canvas id="tw-city" aria-label="澜州田畴与水利设施"></canvas></div>
    <section class="tw-home-title"><span class="tw-eyebrow">澜州 · 水网重启计划</span><h1>脉序</h1><p>TIDEWEAVE <span class="tw-home-subtitle">图论学习游戏</span></p><div class="tw-home-seal" aria-hidden="true">澜<br>州</div></section>
    <nav class="tw-home-menu" aria-label="游戏主菜单">
      <button class="tw-continue" data-action="resume"><span class="tw-menu-chapter"><small>CHAPTER</small><b>${String(ch.id).padStart(2,'0')}</b><span>${esc(ch.title)}</span>${missionTrace(next)}</span><span class="tw-continue-copy"><small class="tw-menu-state">${started?'接续进度':'准备就绪'}</small><strong>${started?'继续游戏':'开始游戏'}</strong><span>${esc(next.title)}</span><small>${next.id}</small></span><span class="tw-launch-arrow">${icon('ArrowUpRight',26)}</span></button>
      <button class="tw-menu-panel" data-action="campaign"><small>CHAPTERS / 0${chapters.length}</small><strong>章节选择</strong><span>${chapters.filter(c=>chapterDone(c.id)).length} / ${chapters.length} 章完成</span><span class="tw-menu-symbol">${icon('Route',64)}</span>${icon('ArrowUpRight',18)}</button>
      <button class="tw-menu-panel tw-menu-records" data-action="journal"><small>RECORDS</small><strong>通关回放</strong><span>${levels.filter(x=>st.progress.records[x.id]?.perfect).length} 枚徽记</span><span class="tw-menu-symbol">${icon('Layers3',64)}</span>${icon('ArrowUpRight',18)}</button>
      <div class="tw-home-options">${btn('settings','设置','Settings')}${window.tideweave?btn('quit','退出','LogOut'):btn('fullscreen','全屏','Maximize')}</div>
    </nav><footer class="tw-home-status"><span>澜州联运区 / 恢复进度 <b>${done} / ${total}</b></span><progress value="${done}" max="${total}" aria-label="主线完成进度"></progress><span data-sync-footer>${esc(syncFooter())}</span></footer></main>`;
}
function map() {
  const ch=chapters.find(x=>x.id===st.chapter),ls=levels.filter(x=>x.chapter===st.chapter),main=ls.filter(x=>!x.optional);
  const scene=loadedAssets[chapterSceneKeys[ch.id]];
  const done=main.filter(x=>passed(x.id)).length,side=st.campaignTab==='optional';
  const shown=ls.filter(x=>!!x.optional===side);
  let selected=shown.find(x=>x.id===st.selectedMission)??shown.find(x=>unlock(x.id)&&!passed(x.id))??shown[0];
  st.selectedMission=selected?.id;
  const lockReason=x=>x.optional&&!chapterDone(x.chapter)?'完成本章全部普通关卡后开放':`先完成：${x.requires.filter(id=>!passed(id)).map(id=>levelById[id].title).join('、')}`;
  const rows=units.filter(u=>u.chapter===st.chapter&&!!u.optional===side).map((unit,index)=>`
    <section class="tw-route-unit" data-unit="${unit.id}">
      <header><span>${String(index+1).padStart(2,'0')}</span><h2>${esc(unit.name)}</h2></header>
      <div class="tw-route-stops">${shown.filter(x=>x.unit===unit.id).map(x=>{
        const q=st.progress.records[x.id],available=unlock(x.id);
        return `<button class="tw-route-stop ${q?.passed?'passed':''} ${selected?.id===x.id?'active':''} ${!available?'locked':''}" data-select-level="${x.id}" aria-pressed="${selected?.id===x.id}" title="${available?esc(x.title):esc(lockReason(x))}"><span class="tw-route-symbol">${icon(!available?'Lock':q?.perfect?'Award':q?.passed?'Check':x.tutorial?'MousePointer2':'Flag',20)}</span><span><small>${x.id}</small><b>${esc(x.title)}</b></span></button>`;
      }).join('')}</div>
    </section>`).join('');
  const record=selected?st.progress.records[selected.id]:null;
  const detail=selected?`<aside class="tw-deployment" aria-label="所选关卡">
    <div class="tw-deployment-top"><span class="tw-eyebrow">${selected.optional?'EX / 选修挑战':'MAIN / 主线任务'}</span>${icon('Flag',20)}</div><div class="tw-deployment-identity"><div class="tw-deployment-code">${selected.id}</div>
    <h2>${esc(selected.title)}</h2><span class="tw-mission-status">${!unlock(selected.id)?'尚未开放':record?.legacy?'旧版已通关 · 新版可重玩':record?.perfect?'徽记已取得':record?.passed?'已通关':selected.tutorial?'操作入门':'待完成'}</span></div>
    <div class="tw-deployment-goal"><h3>本关目标</h3><p>${esc(selected.goal)}</p></div>
    ${selected.badge?`<div class="tw-deployment-badge">${icon('Award')}<span>徽记挑战<br><b>${esc(selected.badge)}</b></span></div>`:''}
    ${!unlock(selected.id)?`<p class="tw-lock-reason">${icon('Lock')}${esc(lockReason(selected))}</p>`:''}
    ${btn('deploy',record?.passed?'重新挑战':'进入关卡','ArrowRight','primary',`data-level="${selected.id}" ${unlock(selected.id)?'':'disabled'}`)}
    </aside>`:'<aside class="tw-deployment"><h2>本章没有选修任务</h2></aside>';
  return `<main class="tw-campaign">${header()}<div class="tw-campaign-heading"><div>${ib('title-home','返回主菜单','ArrowLeft')}<h1>章节选择</h1></div><span>${levels.filter(x=>st.progress.records[x.id]?.perfect).length} 枚徽记</span></div>
    <nav class="tw-chapters" aria-label="章节">${chapters.map(c=>`<button data-chapter="${c.id}" class="${c.id===st.chapter?'active':''}" aria-current="${c.id===st.chapter?'page':'false'}"><span class="tw-chapter-number">${String(c.id).padStart(2,'0')}</span><b>${esc(c.title)}</b><span class="tw-chapter-check">${chapterDone(c.id)?icon('Check',15):''}</span></button>`).join('')}</nav>
    <section class="tw-campaign-summary">${scene?`<img class="tw-campaign-scene" src="${esc(scene)}" alt="" aria-hidden="true" draggable="false"/>`:''}<span class="tw-chapter-watermark" aria-hidden="true">${String(ch.id).padStart(2,'0')}</span><div class="tw-chapter-copy"><span class="tw-eyebrow">${esc(ch.scene)}</span><h2>${esc(ch.title)}</h2><p>${esc(ch.purpose)}</p></div><div class="tw-campaign-completion"><b>${done}<small> / ${main.length}</small></b><span>普通关卡</span><progress value="${done}" max="${main.length}" aria-label="本章完成进度"></progress></div></section>
    <div class="tw-route-toolbar"><div class="tw-segment" role="group" aria-label="任务分类"><button data-campaign-tab="main" aria-pressed="${!side}" class="${side?'':'selected'}">${icon('Route')}主线</button><button data-campaign-tab="optional" aria-pressed="${side}" class="${side?'selected':''}" ${ls.some(x=>x.optional)?'':'disabled'}>${icon('Compass')}选修 <small>${ls.filter(x=>x.optional).length}</small></button></div>${chapterDone(ch.id)?btn('chapter-note','章节手记','BookOpen'):''}</div>
    <div class="tw-campaign-body"><section class="tw-route-map" aria-label="关卡路线">${rows}</section>${detail}</div></main>`;
}
function metric() {
  const x = l(), v = viewState();
  if(st.player?.mode === 'replay') return `${st.player.own ? '我的最佳方案' : st.player.result.algorithm ?? '参考方案'} · ${st.player.index + 1}/${st.player.frames.length}`;
  if (x.type === "mst") { const cost=v.selected.reduce((a,i)=>a+(x.edges[i]?.w??1),0), parts=groups(x,v.selected).length; return `造价 ${cost} / ${x.budget} · ${parts===1 ? "已全部接通" : `还分为 ${parts} 片`}`; }
  if (x.type === "reinforce") return `新增造价 ${v.selected.reduce((a,i)=>a+(x.edges[i]?.w??1),0)} / ${x.budget}`;
  if (x.type === "forest") return `${v.selected.length} 条线路 · 剩 ${groups(x,v.selected).length} 片网络`;
  if (["dfs", "euler", "shortest", "postman"].includes(x.type)) return `已规划 ${v.path.length - 1} 段${['shortest','postman'].includes(x.type)?' · 累计 '+pathCost(x,v.path):''}`;
  if (x.type === "routes") return `运单 ${st.target + 1}/${x.targets.length} · 总用时 ${v.routes.reduce((a,p)=>a+pathCost(x,p),0)}`;
  if (["color", "solid"].includes(x.type)) return `${v.colors.filter((c) => c >= 0).length}/${x.nodes.length} 已着色`;
  if (x.type === "schedule") return `加速 ${v.boosts.reduce((a, b) => a + b, 0)} / ${x.budget} · 工期 ${criticalSchedule(x,v.boosts).total} 天`;
  if (x.type === "topo") return `${v.order.length}/${x.nodes.length} 项工序`;
  if (["groups", "scc"].includes(x.type)) return `${v.labels.filter((x2) => x2 >= 0).length}/${x.nodes.length} 已分组`;
  if (x.type === "broadcast") return `发射站：${x.nodes[v.source].label}`;
  if (x.type === "cycle") {const closed=v.order.length>1&&v.order[0]===v.order.at(-1);return `已选 ${v.order.length-(closed?1:0)} 项 · ${closed?'已闭合':'未闭合'}`;}
  if (x.type === "floyd") return `已选 ${v.pairs.length} 组`;
  return `已标记 ${v.selected.length} 项`;
}
function metricOutput() {
  const x = l(), v = viewState();
  if (st.player?.mode === 'replay' || !['mst', 'reinforce'].includes(x.type)) return `<output aria-live="polite">${esc(metric())}</output>`;
  const cost = v.selected.reduce((sum, i) => sum + (x.edges[i]?.w ?? 1), 0);
  const parts = x.type === 'mst' ? groups(x, v.selected).length : null;
  return `<output class="tw-cost" aria-live="polite"><span class="tw-cost-label">${x.type === 'reinforce' ? '新增造价' : '造价'}</span><strong>${cost}</strong><span class="tw-cost-limit">/ ${x.budget}<small>预算</small></span>${parts === null ? '' : `<span class="tw-cost-status">${parts === 1 ? '已全部接通' : `还分为 ${parts} 片`}</span>`}</output>`;
}
function toolbar() {
  const x = l(), v = s();
  let out = "";
  if (["color", "solid", "groups", "scc"].includes(x.type)) out += `<div class="tw-swatches" aria-label="${x.type === "color" || x.type === "solid" ? "选择颜色" : "选择分组"}">${palette.map((c, i) => `<button class="tw-swatch ${st.tool === i ? "active" : ""}" data-tool="${i}" aria-label="${x.type === "color" || x.type === "solid" ? colorNames[i] : "分组 " + (i + 1)}" style="--swatch:${c};--swatch-ink:${paletteText[i]}">${i + 1}</button>`).join("")}</div>`;
  if (x.type === "routes") out += `<div class="tw-segment">${x.targets.map((n, i) => `<button data-target="${i}" class="${st.target === i ? "selected" : ""}">${esc(x.nodes[n].label)}</button>`).join("")}</div>`;
  if (x.type === "broadcast") out += `<div class="tw-predict"><span>预测轮次</span><button data-action="less">−</button><b>${v.prediction}</b><button data-action="more">+</button></div>`;
  if (x.type === "fault") out += `<div class="tw-segment"><button data-mode="mark" class="${st.fault === "mark" ? "selected" : ""}">标记</button><button data-mode="probe" class="${st.fault === "probe" ? "selected" : ""}">停用测试</button></div>${v.probe !== null ? btn("clear-probe", "恢复原图", "RotateCcw") : ""}`;
  if (x.type === "color") out += btn("adjacency", st.adjacency ? "隐藏共边关系" : "查看共边关系", "Network", st.adjacency ? "selected" : "");
  if (x.type === "solid") out += `<div class="tw-segment"><button data-action="solid" class="${!st.net ? "selected" : ""}">${icon("Box")} 立体</button><button data-action="net" class="${st.net ? "selected" : ""}">${icon("UnfoldHorizontal")} 展开图</button></div>${ib("reset-view", "复位视角", "RotateCcw")}${ib("unpainted", "定位未着色面", "ScanSearch")}`;
  if(x.type==='solid')out+=`<label class="tw-face">面 <select data-face aria-label="选择面">${solids[x.solid].labels.map((name,i)=>`<option value="${i}" ${(st.face??0)===i?'selected':''}>${name}</option>`).join('')}</select></label>${btn('paint-face','着色','Check')}${ib('adjacent','查看相邻面','Network')}`;
  return out;
}
function board() {
  const x = l(), v = viewState(), result = st.player ? null : st.session.result, frame = st.player?.frames[st.player.index];
  if(frame?.condensed) return condensedBoard(x, frame.condensed, loadedAssets);
  if (x.type === "solid" && !st.net && !st.webglFailed) return '<div id="tw-solid" class="tw-solid"></div>';
  if (x.type === "solid") return netBoard(x, v, result, loadedAssets);
  if (x.type === "color") return regionBoard(x, v, { result, adjacency: st.adjacency, images: loadedAssets });
  if (x.type === "floyd") return `<div class="tw-floyd-board"><div class="tw-transit-map"><p>直达道路 · 数字为直达用时</p>${graphBoard(x,v,{result,frame,images:loadedAssets})}</div><div class="tw-floyd"><p>${frame?.matrix ? esc(frame.caption) : `原可中转：${esc(x.nodes.slice(0,x.stage).map(n=>n.label).join('、')||'无')} → 新增：${esc(x.nodes[x.stage].label)}`}</p>${frame?.matrix ? distanceTable(x, frame.matrix) : floydTable(x, v)}</div></div>`;
  return graphBoard(x, v, { result, frame, target: st.target,images:loadedAssets });
}
function game() {
  const x = l(), v = viewState(), result = st.player ? null : st.session.result;
  const chapter = chapters.find(c => c.id === x.chapter);
  const scene = loadedAssets[chapterSceneKeys[x.chapter]];
  return `<main class="tw-game">
    <header class="tw-mission-head">
      ${ib("home", "返回任务地图", "ArrowLeft")}
      <div class="tw-mission-ident"><span class="tw-eyebrow">${esc(chapter.title)}</span><h1>${esc(x.title)}</h1></div><span class="tw-level-code">${x.id}</span>
      <div class="tw-header-actions">${ib("sound", st.progress.settings.sound ? "关闭音效" : "开启音效", st.progress.settings.sound ? "Volume2" : "VolumeX")}${ib("settings", "设置", "Settings")}</div>
    </header>
    <section class="tw-task"><div class="tw-task-copy"><div class="tw-goal-line"><span class="tw-task-kicker">通关目标</span><h2>${esc(x.goal)}</h2></div><div class="tw-control-line"><span>${icon('MousePointer2')}操作</span><p>${esc(x.controls)}</p></div></div>
      ${x.badge ? `<aside>${icon("Award")}<span>额外挑战<br><b>${esc(x.badge)}</b></span></aside>` : ""}
    </section>
    <div class="tw-context-tools ${toolbar()?'':'status-only'}">${toolbar()}${metricOutput()}</div>
    <section class="tw-board ${x.type === "solid" ? "solid-board" : ""}${scene ? ' has-chapter-scene' : ''}">${scene ? `<img class="tw-chapter-scene" src="${esc(scene)}" alt="" aria-hidden="true" draggable="false"/>` : ''}<div class="tw-board-frame" aria-hidden="true"><i class="frame-corner nw"></i><i class="frame-corner ne"></i><i class="frame-corner sw"></i><i class="frame-corner se"></i><i class="frame-register"></i></div>${board()}${x.type === "schedule" ? timeline(x, v) : ""}</section>
    ${st.player ? playback() : `<div class="tw-feedback" aria-live="polite">${result ? `${icon(result.pass ? "Check" : "Info")}<span class="${result.pass ? "good" : "warn"}">${esc(result.message)}</span>` : ""}</div>`}
    <footer class="tw-operation"><div>
      ${ib("undo", "撤销", "Undo2", st.session.history.length ? "" : "disabled")}${ib("redo", "重做", "Redo2", st.session.future.length ? "" : "disabled")}${ib("reset", "重置方案", "RotateCcw")}
      ${btn("rules", "完整规则", "CircleHelp")}${r().hintUnlocked ? ib("hint", "策略提示", "Lightbulb") : ""}
    </div><div>${r().passed ? ib("replay", "查看回放", "BookOpen") : ""}${btn(st.player ? "edit" : "run", st.player ? "返回编辑" : "运行检查", st.player ? "ArrowLeft" : "Play", "primary")}</div></footer>
  </main>`;
}
function playback() {
  const p = st.player;
  const comparison = p.mode === 'replay' && !r().best ? '<small>旧版成绩已保留 · 当前展示新版参考方案</small>' : p.mode === 'replay' ? `${ib('compare-replay', p.own ? '查看筹算方案' : '查看我的最佳方案', 'ArrowLeftRight')}<small>我的最佳 ${p.bestMetric} · 参考 ${p.referenceMetric} ${esc(p.result.unit)}</small>` : '';
  return `<section class="tw-playback"><div>${ib("prev-frame", "上一步", "ChevronLeft", p.index ? "" : "disabled")}${ib("pause", p.paused ? "播放" : "暂停", p.paused ? "Play" : "Pause")}${ib("next-frame", "下一步", "ChevronRight")}${ib("skip", "跳过回放", "SkipForward")}</div><input data-frame type="range" min="0" max="${p.frames.length - 1}" value="${p.index}" aria-label="回放步骤"/><span>${esc(p.frames[p.index]?.caption)}</span>${comparison}</section>`;
}
function dialog() {
  if (!st.modal) return "";
  const x = l(), result = st.session?.result;
  let body = "";
  if (st.modal === "rules") body = `<span class="tw-eyebrow">${esc(typeLabel(x))} / ${x.id}</span><h2>本关规则</h2><h3>怎样算通关</h3><p>${esc(x.goal)}。</p><h3>怎样操作</h3><p>${esc(x.controls)}</p><h3>还需要知道</h3><ul>${x.rules.map(rule=>`<li>${esc(rule)}</li>`).join('')}</ul>${x.badge ? `<p class="tw-insight">额外挑战：${esc(x.badge)}。这是徽记条件，不是普通通关条件。</p>` : ""}${btn("close", "返回关卡", "ArrowLeft", "primary")}`;
  if (st.modal === "hint") body = `<span class="tw-eyebrow">策略提示 / 自选</span><h2>再看一眼关系</h2><ol>${x.hints.slice(0, st.hintDepth ?? 1).map((h) => `<li>${esc(h)}</li>`).join("")}</ol><div>${(st.hintDepth ?? 1) < 3 ? btn("deeper", "再提示一点", "Lightbulb") : ""}${btn("close", "继续尝试", "ArrowLeft", "primary")}</div>`;
  if (st.modal === "result") body = `<span class="tw-eyebrow">${result.pass ? "运行通过" : "待调整"} / ${x.id}</span><h2>${result.pass ? result.perfect ? "联运有序" : "设施恢复" : "还需调整"}</h2><p>${esc(result.message)}</p>${result.pass && levels.filter(q=>q.unit===x.unit).at(-1).id===x.id ? `<p class="tw-insight">${esc(x.insight)}</p>` : ""}<div class="tw-result"><b>${result.metric}</b><span>${esc(result.unit)}</span>${result.perfect ? icon("Award", 22) : ""}</div><div>${btn("close", result.pass ? "继续优化" : "返回调整", "ArrowLeft")}${result.pass ? btn("continue", "继续", "ArrowRight", "primary") : ""}</div>`;
  if (st.modal === "settings") body = `<span class="tw-eyebrow">本地设置</span><h2>游戏设置</h2><label>音效 <input data-setting="sound" type="checkbox" ${st.progress.settings.sound ? "checked" : ""}/></label><label>音量 <input data-setting="volume" type="range" min="0" max="1" step=".05" value="${st.progress.settings.volume}"/></label><label>减少动态效果 <input data-setting="motion" type="checkbox" ${st.progress.settings.motion ? "" : "checked"}/></label><p class="tw-small">${window.tideweave ? st.saveMeta.portable?'便携存档：data/progress.json':'存档：系统用户目录，迁移前请导出。' : "进度保存在浏览器本地。"}</p>${sync?syncPanel():''}<div class="tw-save-actions">${btn("export", "导出存档", "Download")}${btn("import", "导入存档", "Upload")}</div><footer class="tw-settings-footer"><div>${ib('fullscreen','全屏','Maximize')}${window.tideweave?ib('quit','退出游戏','LogOut'):''}</div>${btn("close", "完成", "Check", "primary")}</footer>`;
  if (st.modal === "journal") body = `<span class="tw-eyebrow">EX / 筹算·回放</span><h2>已完成的调度</h2><div class="tw-journal">${levels.filter((q) => passed(q.id) && !q.tutorial).map((q) => `<button data-replay-id="${q.id}"><b>${q.id}</b><span>${esc(q.title)}</span>${icon("Play")}</button>`).join("") || "<p>完成任务后，这里会保存过程回放。</p>"}</div>`;
  if(st.modal==='briefing'){
    const ch=chapters.find(c=>c.id===st.briefingChapter)??chapters.find(c=>c.id===st.chapter);
    body=`<span class="tw-eyebrow">CH.${String(ch.id).padStart(2,'0')} / 调度简报</span><h2>${esc(ch.title)}</h2><p class="tw-briefing-lead">${esc(ch.intro)}</p><div class="tw-briefing-purpose"><span>本章要解决</span><strong>${esc(ch.purpose)}</strong></div><p>${esc(ch.outcome)}</p><div>${btn('close','暂留本章','ArrowLeft')}${btn('ack-briefing','开始下一章','ArrowRight','primary')}</div>`;
  }
  if(st.modal==='chapter'){
    const ch=chapters.find(c=>c.id===(l()?.chapter??st.chapter));
    body=`<span class="tw-eyebrow">CH.${String(ch.id).padStart(2,'0')} / ${ch.scene}</span><h2>${ch.title}</h2><p>${esc(ch.summary)}</p>${units.some(u=>u.chapter===ch.id&&u.optional)?'<p class="tw-insight">本章选修已解锁，可先挑战，也可直接进入下一章。</p>':''}<div>${units.some(u=>u.chapter===ch.id&&u.optional)?btn('chapter-optional','挑战本章选修','Map'):''}${l()?btn('own-replay','回看本次选择','Play'):''}${btn('next-chapter',st.pendingNext?'前往下一章':'返回地图','ArrowRight','primary')}</div>`;
  }
  if(st.modal==='reset')body=`<h2>重置当前方案？</h2><p>进度、徽记和提示入口保留，重置后仍可撤销。</p><div>${btn('close','保留方案')}${btn('confirm-reset','重置','RotateCcw','primary')}</div>`;
  if(st.modal==='import')body=`<h2>导入存档？</h2><p>导入将替换本机进度。建议先导出一份备份。</p>${sync?.status().code?'<p>已开启云同步：导入的进度会和云端合并，不会删掉云端已有的进度。</p>':''}<div>${btn('export','先导出','Download')}${btn('confirm-import','选择存档','Upload','primary')}</div>`;
  if(st.modal==='sync-off')body=`<h2>关闭云同步？</h2><p>本机进度会保留，云端那份也不会删除。以后在任何设备输入同步码 <b>${esc(sync?.status().code??'')}</b> 还能接上，请先记下它。</p><div>${btn('settings','返回','ArrowLeft')}${btn('confirm-sync-off','关闭云同步','CloudOff','primary')}</div>`;
  if(st.modal==='adjacent'){
    const id=st.face??0,ns=l().edges.filter(e=>e.a===id||e.b===id).map(e=>solids[l().solid].labels[e.a===id?e.b:e.a]);
    body=`<h2>${solids[l().solid].labels[id]}面</h2><p>共用边的面：${ns.join('、')}。</p>${btn('close','返回','ArrowLeft','primary')}`;
  }
  return `<dialog class="tw-dialog" aria-label="调度对话框"><button class="tw-dialog-close" data-action="close" aria-label="关闭">${icon("X")}</button>${body}</dialog>`;
}
function render() {
  const previous=captureUI(app);
  syncMotion(st.progress.settings.motion);
  const view={screen:st.screen,chapter:st.chapter,tab:st.campaignTab,level:st.levelId,selected:st.selectedMission,modal:st.modal,replay:!!st.player,net:st.net};
  return renderUI(previous.view,view,reduced(),()=>{
  const focus=document.activeElement;
  const focused=focus?.matches(':focus-visible') && focus.matches('[data-node],[data-edge],[data-tool],[data-target],[data-mode],[data-action]')?Object.entries(focus.dataset).find(([k])=>['node','edge','tool','target','mode','action'].includes(k)):null;
  const scroll=document.querySelector('.tw-board')?.scrollLeft??0;
  st.solid?.dispose();
  st.solid = null;
  app.innerHTML = (st.screen === "game" ? game() : st.screen==='home'?home():map())+dialog();
  if (st.screen === "home") {
    const c = document.querySelector("#tw-city");
    if (c) drawCity(c, chapters.filter((x) => chapterDone(x.id)).length);
    if(loadedAssets.A01){const img=document.createElement('img');img.className='tw-city-art';img.alt='澜州水网远景';img.onload=()=>{c.hidden=true;};img.onerror=()=>{c.hidden=false;img.remove();};img.src=loadedAssets.A01;c.after(img);}
  } else if (st.screen==='game' && l().type === "solid" && !st.net && !st.webglFailed) {
    try {
      st.solid = new SolidView(document.querySelector("#tw-solid"), l().solid, (id) => edit("node", id, st.tool), (rot) => {
        st.rotation = rot;
      }, st.rotation, loadedAssets.light_panel_gray);
      st.solid.setColors(viewState().colors, st.player ? [] : st.session.result?.nodes ?? []);
    } catch {
      st.webglFailed = true;
      st.net = true;
      st.session.change('net');save();
      render();
      toast("无法使用立体渲染，已切换到同数据展开图。");
    }
  }
  bind();
  if(st.player){const bar=app.querySelector('.tw-playback');bar.insertAdjacentHTML('beforeend',`<select class="tw-speed" aria-label="回放速度">${[.5,1,2,3].map(v=>`<option value="${v}" ${st.progress.settings.speed===v?'selected':''}>${v}×</option>`).join('')}</select>`);bar.querySelector('select').onchange=e=>{st.progress.settings.speed=Number(e.target.value);save();step();};}
  if(st.modal==='settings'){
    const el=app.querySelector('dialog');
    if(st.saveMeta.portable===false)el.insertAdjacentHTML('beforeend',`<p class="tw-small">当前目录只读，实际存档位于 ${esc(st.saveMeta.savePath)}。迁移前请导出。</p>`);
  }
  const d=app.querySelector('dialog');if(d){d.showModal();d.addEventListener('cancel',e=>{e.preventDefault();action('close');});}
  else if(focused)app.querySelector(`[data-${focused[0]}="${CSS.escape(focused[1])}"]`)?.focus({preventScroll:true});
  const boardEl=app.querySelector('.tw-board');if(boardEl)boardEl.scrollLeft=scroll;
  animateUI(app,previous,view,reduced());
  });
}
function open(id) {
  const x = levelById[id];
  if (!x || !unlock(id)) return;
  stop();
  st.screen = "game";
  st.chapter = x.chapter;
  st.levelId = id;
  st.session = sessionCache.get(id)??new GameSession(x, st.progress);sessionCache.set(id,st.session);
  st.progress.last=id;st.progress.chapter=x.chapter;st.rotation=null;st.face=0;
  st.net = false;
  st.webglFailed = false;
  st.tool = 0;
  st.target = 0;
  st.fault = "mark";
  st.adjacency = false;
  st.modal = null;
  st.pendingNext = null;
  st.briefingChapter = null;
  save();
  render();
}
function edit(kind, id, option = st.tool) {
  if (st.player) return;
  try {
    if (l().type === "fault" && st.fault === "probe" && (kind === "node" || kind === "edge")) {
      st.session.state.probe = id;
      render();
      return;
    }
    st.session.change(kind, id, option);
    tone();
    save();
    render();
  } catch (e) {
    toast(e.message);
  }
}
function run() {
  const result = st.session.check();
  if (!result.valid) {
    toast(result.message);
    return;
  }
  stop();
  st.session.result=null;
  st.player = { frames: result.frames, index: 0, paused: false, mode: "run", result };
  render();
  step();
}
function step() {
  clearTimeout(st.timer);
  if (!st.player || st.player.paused) return;
  st.timer = setTimeout(() => {
    if (st.player.index < st.player.frames.length - 1) {
      st.player.index++;
      render();
      step();
    } else finish();
  }, reduced() ? 20 : 650 / st.progress.settings.speed);
}
function finish() {
  const p = st.player;
  if(!p)return;
  if(p.mode === 'replay') { clearTimeout(st.timer); p.index = p.frames.length - 1; p.paused = true; render(); return; }
  stop();
  if (p.mode === "run") {
    st.session.finish(p.result);
    tone(p.result.pass);
    save();
    st.modal = "result";
  }
  render();
}
function replay(id = st.levelId,own=false) {
  if (!passed(id)) return;
  if (st.levelId !== id) open(id);
  stop();st.modal=null;
  const reference = algorithmReplay(l()),bestState = st.progress.records[id].best;
  if(!bestState)own=false;
  const best = bestState?evaluate(l(), bestState):{metric:'旧版'};
  const result = own ? best : reference;
  st.player = { frames: result.frames, index: 0, paused: false, mode: "replay", result, own,
    state: structuredClone(own ? bestState : reference.state), bestMetric: best.metric, referenceMetric: reference.metric };
  render();
  step();
}
function advance(id) {
  const target=levelById[id],chapter=l()?.chapter??st.chapter;
  st.pendingNext=null;
  st.modal=null;
  if(!target||!unlock(id)){action('home');return;}
  if(!l()?.optional&&target.chapter===chapter+1&&chapterDone(chapter)){
    st.pendingNext=id;
    st.briefingChapter=target.chapter;
    st.modal='briefing';
    render();
    return;
  }
  open(id);
}
function next() {
  const x=l(),list=x.optional?levels.filter(q=>q.unit===x.unit):levels.filter(q=>!q.optional),i=list.indexOf(x),n=list[i+1];
  if(!x.optional&&(!n||n.chapter!==x.chapter)&&chapterDone(x.chapter)&&!st.progress.summaries.includes(x.chapter)){
    st.progress.summaries.push(x.chapter);save();st.pendingNext=n?.id;st.modal='chapter';render();return;
  }
  advance(n?.id);
}
async function exportSave() {
  if (window.tideweave?.export) {
    if (await window.tideweave.export(st.progress)) toast("进度已导出。");
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(st.progress, null, 2)], { type: "application/json" }));
    a.download = "Tideweave-progress.json";
    a.click();
    toast("进度已导出。");
  }
}
async function importSave() {
  try {
    let value;
    if (window.tideweave) value = await window.tideweave.import();
    else {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      value = await new Promise((resolve,reject) => {
        input.oncancel=()=>resolve(null);
        input.onchange = async()=>{try{const f=input.files[0];if(!f)return resolve(null);if(f.size>4*1024*1024)throw new Error('存档过大');resolve(JSON.parse(await f.text()));}catch(e){reject(e);}};
        input.click();
      });
    }
    if (!value) return;
    if(value.version!==1||!value.records||Array.isArray(value.records))throw new Error('存档格式不兼容');
    stop();sessionCache.clear();st.modal=null;
    st.progress = normalize(value);
    st.screen = "map";
    st.levelId = null;
    st.session = null;
    save();
    render();
    toast("进度已导入。");
  } catch (e) {
    toast("导入失败，当前进度未改动。");
  }
}
// —— 云同步（只在网页版用到）——
const syncShort={off:'本地存档 · 自动保存',idle:'云同步 · 等待同步',syncing:'云同步 · 同步中',ok:'云同步 · 已同步',offline:'云同步 · 离线，稍后重试',error:'云同步 · 出错，稍后重试',paused:'云同步 · 已暂停'};
function syncFooter(s=sync?.status()){
  if(!s)return '本地存档 · 自动保存';
  return s.state==='ok'&&s.dirty?'云同步 · 有改动待上传':syncShort[s.state]??syncShort.off;
}
function syncText(s=sync.status()){
  const parts=[s.message];
  if(s.lastSyncAt)parts.push(`上次同步 ${new Date(s.lastSyncAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`);
  if(s.state==='ok'&&s.dirty)parts.push('有改动待上传');
  if(s.pendingApply)parts.push('其他设备的新进度会在退出关卡后载入');
  return parts.join(' · ');
}
// 设置里的云同步区：没开启时给“开启”和“输入同步码”，开启后显示同步码和状态
function syncPanel(){
  const s=sync.status();
  if(s.state==='off')return `<section class="tw-sync"><h3>云同步</h3><p>开启后会得到一个同步码；在其他浏览器或设备上输入它，就能接着玩。设置不跟着同步。</p><div class="tw-sync-row">${btn('sync-enable','开启云同步','Cloud','primary')}</div><div class="tw-sync-row"><input class="tw-sync-input" data-sync-code type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="已有同步码：XXXX-XXXX-XXXX" aria-label="输入同步码"/>${btn('sync-join','接上','LogIn')}</div></section>`;
  return `<section class="tw-sync"><h3>云同步</h3><div class="tw-sync-code"><small>同步码</small><b>${esc(s.code)}</b>${ib('sync-copy','复制同步码','Copy')}</div><p class="tw-sync-status" data-sync-status data-state="${s.state}">${esc(syncText(s))}</p><div class="tw-sync-row">${btn('sync-now','立即同步','RefreshCw')}${btn('sync-disable','关闭云同步','CloudOff')}</div></section>`;
}
// 复制同步码：http 部署时没有 navigator.clipboard，退回到 execCommand
function copyText(text){
  const done=()=>toast(`已复制同步码 ${text}`);
  if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(text).then(done,()=>fallback());return;}
  fallback();
  function fallback(){
    const t=document.createElement('textarea');t.value=text;t.setAttribute('readonly','');t.style.cssText='position:fixed;opacity:0';
    (app.querySelector('dialog')??document.body).append(t);t.select();
    let ok=false;try{ok=document.execCommand('copy');}catch{}
    t.remove();ok?done():toast(`请手动记下同步码：${text}`);
  }
}
// 只在玩家不在关卡里时应用（关卡会话持有旧存档对象的引用）；设置弹窗开着时可以应用，其他弹窗等关掉再说
function canApplyCloud(){
  return st.screen!=='game'&&!st.player&&(!st.modal||st.modal==='settings');
}
// 应用云端进度：沿用 importSave() 的处理——停止播放、清空会话缓存、替换存档、保存、重画
function applyCloud(progress){
  stop();sessionCache.clear();
  st.progress=normalize(progress); // 同步层给的已经 normalize 过，这里再整理一次（幂等）作为兜底
  st.session=null;st.levelId=null;
  if(st.screen==='home')st.chapter=st.progress.chapter;
  if(st.selectedMission&&!unlock(st.selectedMission))st.selectedMission=null;
  save();
  render();
  toast('已载入其他设备上的进度。');
}
async function action(name) {
  if(st.modal&&['close','continue','next-chapter','ack-briefing','chapter-optional','own-replay','confirm-reset'].includes(name)){
    if(!await dismissDialog(app.querySelector('dialog'),reduced()))return;
  }
  if(name==='resume'){open(campaignNext().id);return;}
  if(name==='title-home'){stop();st.screen='home';st.levelId=null;st.session=null;st.modal=null;render();return;}
  if(name==='campaign'){st.screen='map';st.selectedMission=null;st.modal=null;render();return;}
  if(st.player&&['reset','undo','redo','settings','rules','journal','home'].includes(name)){
    if(name==='home')stop();else{st.player.paused=true;clearTimeout(st.timer);}
  }
  if(name==='confirm-import'){await importSave();return;}
  if(name==='chapter-note'){st.pendingNext=levels.find(q=>!q.optional&&q.chapter===st.chapter+1)?.id;st.modal='chapter';render();return;}
  if(name==='next-chapter'){advance(st.pendingNext);return;}
  if(name==='ack-briefing'){
    const id=st.pendingNext,chapter=st.briefingChapter;
    if(st.modal!=='briefing'||!levelById[id]||!unlock(id))return;
    if(!st.progress.briefings.includes(chapter))st.progress.briefings.push(chapter);
    open(id);return;
  }
  if(name==='chapter-optional'){
    const chapter=l()?.chapter??st.chapter,unit=units.find(u=>u.chapter===chapter&&u.optional);
    if(!unit||!chapterDone(chapter))return;
    st.chapter=chapter;
    await action('home');
    st.campaignTab='optional';st.selectedMission=null;await render();
    app.querySelector(`[data-unit="${unit.id}"]`)?.scrollIntoView({block:'start'});
    return;
  }
  if(name==='own-replay'){replay(st.levelId,true);return;}
  if(name==='compare-replay'){replay(st.levelId,!st.player.own);return;}
  if(name==='confirm-reset'){stop();st.modal=null;st.session.reset();save();render();return;}
  if(name==='adjacent'){st.modal='adjacent';render();return;}
  if(name==='paint-face'){edit('node',st.face??0,st.tool);return;}
  if (name === "home") {
    stop();
    st.selectedMission=st.levelId??st.selectedMission;
    if(l())st.campaignTab=l().optional?'optional':'main';
    st.screen = "map";
    st.levelId = null;
    st.session = null;
    st.modal = null;
    st.pendingNext = null;
    st.briefingChapter = null;
    render();
    return;
  }
  if (["settings","rules","journal","reset","import"].includes(name)) {
    st.modal = name;
    render();
    return;
  }
  if (name === "close") {
    st.pendingNext = null;
    st.briefingChapter = null;
    st.modal = null;
    render();
    return;
  }
  if (name === "sound") {
    st.progress.settings.sound = !st.progress.settings.sound;
    save();
    render();
    return;
  }
  if (name === "fullscreen") {
    if (window.tideweave) await window.tideweave.fullscreen();
    else document.documentElement.requestFullscreen?.();
    return;
  }
  if (name === "quit") {
    await save();
    if(!st.saveFailed)window.tideweave?.quit();
    return;
  }
  if (name === "sync-enable") {
    await sync.enable();
    render();
    toast("已开启云同步。在其他设备输入同步码即可接着玩。");
    return;
  }
  if (name === "sync-join") {
    const input = app.querySelector("[data-sync-code]");
    const result = await sync.join(input?.value ?? "");
    if (result.ok) { render(); toast("已接上同步码，两边的进度已合并。"); }
    else { toast(result.message); input?.focus(); }
    return;
  }
  if (name === "sync-now") {
    await sync.syncNow();
    return;
  }
  if (name === "sync-copy") {
    copyText(sync.status().code ?? "");
    return;
  }
  if (name === "sync-disable") {
    st.modal = "sync-off";
    render();
    return;
  }
  if (name === "confirm-sync-off") {
    sync.disable();
    st.modal = "settings";
    render();
    toast("已关闭云同步，本机进度保留。");
    return;
  }
  if (name === "export") {
    await exportSave();
    return;
  }
  if (name === "import") {
    await importSave();
    return;
  }
  if (name === "hint") {
    st.hintDepth = 1;
    st.modal = "hint";
    render();
    return;
  }
  if (name === "deeper") {
    st.hintDepth = Math.min(3, (st.hintDepth ?? 1) + 1);
    render();
    return;
  }
  if (name === "rules") {
    st.modal = "rules";
    render();
    return;
  }
  if (name === "run") {
    run();
    return;
  }
  if (name === "edit") {
    stop();
    render();
    return;
  }
  if (name === "replay") {
    replay();
    return;
  }
  if (name === "continue") {
    next();
    return;
  }
  if (name === "undo" || name === "redo") {
    stop();
    st.session[name]();
    save();
    render();
    return;
  }
  if (name === "reset") {
    st.session.reset();
    save();
    render();
    return;
  }
  if (name === "pause") {
    st.player.paused = !st.player.paused;
    render();
    step();
    return;
  }
  if (name === "prev-frame") {
    clearTimeout(st.timer);
    st.player.paused = true;
    st.player.index = Math.max(0, st.player.index - 1);
    render();
    return;
  }
  if (name === "next-frame") {
    clearTimeout(st.timer);
    st.player.paused = true;
    if (st.player.index < st.player.frames.length - 1) st.player.index++;
    else finish();
    render();
    return;
  }
  if (name === "skip") {
    if(st.player?.mode === 'replay'){stop();render();}else finish();
    return;
  }
  if (name === "less" || name === "more") {
    edit("predict", s().prediction + (name === "less" ? -1 : 1));
    return;
  }
  if (name === "clear-probe") {
    st.session.state.probe = null;
    render();
    return;
  }
  if (name === "adjacency") {
    st.adjacency = !st.adjacency;
    render();
    return;
  }
  if (name === "net") {
    st.net = true;
    if(!st.player){st.session.change("net");save();}
    render();
    return;
  }
  if (name === "solid") {
    st.net = false;
    render();
    return;
  }
  if (name === "reset-view") {
    st.solid?.reset();
    return;
  }
  if (name === "unpainted") {
    const n = s().colors.findIndex((x) => x < 0);
    if (n >= 0){st.face=n;if(st.solid)st.solid.focusFace(n);else app.querySelector(`[data-node="${n}"]`)?.focus();toast('定位：'+solids[l().solid].labels[n]+'面');}else toast('所有面都已着色。');
    return;
  }
}
function bind() {
  app.querySelectorAll("[data-action]").forEach((e) => e.addEventListener("click", () => action(e.dataset.action).catch(err=>toast(err.message))));
  app.querySelectorAll("[data-level]").forEach((e) => e.addEventListener("click", () => open(e.dataset.level)));
  app.querySelectorAll('[data-select-level]').forEach(e=>e.addEventListener('click',()=>{st.selectedMission=e.dataset.selectLevel;render();app.querySelector(`[data-select-level="${st.selectedMission}"]`)?.focus({preventScroll:true});if(innerWidth<=760)app.querySelector(".tw-deployment")?.scrollIntoView({block:"nearest",behavior:"instant"});}));
  app.querySelectorAll('[data-campaign-tab]').forEach(e=>e.addEventListener('click',()=>{st.campaignTab=e.dataset.campaignTab;st.selectedMission=null;render();}));
  app.querySelectorAll("[data-chapter]").forEach((e) => e.addEventListener("click", () => {
    st.chapter = Number(e.dataset.chapter);
    st.campaignTab='main';st.selectedMission=null;
    st.progress.chapter=st.chapter;save();
    render();
  }));
  app.querySelectorAll("[data-tool]").forEach((e) => e.addEventListener("click", () => {
    st.tool = Number(e.dataset.tool);
    render();
  }));
  app.querySelectorAll("[data-target]").forEach((e) => e.addEventListener("click", () => {
    st.target = Number(e.dataset.target);
    render();
  }));
  app.querySelectorAll("[data-mode]").forEach((e) => e.addEventListener("click", () => {
    st.fault = e.dataset.mode;
    render();
  }));
  app.querySelectorAll("[data-node]").forEach((e) => e.addEventListener("click", () => edit("node", Number(e.dataset.node), l().type==='routes'?st.target:st.tool)));
  app.querySelectorAll("[data-edge]").forEach((e) => e.addEventListener("click", () => edit("edge", Number(e.dataset.edge))));
  app.querySelectorAll("[data-replay-id]").forEach((e) => e.addEventListener("click", async () => {
    if(!await dismissDialog(app.querySelector('dialog'),reduced()))return;
    st.modal = null;
    replay(e.dataset.replayId);
  }));
  app.querySelectorAll("[data-setting]").forEach((e) => e.addEventListener("change", () => {
    st.progress.settings[e.dataset.setting] = e.dataset.setting==='motion'?!e.checked:e.type === "checkbox" ? e.checked : Number(e.value);
    if(e.dataset.setting==='motion')syncMotion(st.progress.settings.motion);
    save();
  }));
  const range = app.querySelector("[data-frame]");
  if (range) range.addEventListener("input", () => {
    clearTimeout(st.timer);
    st.player.paused = true;
    st.player.index = Number(range.value);
    render();
  });
  app.querySelectorAll('[data-pair]').forEach(el=>el.addEventListener('click',()=>edit('pair',el.dataset.pair)));
  app.querySelector('[data-face]')?.addEventListener('change',e=>{st.face=Number(e.target.value);st.solid?.focusFace(st.face);});
  app.querySelectorAll('[data-node],[data-edge]').forEach(el=>el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.dispatchEvent(new MouseEvent('click',{bubbles:true}));}}));
}
app.addEventListener('keydown',e=>{
  if(st.modal||st.screen!=='game'||e.target.matches('input,select'))return;
  if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();action(e.shiftKey?'redo':'undo');}
  if(/^[1-6]$/.test(e.key)&&['color','solid','groups','scc'].includes(l().type)){st.tool=Number(e.key)-1;render();}
});
try {
  const loaded = window.tideweave ? await window.tideweave.load() : sync ? sync.load() : { data: JSON.parse(localStorage.getItem("tideweave-progress") || "null") };
  st.saveMeta = loaded;
  st.progress = normalize(loaded?.data);
  st.chapter = st.progress.chapter;
} catch {
  st.progress = fresh();
}
render();
if(st.saveMeta.warning)toast(st.saveMeta.warning);
if(sync){
  // 同步状态变化时只更新文字，不整页重画（免得打断弹窗和动效）
  sync.subscribe(s=>{
    const el=app.querySelector('[data-sync-status]');if(el){el.textContent=syncText(s);el.dataset.state=s.state;}
    const f=app.querySelector('[data-sync-footer]');if(f)f.textContent=syncFooter(s);
  });
  sync.start({progress:st.progress,apply:applyCloud,canApply:canApplyCloud});
}
window.tideweave?.onClosing(async()=>{await save();window.tideweave.confirmClose(!st.saveFailed);});
