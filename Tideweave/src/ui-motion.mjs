let lastView=null;
export function syncMotion(enabled) {
  document.documentElement.dataset.motion=enabled?'full':'reduced';
  if(!enabled)document.getAnimations().forEach(a=>a.cancel());
}
export function captureUI(root) {
  const focus=document.activeElement;
  const navigation=focus?.matches(':focus-visible')?['chapter','campaignTab','selectLevel'].find(key=>key in focus.dataset):null;
  return {view:lastView,chapterScroll:root.querySelector('.tw-chapters')?.scrollLeft??0,
    focus:navigation?{key:navigation,value:focus.dataset[navigation]}:null};
}
export function animateUI(root,previous,view,reduced) {
  lastView={...view};
  const chapters=root.querySelector('.tw-chapters');
  if(chapters)chapters.scrollLeft=previous.chapterScroll;
  if(previous.focus&&!view.modal){
    const attr=previous.focus.key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
    root.querySelector(`[data-${attr}="${CSS.escape(previous.focus.value)}"]`)?.focus({preventScroll:true});
  }
  if(reduced)return;
  const old=previous.view;
  const enter=(selector,distance=12)=>root.querySelectorAll(selector).forEach((el,i)=>el.animate(
    [{opacity:0,transform:`translateY(${distance}px)`},{opacity:1,transform:'translateY(0)'}],
    {duration:360,delay:Math.min(i*45,160),easing:'cubic-bezier(.2,.7,.2,1)'}));
  // Renders during puzzle edits and replay frames must never replay page entrances.
  if(!old||old.screen!==view.screen||(view.screen==='game'&&old.level!==view.level)) {
    if(view.screen==='home')enter('.tw-home-title,.tw-continue,.tw-menu-panel,.tw-home-options');
    else if(view.screen==='map')enter('.tw-campaign-summary,.tw-route-unit,.tw-deployment');
    else enter('.tw-mission-ident,.tw-task-copy',6);
  } else if(view.screen==='map') {
    if(old.chapter!==view.chapter||old.tab!==view.tab)enter('.tw-chapter-copy,.tw-route-unit,.tw-deployment');
    else if(old.selected!==view.selected)enter('.tw-deployment',8);
    if(old.chapter!==view.chapter)enter('.tw-chapters .active .tw-chapter-number',5);
  }
  if(view.modal&&old?.modal!==view.modal)enter('.tw-dialog',10);
}
