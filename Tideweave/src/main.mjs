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
import {pathCost,criticalSchedule,floydStages,groups} from './algorithms.mjs';
import {assetManifest} from './assets.mjs';
const availableAssets=typeof __ASSET_FILES__==='undefined'?[]:__ASSET_FILES__;
const loadedAssets=Object.fromEntries(availableAssets.map(id=>[id,assetManifest[id].path]));
const app = document.querySelector("#app");
const sessionCache=new Map();
const st = { screen: "map", chapter: 1, levelId: null, progress: fresh(), session: null, modal: null, player: null, timer: null, solid: null, net: false, tool: 0, target: 0, fault: "mark", probe: null, adjacency: false, speed: 1, saveMeta: {} };
const icon = (name, size = 16) => createElement(icons[name] || icons.Circle, { width: size, height: size, "aria-hidden": "true" }).outerHTML;
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const l = () => levelById[st.levelId], r = () => st.progress.records[st.levelId] ?? {}, s = () => st.session?.state;
const viewState = () => st.player?.mode === 'replay' ? { ...st.player.state, ...st.player.frames[st.player.index]?.state } : s();
const typeLabel = (x) => ({reach:'找相通设施',groups:'分区标记',dfs:'巡检路线',broadcast:'传播预测',forest:'保留线路',scc:'互达分组',euler:'线路巡运',shortest:'路线规划',routes:'多份运单',floyd:'中转比较',postman:'闭环巡运',mst:'建设线路',topo:'工序排序',cycle:'找出循环',schedule:'安排加速',color:'区域上色',solid:'立体上色',matching:'岗位安排',fault:'故障测试',isolation:'隔离设备',cut:'停线断开',reinforce:'线路加固'}[x.type]??'图上操作');
const btn = (action2, text, ico = "", cls = "", extra = "") => `<button class="tw-btn ${cls}" data-action="${action2}" ${extra}>${ico ? icon(ico) : ""}<span>${esc(text)}</span></button>`;
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
  return `<header class="tw-header"><button class="tw-brand" data-action="home"><span class="tw-seal">脉</span><span><b>脉序</b><small>TIDEWEAVE</small></span></button><span class="tw-context">澜州联运区 <i>/</i> 联运调度署</span><div class="tw-header-actions">${ib("journal", "筹算回放", "BookOpen")}${ib("sound", st.progress.settings.sound ? "关闭音效" : "开启音效", st.progress.settings.sound ? "Volume2" : "VolumeX")}${ib("settings", "设置", "Settings")}</div></header>`;
}
function map() {
  const ch = chapters.find((x) => x.id === st.chapter), ls = levels.filter((x) => x.chapter === st.chapter), main = ls.filter(x=>!x.optional), done = main.filter((x) => passed(x.id)).length;
  const unitRows=units.filter(x=>x.chapter===st.chapter).map(unit=>`<article class="tw-unit" data-unit="${unit.id}"><div class="tw-unit-head"><span>${unit.id}</span><h2>${esc(unit.name)}</h2><small>${esc(unit.knowledge.split(' · ')[0])}</small>${unit.optional?'<em>选修</em>':''}</div><div class="tw-mission-grid">${ls.filter(x=>x.unit===unit.id).map(x=>{
    const q=st.progress.records[x.id],available=unlock(x.id);
    const lockedReason=x.optional&&!chapterDone(x.chapter)?'完成本章普通关卡后开放':`先完成 ${x.requires.filter(id=>!passed(id)).map(id=>levelById[id].title).join('、')}`;
    return `<button class="tw-mission ${q?.passed?'passed':''} ${q?.perfect?'perfect':''}" data-level="${x.id}" ${available?'':`disabled title="${esc(lockedReason)}"`}><strong>${String(x.step).padStart(2,'0')}</strong><span><b>${esc(x.title)}</b><small>${available?(q?.perfect?'徽记已获得':q?.passed?'任务已完成':x.tutorial?'先熟悉操作':'等待调度'):esc(lockedReason)}</small></span>${icon(!available?'Lock':q?.perfect?'Award':q?.passed?'Check':'ArrowRight')}</button>`;
  }).join('')}</div></article>`).join('');
  return `<main class="tw-map">${header()}<nav class="tw-chapters">${chapters.map(c=>`<button data-chapter="${c.id}" class="${c.id===st.chapter?'active':''}"><span>CH.${String(c.id).padStart(2,'0')}</span><b>${esc(c.title)}</b>${chapterDone(c.id)?icon('Check'):''}</button>`).join('')}</nav><section class="tw-city"><canvas id="tw-city" aria-label="澜州水网工程城市"></canvas><div class="tw-city-heading"><span class="tw-eyebrow">CH.${String(ch.id).padStart(2,'0')} / ${esc(ch.scene)}</span><h1>${esc(ch.title)}</h1><p>${esc(ch.intro)}</p><div class="tw-city-purpose"><span>本章任务</span><strong>${esc(ch.purpose)}</strong></div></div><div class="tw-city-progress"><b>${String(done).padStart(2,'0')}<small> / ${String(main.length).padStart(2,'0')}</small></b><span>普通关卡完成</span></div><div class="tw-city-stamp"><span>${ch.scene}</span><b>${levels.filter(x=>st.progress.records[x.id]?.perfect).length} 枚徽记</b></div></section><section class="tw-missions"><div class="tw-missions-heading"><div><span class="tw-eyebrow">调度台 / MISSION BOARD</span><h2>选择下一项任务</h2></div><span>${esc(ch.outcome)}</span></div>${unitRows}</section><footer class="tw-map-footer"><span>本地进度 · 自动保存</span>${chapterDone(ch.id)?btn('chapter-note','章节手记','BookOpen'):''}</footer></main>`;
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
  if (x.type === "cycle") return `已排 ${v.order.length} 步`;
  if (x.type === "floyd") return `已选 ${v.pairs.length} 组`;
  return `已标记 ${v.selected.length} 项`;
}
function toolbar() {
  const x = l(), v = s();
  let out = "";
  if (["color", "solid", "groups", "scc"].includes(x.type)) out += `<div class="tw-swatches" aria-label="${x.type === "color" || x.type === "solid" ? "选择颜色" : "选择分组"}">${palette.map((c, i) => `<button class="tw-swatch ${st.tool === i ? "active" : ""}" data-tool="${i}" aria-label="${x.type === "color" || x.type === "solid" ? colorNames[i] : "分组 " + (i + 1)}" style="--swatch:${c};--swatch-ink:${paletteText[i]}">${i + 1}</button>`).join("")}</div>`;
  if (x.type === "routes") out += `<div class="tw-segment">${x.targets.map((n, i) => `<button data-target="${i}" class="${st.target === i ? "selected" : ""}">${esc(x.nodes[n].label)}</button>`).join("")}</div>`;
  if (x.type === "broadcast") out += `<div class="tw-predict"><span>预测轮次</span><button data-action="less">−</button><b>${v.prediction}</b><button data-action="more">+</button></div>`;
  if (x.type === "fault") out += `<div class="tw-segment"><button data-mode="mark" class="${st.fault === "mark" ? "selected" : ""}">标记</button><button data-mode="probe" class="${st.fault === "probe" ? "selected" : ""}">停用测试</button></div>${v.probe !== null ? btn("clear-probe", "恢复原图", "RotateCcw") : ""}`;
  if (x.type === "color") out += btn("adjacency", st.adjacency ? "隐藏共边关系" : "查看共边关系", "Network", st.adjacency ? "selected" : "");
  if (x.type === "solid") out += `<div class="tw-segment"><button data-action="solid" class="${!st.net ? "selected" : ""}">${icon("Box")} 立体</button><button data-action="net" class="${st.net ? "selected" : ""}">${icon("Unfold")} 展开图</button></div>${ib("reset-view", "复位视角", "RotateCcw")}${ib("unpainted", "定位未着色面", "ScanSearch")}`;
  if(x.type==='solid')out+=`<label class="tw-face">面 <select data-face aria-label="选择面">${solids[x.solid].labels.map((name,i)=>`<option value="${i}" ${(st.face??0)===i?'selected':''}>${name}</option>`).join('')}</select></label>${btn('paint-face','着色','Check')}${ib('adjacent','查看相邻面','Network')}`;
  return out;
}
function board() {
  const x = l(), v = viewState(), result = st.player ? null : st.session.result, frame = st.player?.frames[st.player.index];
  if(frame?.condensed) return condensedBoard(x, frame.condensed);
  if (x.type === "solid" && !st.net && !st.webglFailed) return '<div id="tw-solid" class="tw-solid"></div>';
  if (x.type === "solid") return netBoard(x, v, result);
  if (x.type === "color") return regionBoard(x, v, { result, adjacency: st.adjacency });
  if (x.type === "floyd") return `<div class="tw-floyd-board">${graphBoard(x,v,{result,frame,images:loadedAssets})}<div class="tw-floyd"><p>${frame?.matrix ? esc(frame.caption) : `可中转：${esc(x.nodes.slice(0,x.stage+1).map(n=>n.label).join("、"))}`}</p>${frame?.matrix ? distanceTable(x, frame.matrix) : floydTable(x, v)}</div></div>`;
  return graphBoard(x, v, { result, frame, target: st.target,images:loadedAssets });
}
function game() {
  const x = l(), v = viewState(), result = st.player ? null : st.session.result;
  const chapter = chapters.find(c => c.id === x.chapter);
  return `<main class="tw-game">
    <header class="tw-mission-head">
      ${ib("home", "返回任务地图", "ArrowLeft")}
      <div class="tw-mission-ident"><span class="tw-eyebrow">${esc(chapter.title)} / ${x.id}</span><h1>${esc(x.title)}</h1></div>
      <div class="tw-header-actions">${ib("sound", st.progress.settings.sound ? "关闭音效" : "开启音效", st.progress.settings.sound ? "Volume2" : "VolumeX")}${ib("settings", "设置", "Settings")}</div>
    </header>
    <section class="tw-task"><div class="tw-task-mark"><span>任务</span><b>${String(x.step).padStart(2,'0')}</b></div><div class="tw-task-copy"><span class="tw-task-kicker">本关目标</span><h2>${esc(x.goal)}</h2><div class="tw-control-line"><span>${icon('MousePointer2')}操作</span><p>${esc(x.controls)}</p></div></div>
      ${x.badge ? `<aside>${icon("Award")}<span>挑战目标<br><b>${esc(x.badge)}</b></span></aside>` : ""}
    </section>
    <div class="tw-context-tools">${toolbar()}<output aria-live="polite">${metric()}</output></div>
    <section class="tw-board ${x.type === "solid" ? "solid-board" : ""}">${board()}${x.type === "schedule" ? timeline(x, v) : ""}</section>
    ${st.player ? playback() : `<div class="tw-feedback" aria-live="polite">${result ? `${icon(result.pass ? "Check" : "Info")}<span class="${result.pass ? "good" : "warn"}">${esc(result.message)}</span>` : ""}</div>`}
    <footer class="tw-operation"><div>
      ${ib("undo", "撤销", "Undo2", st.session.history.length ? "" : "disabled")}${ib("redo", "重做", "Redo2", st.session.future.length ? "" : "disabled")}${ib("reset", "重置方案", "RotateCcw")}
      ${btn("rules", "完整规则", "CircleHelp")}${r().hintUnlocked ? ib("hint", "策略提示", "Lightbulb") : ""}
    </div><div>${r().passed ? ib("replay", "查看回放", "BookOpen") : ""}${btn(st.player ? "edit" : "run", st.player ? "返回编辑" : "运行检查", st.player ? "ArrowLeft" : "Play", "primary")}</div></footer>
  </main>`;
}
function playback() {
  const p = st.player;
  const comparison = p.mode === 'replay' ? `${ib('compare-replay', p.own ? '查看筹算方案' : '查看我的最佳方案', 'ArrowLeftRight')}<small>我的最佳 ${p.bestMetric} · 参考 ${p.referenceMetric} ${esc(p.result.unit)}</small>` : '';
  return `<section class="tw-playback"><div>${ib("prev-frame", "上一步", "ChevronLeft", p.index ? "" : "disabled")}${ib("pause", p.paused ? "播放" : "暂停", p.paused ? "Play" : "Pause")}${ib("next-frame", "下一步", "ChevronRight")}${ib("skip", "跳过回放", "SkipForward")}</div><input data-frame type="range" min="0" max="${p.frames.length - 1}" value="${p.index}" aria-label="回放步骤"/><span>${esc(p.frames[p.index]?.caption)}</span>${comparison}</section>`;
}
function dialog() {
  if (!st.modal) return "";
  const x = l(), result = st.session?.result;
  let body = "";
  if (st.modal === "rules") body = `<span class="tw-eyebrow">${esc(typeLabel(x))} / ${x.id}</span><h2>本关规则</h2><h3>怎样算通关</h3><p>${esc(x.goal)}。</p><h3>怎样操作</h3><p>${esc(x.controls)}</p><h3>还需要知道</h3><ul>${x.rules.map(rule=>`<li>${esc(rule)}</li>`).join('')}</ul>${x.badge ? `<p class="tw-insight">额外挑战：${esc(x.badge)}。这是徽记条件，不是普通通关条件。</p>` : ""}${btn("close", "返回关卡", "ArrowLeft", "primary")}`;
  if (st.modal === "hint") body = `<span class="tw-eyebrow">策略提示 / 自选</span><h2>再看一眼关系</h2><ol>${x.hints.slice(0, st.hintDepth ?? 1).map((h) => `<li>${esc(h)}</li>`).join("")}</ol><div>${(st.hintDepth ?? 1) < 3 ? btn("deeper", "再提示一点", "Lightbulb") : ""}${btn("close", "继续尝试", "ArrowLeft", "primary")}</div>`;
  if (st.modal === "result") body = `<span class="tw-eyebrow">${result.pass ? "运行通过" : "待调整"} / ${x.id}</span><h2>${result.pass ? result.perfect ? "联运有序" : "设施恢复" : "还需调整"}</h2><p>${esc(result.message)}</p>${result.pass && levels.filter(q=>q.unit===x.unit).at(-1).id===x.id ? `<p class="tw-insight">${esc(x.insight)}</p>` : ""}<div class="tw-result"><b>${result.metric}</b><span>${esc(result.unit)}</span>${result.perfect ? icon("Award", 22) : ""}</div><div>${btn("close", result.pass ? "继续优化" : "返回调整", "ArrowLeft")}${result.pass ? btn("continue", "继续", "ArrowRight", "primary") : ""}</div>`;
  if (st.modal === "settings") body = `<span class="tw-eyebrow">本地设置</span><h2>调度偏好</h2><label>音效 <input data-setting="sound" type="checkbox" ${st.progress.settings.sound ? "checked" : ""}/></label><label>音量 <input data-setting="volume" type="range" min="0" max="1" step=".05" value="${st.progress.settings.volume}"/></label><label>减少动态效果 <input data-setting="motion" type="checkbox" ${st.progress.settings.motion ? "" : "checked"}/></label><p class="tw-small">${window.tideweave ? st.saveMeta.portable?'便携存档：data/progress.json':'存档：系统用户目录，迁移前请导出。' : "预览进度保存在浏览器本地。"}</p><div>${btn("export", "导出存档", "Download")}${btn("import", "导入存档", "Upload")}</div>${btn("close", "完成", "Check", "primary")}`;
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
  if(st.modal==='import')body=`<h2>导入存档？</h2><p>导入将替换本机进度。建议先导出一份备份。</p><div>${btn('export','先导出','Download')}${btn('confirm-import','选择存档','Upload','primary')}</div>`;
  if(st.modal==='adjacent'){
    const id=st.face??0,ns=l().edges.filter(e=>e.a===id||e.b===id).map(e=>solids[l().solid].labels[e.a===id?e.b:e.a]);
    body=`<h2>${solids[l().solid].labels[id]}面</h2><p>共用边的面：${ns.join('、')}。</p>${btn('close','返回','ArrowLeft','primary')}`;
  }
  return `<dialog class="tw-dialog" aria-label="调度对话框"><button class="tw-dialog-close" data-action="close" aria-label="关闭">${icon("X")}</button>${body}</dialog>`;
}
function render() {
  const focus=document.activeElement;
  const focused=focus?.matches(':focus-visible') && focus.matches('[data-node],[data-edge],[data-tool],[data-target],[data-mode],[data-action]')?Object.entries(focus.dataset).find(([k])=>['node','edge','tool','target','mode','action'].includes(k)):null;
  const scroll=document.querySelector('.tw-board')?.scrollLeft??0;
  st.solid?.dispose();
  st.solid = null;
  app.innerHTML = (st.screen === "game" ? game() : map())+dialog();
  if (st.screen === "map") {
    const c = document.querySelector("#tw-city");
    if (c) drawCity(c, chapters.filter((x) => chapterDone(x.id)).length);
    if(loadedAssets.A01){const img=document.createElement('img');img.className='tw-city-art';img.alt='澜州水网远景';img.src=loadedAssets.A01;img.onerror=()=>img.remove();c.after(img);}
  } else if (l().type === "solid" && !st.net && !st.webglFailed) {
    try {
      st.solid = new SolidView(document.querySelector("#tw-solid"), l().solid, (id) => edit("node", id, st.tool), (rot) => {
        st.rotation = rot;
      }, st.rotation);
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
  if(st.screen==='game'){
    const ns='http://www.w3.org/2000/svg';
    app.querySelectorAll('.station').forEach((el,i)=>{
      if(['topo','schedule','cycle','matching'].includes(l().type))return;
      const source=i===(l().source??-1)?loadedAssets.A04:loadedAssets.A05;
      if(source){const im=document.createElementNS(ns,'image');im.setAttribute('href',source);im.setAttribute('x','-31');im.setAttribute('y','-31');im.setAttribute('width','62');im.setAttribute('height','62');im.style.pointerEvents='none';im.addEventListener('error',()=>im.remove());el.querySelector('.station-body')?.after(im);}
      if(loadedAssets.A06&&el.classList.contains('current')){const im=document.createElementNS(ns,'image');im.setAttribute('href',loadedAssets.A06);im.setAttribute('x','-15');im.setAttribute('y','-56');im.setAttribute('width','30');im.setAttribute('height','30');im.style.pointerEvents='none';im.addEventListener('error',()=>im.remove());el.append(im);}
    });
  }
  if(st.player){const bar=app.querySelector('.tw-playback');bar.insertAdjacentHTML('beforeend',`<select class="tw-speed" aria-label="回放速度">${[.5,1,2,3].map(v=>`<option value="${v}" ${st.progress.settings.speed===v?'selected':''}>${v}×</option>`).join('')}</select>`);bar.querySelector('select').onchange=e=>{st.progress.settings.speed=Number(e.target.value);save();step();};}
  if(st.modal==='settings'){
    const el=app.querySelector('dialog');el.insertAdjacentHTML('beforeend',`<div>${btn('fullscreen','全屏','Maximize')}${window.tideweave?btn('quit','退出游戏','LogOut'):''}</div>`);
    el.querySelector('[data-action="fullscreen"]').onclick=()=>action('fullscreen');el.querySelector('[data-action="quit"]')?.addEventListener('click',()=>action('quit'));
    if(st.saveMeta.portable===false)el.insertAdjacentHTML('beforeend',`<p class="tw-small">当前目录只读，实际存档位于 ${esc(st.saveMeta.savePath)}。迁移前请导出。</p>`);
  }
  const d=app.querySelector('dialog');if(d){d.showModal();d.addEventListener('cancel',e=>{e.preventDefault();action('close');});}
  else if(focused)app.querySelector(`[data-${focused[0]}="${CSS.escape(focused[1])}"]`)?.focus({preventScroll:true});
  const boardEl=app.querySelector('.tw-board');if(boardEl)boardEl.scrollLeft=scroll;
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
  const bestState = st.progress.records[id].best;
  const best = evaluate(l(), bestState), reference = algorithmReplay(l());
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
async function action(name) {
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
  app.querySelectorAll("[data-chapter]").forEach((e) => e.addEventListener("click", () => {
    st.chapter = Number(e.dataset.chapter);
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
  app.querySelectorAll("[data-replay-id]").forEach((e) => e.addEventListener("click", () => {
    st.modal = null;
    replay(e.dataset.replayId);
  }));
  app.querySelectorAll("[data-setting]").forEach((e) => e.addEventListener("change", () => {
    st.progress.settings[e.dataset.setting] = e.dataset.setting==='motion'?!e.checked:e.type === "checkbox" ? e.checked : Number(e.value);
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
  const loaded = window.tideweave ? await window.tideweave.load() : { data: JSON.parse(localStorage.getItem("tideweave-progress") || "null") };
  st.saveMeta = loaded;
  st.progress = normalize(loaded?.data);
  st.chapter = st.progress.chapter;
} catch {
  st.progress = fresh();
}
render();
if(st.saveMeta.warning)toast(st.saveMeta.warning);
window.tideweave?.onClosing(async()=>{await save();window.tideweave.confirmClose(!st.saveFailed);});
