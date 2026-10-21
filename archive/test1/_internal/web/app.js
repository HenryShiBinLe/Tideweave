'use strict';
const $=id=>document.getElementById(id);
let model,busy=false,color=0,chapter=0,screen='home',feedback='',bookPage=0,audioContext;
const chapterNames=['送信员','快递小哥','修路大亨','地图着色','网络攻防'];
const labels={euler:['邮局','房子','商店','学校','房子','商店','房子','学校'],route:['仓库','北站','南站','花园','码头','客户'],dijkstra:['仓库','北站','南站','中转站','东站','配送站','客户'],mst:['村庄','村庄','村庄','村庄','村庄','村庄','村庄'],color:['岛屿','岛屿','岛屿','岛屿','岛屿','岛屿'],cut:['电脑','服务器','服务器','交换机','交换机','服务器','接收端','服务器']};
const objectives=[
 '点击相邻地点，每条街走一次。',
 '从 C 出发，每条街走一次。',
 '点击站点送到客户，争取 9 分钟。',
 '每轮点击未确认的最小距离，直到全部确认。',
 '每轮确认最小距离，留意数字如何变小。',
 '点道路连接所有村庄，造价越低越好。',
 '保留旧桥，连接所有村庄；预算 16。',
 '先选标记再点岛屿，相邻不同，种类越少越好。',
 '相邻岛屿用不同标记，找到最少种类。',
 '点击链路，让 A 与 G 断联；切得越少越好。'
];
const helpNotes={euler:'红色街道已经走过，红色地点是你的位置。地点可重复，街道不可重复。',route:'路上的数字是分钟。走过的每一段都计时，包括回头。',dijkstra:'角标是暂定距离，∞ 表示还没发现路线。黑底站点已确认；数字相同可任选。',mst:'路上的数字是造价。再次点击已修道路可拆除，标着“旧桥”的道路必须保留。',color:'不同形状代表不同组，相当于图着色中的不同颜色。只约束有桥相连的岛，可随时换标记。',cut:'红色虚线是断开的链路，再点一次可恢复。环上的路可能有替代路线。'};
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function number(n){return n===null?'∞':String(n);}
function svgEl(tag,attrs={}){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v)));return e;}
function markSymbol(i){
 const svg=svgEl('svg',{viewBox:'0 0 24 24',class:'mark-symbol','aria-hidden':'true'});
 const shapes=[['polygon',{points:'12,1 24,23 0,23'}],['rect',{x:2,y:2,width:20,height:20}],['circle',{cx:12,cy:12,r:11}],['polygon',{points:'12,0 24,12 12,24 0,12'}],['path',{d:'M8 0h8v8h8v8h-8v8H8v-8H0V8h8z'}]];
 svg.append(svgEl(shapes[i][0],shapes[i][1]));return svg;
}
async function request(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'连接失败');return d;}
function sound(){if(!model.progress.sound)return;try{audioContext||=new AudioContext();audioContext.resume();const o=audioContext.createOscillator(),g=audioContext.createGain();o.frequency.value=560;g.gain.setValueAtTime(.025,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.1);o.connect(g);g.connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+.12);}catch{}}
async function act(action,fields={}){
 if(busy||!model)return;busy=true;
 const wasFinished=model.state.finished,focus=document.activeElement?.dataset.focus;
 try{
  model=await request('api/action',{action,revision:model.revision,...fields});
  if(action==='level'||action==='reset'){closeDialog();screen='play';color=0;feedback='';}
  else if(action==='hint')feedback=model.message;
  else if(action==='undo')feedback=model.alert?model.message:'已撤销。';
  else if(model.alert||model.save_error)feedback=model.save_error||model.message;
  else if(action==='node'&&model.level.kind==='dijkstra')feedback=model.state.updates.length?model.state.updates.map(([n,old,next])=>`${model.level.nodes[n][0]}：${number(old)} → ${next}`).join('  /  '):'相邻站点已有更短路线。';
  else if(action==='edge'&&model.level.kind==='mst'&&model.groups===1)feedback='全部连通，可以验收。';
  else if(action==='edge'&&model.level.kind==='cut')feedback=model.message.includes('已经断联')?'已经断联，可以验收。':'仍能通信，存在绕行路线。';
  else feedback='';
  render();
  if(focus&&!['level','reset'].includes(action))document.querySelector(`[data-focus="${focus}"]`)?.focus({preventScroll:true});
  if(!model.alert&&['node','edge','submit'].includes(action))sound();
  if(model.state.finished&&!wasFinished&&!['level','reset'].includes(action))showResult();
 }catch(error){
  feedback='操作未完成，请重试。';$('status').textContent=feedback;$('status').className='alert';
  try{model=await request('api/state');render();}catch{}
 }finally{busy=false;}
}
function showHome(){closeDialog();screen='home';chapter=model.level.chapter;render();$('continue').focus();}
function resume(){closeDialog();screen='play';render();$('back').focus();}
function start(i){
 if(i===model.index&&!model.state.finished){resume();return;}
 if(model.history&&!model.state.finished){modal('切换关卡','重新出发？',[p('当前操作会重置，星星会保留。')],[['取消',closeDialog],['进入关卡',()=>act('level',{index:i}),true]]);return;}
 act('level',{index:i});
}
function render(){
 document.body.dataset.screen=screen;$('home').hidden=screen!=='home';$('play').hidden=screen!=='play';
 $('back').hidden=screen!=='play';$('help').hidden=screen!=='play';$('menu').hidden=false;$('total').hidden=screen!=='home';
 if(screen==='home')renderHome();else renderPlay();
}
function renderHome(){
 $('total').textContent=`★ ${String(model.progress.stars.reduce((a,b)=>a+b,0)).padStart(2,'0')} / 30`;
 $('chapter-number').textContent=String(chapter+1).padStart(2,'0');$('chapter-name').textContent=chapterNames[chapter];
 $('continue').textContent=model.history&&!model.state.finished?'继续游戏 →':model.progress.stars.some(Boolean)?'再来一局 →':'开始游戏 →';
 $('chapters').replaceChildren();chapterNames.forEach((name,i)=>{
  const b=el('button','chapter-button');b.dataset.chapter=i;b.setAttribute('aria-pressed',String(chapter===i));b.setAttribute('aria-label',`第 ${i+1} 章 ${name}`);
  b.append(el('span','mono',String(i+1).padStart(2,'0')),el('span','',name));b.onclick=()=>{chapter=i;renderHome();$('chapters').querySelector(`[data-chapter="${i}"]`).focus({preventScroll:true});};$('chapters').append(b);
 });
 $('levels').replaceChildren();model.levels.forEach((l,i)=>{
  if(l.chapter!==chapter)return;
  const b=el('button','level-ticket'+(model.progress.stars[i]?' completed':''));b.dataset.level=i;
  b.setAttribute('aria-label',`第 ${i+1} 关 ${l.title}，${model.progress.stars[i]} 星`);
  const text=el('span');text.append(el('span','ticket-name',l.title),el('span','ticket-score',model.progress.stars[i]?`★ ${model.progress.stars[i]} / 3`:i===model.index&&model.history?'继续':'未完成'));
  b.append(el('span','ticket-number mono',String(i+1).padStart(2,'0')),text,el('span','ticket-arrow','→'));b.onclick=()=>start(i);$('levels').append(b);
 });
}
function metric(){const s=model.state,l=model.level;
 if(l.kind==='euler')return `${s.selected.length} / ${l.edges.length} 街道`;
 if(l.kind==='route')return `${s.cost} 分钟`;
 if(l.kind==='dijkstra')return `${s.confirmed.length} / ${l.nodes.length} 已确认`;
 if(l.kind==='mst')return `造价 ${s.cost}${l.budget?' / '+l.budget:''}`;
 if(l.kind==='color')return `${new Set(Object.values(s.colors)).size} 种标记`;
 return `切断 ${s.selected.length} 条`;
}
function renderPlay(){
 $('level-number').textContent=String(model.index+1).padStart(2,'0');$('title').textContent=model.level.title;
 $('goal').textContent=objectives[model.index];$('metric').textContent=metric();
 $('status').textContent=model.save_error||feedback;$('status').className=model.alert||model.save_error?'alert':'';
 $('undo').disabled=!model.history||model.state.finished;$('hint').disabled=model.state.finished;
 $('submit').hidden=!model.state.finished&&!['mst','color','cut'].includes(model.level.kind);
 $('submit').textContent=model.state.finished?'查看结果 →':'验收 →';
 renderPalette();draw();
}
function renderPalette(){
 $('palette').replaceChildren();if(model.level.kind!=='color')return;
 for(let i=0;i<5;i++){const b=el('button','mark-button');b.dataset.color=i;b.dataset.focus='color-'+i;b.setAttribute('aria-label',`标记 ${i+1}`);b.setAttribute('aria-pressed',String(color===i));b.append(markSymbol(i),el('span','mono',String(i+1)));b.onclick=()=>chooseColor(i);$('palette').append(b);}
}
function chooseColor(i){color=i;renderPalette();$('palette').querySelector(`[data-color="${i}"]`)?.focus({preventScroll:true});}
function position(n,w,h){return [62+n[1]*(w-124),65+n[2]*(h-130)];}
function line(a,b,cls){return svgEl('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],class:cls});}
function draw(){
 if(!model||screen!=='play')return;
 const l=model.level,s=model.state,w=$('board').clientWidth,h=$('board').clientHeight;
 if(!w||!h)return;
 const pos=l.nodes.map(n=>position(n,w,h)),svg=$('roads'),edgeMode=['mst','cut'].includes(l.kind);
 svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${w} ${h}`);$('nodes').replaceChildren();$('edge-controls').replaceChildren();
 l.edges.forEach(([a,b,weight],i)=>{
  const selected=s.selected.includes(i),mandatory=l.mandatory.includes(i),cut=l.kind==='cut'&&selected;
  let cls='road'+(selected?' selected':'')+(mandatory?' mandatory':'')+(cut?' cut':'')+(model.conflicts.includes(i)?' conflict':'');
  if(l.kind==='dijkstra'&&s.updates.some(u=>u[3]===i))cls+=' changed';svg.append(line(pos[a],pos[b],cls));
  if(edgeMode&&!s.finished){const hit=line(pos[a],pos[b],'road-hit');hit.onclick=()=>act('edge',{index:i});svg.append(hit);}
  if(edgeMode||['route','dijkstra'].includes(l.kind)){
   const control=el(edgeMode?'button':'div','edge-control'+(selected?' selected':'')+(mandatory?' mandatory':'')+(cut?' cut':'')+(!edgeMode?' weight-label':''));
   control.dataset.edge=i;control.dataset.focus='edge-'+i;control.style.left=(pos[a][0]+pos[b][0])/2+'px';control.style.top=(pos[a][1]+pos[b][1])/2+'px';
   control.append(el('span','',l.kind==='cut'?(cut?'接':'断'):mandatory?`${weight} 旧桥`:String(weight)));
   if(edgeMode){control.disabled=s.finished;control.setAttribute('aria-label',`${l.nodes[a][0]} 到 ${l.nodes[b][0]}，${l.kind==='cut'?(cut?'恢复':'切断'):mandatory?'旧桥，必须保留':`造价 ${weight}，${selected?'拆除':'修建'}`}`);control.onclick=()=>act('edge',{index:i});}
   $('edge-controls').append(control);
  }
 });
 l.nodes.forEach((node,n)=>{
  const current=['euler','route'].includes(l.kind)&&n===s.current,confirmed=s.confirmed.includes(n);
  const control=el(edgeMode?'div':'button','map-node'+(current?' current':'')+(confirmed?' confirmed':'')+(l.kind==='color'&&s.colors[n]!==undefined?' marked':''));
  control.dataset.node=n;control.dataset.focus='node-'+n;control.style.left=pos[n][0]+'px';control.style.top=pos[n][1]+'px';
  control.append(el('span','node-name',labels[l.kind][n]));
  if(l.kind!=='route')control.append(el('span','node-id',node[0]));
  let label=`${node[0]} ${labels[l.kind][n]}`;
  if(l.kind==='dijkstra'){
   control.append(el('span','node-badge',number(s.distances[n])+(confirmed?' ✓':'')));label+=`，距离 ${number(s.distances[n])}，${confirmed?'已确认':'暂定'}`;
   const update=s.updates.find(u=>u[0]===n);if(update)control.append(el('span','node-update',`${number(update[1])} → ${update[2]}`));
  }
  if(l.kind==='color'&&s.colors[n]!==undefined){const mark=el('span','island-mark');mark.append(markSymbol(s.colors[n]));control.append(mark);label+=`，标记 ${s.colors[n]+1}`;}
  if(current)label+='，当前位置';
  if(!edgeMode){control.disabled=s.finished;control.setAttribute('aria-label',label);control.onclick=()=>act('node',{index:n,color});}
  $('nodes').append(control);
 });
}
function closeDialog(){$('dialog').close();}
function p(text,cls=''){return el('p',cls,text);}
function modal(eyebrow,title,body,actions){
 $('dialog-eyebrow').textContent=eyebrow;$('dialog-title').textContent=title;$('dialog-body').replaceChildren(...body);$('dialog-actions').replaceChildren();
 actions.forEach(([label,fn,primary])=>{const b=el('button',primary?'primary':'',label);b.onclick=fn;$('dialog-actions').append(b);});
 if(!$('dialog').open)$('dialog').showModal();$('dialog-actions').lastElementChild?.focus();
}
function reset(){if(model.history&&!model.state.finished)modal('重来','重新出发？',[p('清空本关操作，保留星星。')],[['取消',closeDialog],['重来',()=>act('reset'),true]]);else act('reset');}
function showResult(){
 const end=model.index===9||model.levels[model.index+1].chapter!==model.level.chapter;
 const title={euler:'全部送达',route:'快递到了',dijkstra:'导航完成',mst:'全村接通',color:'灯会开幕',cut:'成功断联'}[model.level.kind];
 const medal=el('div','medal');medal.append(el('span','',String(model.state.stars)),el('small','','/ 3 星'));
 modal(`第 ${String(model.index+1).padStart(2,'0')} 关`,title,[medal,p(model.message,'lead'),...(model.save_error?[p(model.save_error)]:[])],[['再挑战',()=>act('reset')],[end?'本章发现 →':'下一关 →',end?showSummary:()=>act('level',{index:model.index+1}),true]]);
}
function showSummary(){
 const c=model.chapters[model.level.chapter];modal('本章发现',c[2],[p(c[3],'lead'),p(c[4])],[['选关',showHome],[model.index===9?'查看成绩 →':'下一章 →',model.index===9?showJourney:()=>act('level',{index:model.index+1}),true]]);
}
function showJourney(){const count=model.progress.stars.filter(Boolean).length;modal('旅程',count===10?'十关，完成。':'继续挑战。',[p(`${count} / 10 关`,'lead'),p(`${model.progress.stars.reduce((a,b)=>a+b,0)} / 30 星`,'medal')],[['返回选关',showHome,true]]);}
function showHelp(){modal('玩法',model.level.title,[p(objectives[model.index],'lead'),p(helpNotes[model.level.kind]),p('Tab / 方向键选目标 · Enter 操作\nCtrl+Z 撤销 · Ctrl+R 重来 · 1–5 选标记','help-keys')],[['明白了',closeDialog,true]]);}
function showNotebook(){const c=model.chapters[bookPage];modal(`${bookPage+1} / 5`,c[2],[p(c[3],'lead'),p(c[4])],[['上一页',()=>{bookPage=(bookPage+4)%5;showNotebook();}],['下一页',()=>{bookPage=(bookPage+1)%5;showNotebook();}],['关闭',closeDialog,true]]);}
function showMenu(){
 const soundButton=el('button','menu-row',`声音${model.progress.sound?' 开':' 关'}`);soundButton.setAttribute('aria-pressed',String(model.progress.sound));soundButton.onclick=async()=>{await act('settings',{sound:!model.progress.sound});showMenu();};
 const notes=el('button','menu-row','知识手记');notes.onclick=()=>{bookPage=model.level.chapter;showNotebook();};
 modal('菜单','休息一下',[soundButton,notes],[['返回',closeDialog],['退出游戏',quit]]);
}
function quit(){modal('退出','下次再玩？',[p('星星已保存。')],[['继续玩',closeDialog],['退出',async()=>{try{await request('api/quit',{});modal('已保存','下次见。',[p('可以关闭窗口。')],[]);window.close();}catch{modal('连接已结束','可以关闭窗口',[],[]);}},true]]);}
$('back').onclick=showHome;$('continue').onclick=()=>{if(model.state.finished)act('reset');else resume();};$('help').onclick=showHelp;$('menu').onclick=showMenu;
$('dialog-close').onclick=closeDialog;$('undo').onclick=()=>act('undo');$('reset').onclick=reset;$('hint').onclick=()=>act('hint');$('submit').onclick=()=>model.state.finished?showResult():act('submit');
document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||button.disabled)return;button.classList.add('clicked');setTimeout(()=>button.classList.remove('clicked'),120);});
document.addEventListener('keydown',e=>{
 if(!model||$('dialog').open||screen!=='play'||busy)return;
 if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();act('undo');}
 else if(e.ctrlKey&&e.key.toLowerCase()==='r'){e.preventDefault();reset();}
 else if(!e.ctrlKey&&model.level.kind==='color'&&/^[1-5]$/.test(e.key))chooseColor(Number(e.key)-1);
 else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&$('board').contains(document.activeElement)){
  const targets=[...$('board').querySelectorAll('button:not(:disabled)')];if(!targets.length)return;e.preventDefault();const i=targets.indexOf(document.activeElement),step=['ArrowLeft','ArrowUp'].includes(e.key)?-1:1;targets[(i+step+targets.length)%targets.length].focus();
 }
});
new ResizeObserver(()=>{const key=document.activeElement?.dataset.focus;draw();if(key&&(key.startsWith('node-')||key.startsWith('edge-')))document.querySelector(`[data-focus="${key}"]`)?.focus({preventScroll:true});}).observe($('board'));
setInterval(()=>fetch('api/ping').catch(()=>{}),15000);
request('api/state').then(data=>{model=data;chapter=model.level.chapter;render();}).catch(()=>{modal('无法启动','连接已断开',[p('请关闭窗口，重新运行 GraphLab.exe。')],[]);});
