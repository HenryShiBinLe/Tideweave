let lastView=null;
let modalOrigin=null;
let pageTransition=null;
let renderRevision=0;
const routePositions=new Map();
const routeKey=view=>`${view.chapter}:${view.tab}`;
const ease='cubic-bezier(.22,.75,.24,1)';
const keys=['edge','node','pair','tool','target','mode','action'];
const paintParts={
  '.edge-line':['stroke','strokeWidth'],
  '.edge-selection-rim':['opacity'],
  '.weight-plate':['fill','stroke'],
  '.weight-register':['stroke'],
  '.weight text':['fill'],
  '.station-body':['fill','stroke','strokeWidth'],
  '.station-base':['fill','stroke'],
  '.station-selection':['opacity','fill','stroke'],
  '.station-group-surface':['fill'],
  'polygon':['fill','stroke'],
};
const values=(el,properties,pseudo)=>{
  const style=getComputedStyle(el,pseudo);
  return Object.fromEntries(properties.map(key=>[key,style[key]]));
};
function snapshotControls(root) {
  const snapshots=new Map();
  root.querySelectorAll('.tw-board [data-node],.tw-board [data-edge],[data-pair],.tw-context-tools button').forEach(el=>{
    const key=keys.find(key=>key in el.dataset);
    if(!key)return;
    const parts={};
    if(el.tagName==='BUTTON')parts.self=values(el,['backgroundColor','borderColor','boxShadow','outlineWidth','outlineOffset','outlineColor']);
    for(const [selector,properties] of Object.entries(paintParts)){
      const part=el.querySelector(selector);
      if(part)parts[selector]=values(part,properties);
    }
    snapshots.set(`${key}:${el.dataset[key]}`,{signature:el.outerHTML,parts});
  });
  return snapshots;
}
function tween(el,frames,options={}) {
  return el.animate(frames,{duration:240,easing:ease,...options});
}
export function renderUI(previous,view,reduced,commit) {
  const revision=++renderRevision;
  pageTransition?.skipTransition();
  pageTransition=null;
  delete document.documentElement.dataset.pageTransition;
  const navigate=previous&&(previous.screen!==view.screen||
    view.screen==='game'&&previous.level!==view.level||
    view.screen==='map'&&(previous.chapter!==view.chapter||previous.tab!==view.tab));
  const update=()=>{if(revision===renderRevision)commit();};
  if(reduced||!navigate||!document.startViewTransition){update();return Promise.resolve();}
  const returning=view.screen==='home'||previous.screen==='game'&&view.screen==='map';
  document.documentElement.dataset.navigation=returning?'back':'forward';
  document.documentElement.dataset.pageTransition='pending';
  // Native snapshots retain canvas content while the next screen replaces its renderer.
  const transition=document.startViewTransition(update);
  pageTransition=transition;
  transition.ready.then(()=>{
    if(pageTransition===transition)document.documentElement.dataset.pageTransition='active';
  }).catch(()=>{});
  transition.finished.catch(()=>{}).finally(()=>{
    if(pageTransition===transition){pageTransition=null;delete document.documentElement.dataset.pageTransition;}
  });
  return transition.updateCallbackDone;
}
export function syncMotion(enabled) {
  document.documentElement.dataset.motion=enabled?'full':'reduced';
  if(!enabled)document.getAnimations().forEach(a=>a.cancel());
}
export function captureUI(root) {
  const route=root.querySelector('.tw-route-map');
  if(route&&lastView?.screen==='map')routePositions.set(routeKey(lastView),route.scrollTop);
  const focus=document.activeElement;
  const navigation=focus?.matches(':focus-visible,[data-setting]')?['chapter','campaignTab','selectLevel','setting'].find(key=>key in focus.dataset):null;
  const settings=new Map([...root.querySelectorAll('input[type=checkbox]')].map(el=>[el.dataset.setting,{
    track:values(el,['backgroundColor']),thumb:values(el,['transform'],'::before')
  }]));
  return {view:lastView,chapterScroll:root.querySelector('.tw-chapters')?.scrollLeft??0,
    dialogScroll:root.querySelector('dialog')?.scrollTop??0,settings,
    controls:lastView?.screen==='game'&&!lastView.replay?snapshotControls(root):new Map(),
    metric:root.querySelector('.tw-context-tools output')?.textContent,
    activeAction:focus?.dataset.action,
    focus:navigation?{key:navigation,value:focus.dataset[navigation]}:null};
}
// Only the dialog waits for its short exit; puzzle edits remain synchronous.
export async function dismissDialog(dialog,reduced) {
  if(!dialog||reduced)return true;
  if(dialog.dataset.closing)return false;
  dialog.dataset.closing='true';
  dialog.inert=true;
  const current=values(dialog,['opacity','transform']);
  const exit=tween(dialog,[current,{opacity:0,transform:'translateY(6px) scale(.99)'}],{duration:140,fill:'forwards'});
  tween(dialog,[{opacity:1},{opacity:0}],{duration:140,fill:'forwards',pseudoElement:'::backdrop'});
  await exit.finished.catch(()=>{});
  return dialog.isConnected;
}
function animateControls(root,previous) {
  const current=snapshotControls(root);
  for(const [key,next] of current){
    const old=previous.controls.get(key);
    if(!old)continue;
    const colon=key.indexOf(':'),attr=key.slice(0,colon),value=key.slice(colon+1);
    const el=root.querySelector(`[data-${attr}="${CSS.escape(value)}"]`);
    for(const [selector,end] of Object.entries(next.parts)){
      const start=old.parts[selector],part=selector==='self'?el:el.querySelector(selector);
      if(!start||!part||JSON.stringify(start)===JSON.stringify(end))continue;
      // Texture paints are SVG patterns, so reveal the new surface without morphing URLs.
      if(Object.values(end).some(value=>String(value).includes('url(')))tween(part,[{opacity:.66},{opacity:1}],{duration:180});
      else tween(part,[start,end],{duration:210});
    }
    if(old.signature!==next.signature){
      el.querySelectorAll('.station-status,.station-group-badge,.station-source-marker').forEach(part=>{
        tween(part,[{opacity:0},{opacity:getComputedStyle(part).opacity}],{duration:200});
      });
      if(el.matches('.tw-segment .selected'))tween(el,[{transform:'scaleX(.25)'},{transform:'scaleX(1)'}],{pseudoElement:'::after'});
      if(el.matches('.tw-swatch.active'))tween(el,[{opacity:0,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{pseudoElement:'::after'});
    }
  }
  const metric=root.querySelector('.tw-context-tools output');
  if(metric&&previous.metric!==metric.textContent)tween(metric.querySelector('strong')??metric,
    [{opacity:.45,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:190});
}
export function animateUI(root,previous,view,reduced) {
  lastView={...view};
  const chapters=root.querySelector('.tw-chapters');
  if(chapters)chapters.scrollLeft=previous.chapterScroll;
  const old=previous.view,dialog=root.querySelector('dialog');
  const route=root.querySelector('.tw-route-map');
  if(route)route.scrollTop=routePositions.get(routeKey(view))??0;
  if(view.modal&&!old?.modal)modalOrigin=previous.activeAction;
  if(!view.modal&&old?.modal){
    if(modalOrigin&&old.screen===view.screen&&old.level===view.level)
      root.querySelector(`[data-action="${CSS.escape(modalOrigin)}"]`)?.focus({preventScroll:true});
    modalOrigin=null;
  }
  if(dialog&&old?.modal===view.modal)dialog.scrollTop=previous.dialogScroll;
  if(previous.focus&&(!view.modal||old?.modal===view.modal)){
    const attr=previous.focus.key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
    root.querySelector(`[data-${attr}="${CSS.escape(previous.focus.value)}"]`)?.focus({preventScroll:true});
  }
  if(reduced)return;
  const enter=(selector,distance=10,axis='Y',delay=0)=>root.querySelectorAll(selector).forEach((el,i)=>tween(el,
    [{opacity:0,transform:`translate${axis}(${distance}px)`},{opacity:1,transform:`translate${axis}(0)`}],
    {duration:300,delay:delay+Math.min(i*30,120),fill:'backwards'}));
  // Renders during puzzle edits and replay frames must never replay page entrances.
  if(!old||old.screen!==view.screen||(view.screen==='game'&&old.level!==view.level)) {
    if(view.screen==='home')enter('.tw-home-title,.tw-continue,.tw-menu-panel,.tw-home-options');
    else if(view.screen==='map'){
      enter('.tw-campaign-heading,.tw-chapters,.tw-campaign-summary,.tw-route-toolbar',8);
      enter('.tw-route-unit',10,'Y',60);
      enter('.tw-deployment',14,'X',80);
    } else {
      enter('.tw-mission-ident,.tw-task-copy',6);
      enter('.tw-board',0,'Y',40);
      enter('.tw-context-tools,.tw-operation',6,'Y',60);
    }
  } else if(view.screen==='map') {
    if(old.chapter!==view.chapter||old.tab!==view.tab){
      const direction=old.chapter>view.chapter?-1:1;
      enter('.tw-chapter-copy,.tw-route-unit',direction*12,'X');
      enter('.tw-deployment',10,'X',40);
    } else if(old.selected!==view.selected)enter('.tw-deployment',10,'X');
    if(old.chapter!==view.chapter){
      enter('.tw-chapters .active .tw-chapter-number',4);
      const active=root.querySelector('.tw-chapters .active');
      if(active)tween(active,[{transform:'scaleX(.1)'},{transform:'scaleX(1)'}],{pseudoElement:'::after'});
    }
    if(old.tab!==view.tab){
      const selected=root.querySelector('.tw-segment .selected');
      if(selected)tween(selected,[{transform:'scaleX(.25)'},{transform:'scaleX(1)'}],{pseudoElement:'::after'});
    }
  } else if(!old.modal&&!view.modal&&!old.replay&&!view.replay) {
    animateControls(root,previous);
    if(old.net!==view.net)enter('.tw-board',0);
  }
  if(dialog&&old?.modal!==view.modal){
    tween(dialog,[{opacity:0,transform:'translateY(12px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:280});
    tween(dialog,[{opacity:0},{opacity:1}],{duration:240,pseudoElement:'::backdrop'});
    enter('.tw-dialog>h2,.tw-dialog>p,.tw-dialog>label,.tw-dialog>div',4,'Y',35);
  } else if(dialog){
    root.querySelectorAll('input[type=checkbox]').forEach(el=>{
      const prior=previous.settings.get(el.dataset.setting);
      if(!prior)return;
      const track=values(el,['backgroundColor']),thumb=values(el,['transform'],'::before');
      if(prior.track.backgroundColor!==track.backgroundColor){
        tween(el,[prior.track,track],{duration:180});
        tween(el,[prior.thumb,thumb],{duration:180,pseudoElement:'::before'});
      }
    });
  }
}
