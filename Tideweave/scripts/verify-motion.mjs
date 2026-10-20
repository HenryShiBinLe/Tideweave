import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {serve} from './preview.mjs';
import {selectMission} from './ui-navigation.mjs';
import {levels} from '../src/levels.mjs';
import {fresh,recordAttempt} from '../src/progress.mjs';
import {solution,evaluate} from '../src/engine.mjs';

await fs.mkdir('verification',{recursive:true});
const server=await serve(),url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
const errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(url))external.push(r.url());});
const settle=async()=>{await page.waitForFunction(()=>!document.documentElement.dataset.pageTransition);await page.evaluate(async()=>{
  await document.fonts.ready;
  await Promise.allSettled(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished));
});};
const clickNow=selector=>page.evaluate(selector=>document.querySelector(selector).dispatchEvent(new MouseEvent('click',{bubbles:true})),selector);
const open=async id=>{await selectMission(page,id);await page.locator('[data-action=deploy]').click();await settle();};
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tideweave-progress')));
const seed=fresh();
for(const level of levels){const s=solution(level);recordAttempt(seed,level,s,evaluate(level,s));delete seed.records[level.id].state;}
seed.settings.motion=true;
try{
  await page.goto(url);
  await page.evaluate(p=>localStorage.setItem('tideweave-progress',JSON.stringify(p)),seed);await page.reload();await settle();
  await clickNow('[data-action=campaign]');
  await page.locator('.tw-chapters').waitFor();
  assert.ok(await page.locator('.tw-chapters').evaluate(el=>el.getAnimations().length>0),'secondary navigation enters with the page');
  await settle();
  await page.locator('[data-chapter="2"]').hover();await settle();
  const motif=await page.locator('[data-chapter="2"]').evaluate(el=>getComputedStyle(el,'::before').transform);
  assert.notEqual(motif,'none','chapter motif responds within its control');
  await clickNow('[data-chapter="2"]');
  await page.locator('[data-chapter="2"][aria-current="page"]').waitFor();
  assert.ok(await page.locator('.tw-route-unit').first().evaluate(el=>el.getAnimations().length>0),'chapter content transitions');
  await settle();
  await clickNow('[data-campaign-tab=optional]');
  await page.locator('[data-campaign-tab=optional][aria-pressed=true]').waitFor();
  assert.ok(await page.locator('.tw-deployment').evaluate(el=>el.getAnimations().length>0),'secondary tab has a content transition');
  await settle();await page.screenshot({path:'verification/motion-chapter.png',fullPage:true});

  await page.locator('[data-action=settings]').focus();
  await clickNow('[data-action=settings]');
  const entry=await page.locator('dialog').evaluate(el=>el.getAnimations({subtree:true}).map(a=>({pseudo:a.effect.pseudoElement,duration:a.effect.getTiming().duration})));
  assert.ok(entry.some(a=>a.pseudo==='::backdrop'),'modal backdrop fades in');
  await settle();
  await page.locator('[data-setting=sound]').click();await settle();
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.setting),'sound','setting retains focus after redraw');
  await page.locator('dialog').evaluate(el=>{el.scrollTop=20;});
  await clickNow('.tw-dialog-close');
  assert.equal(await page.locator('dialog').getAttribute('data-closing'),'true','modal has an exit phase');
  assert.ok(await page.locator('dialog').evaluate(el=>el.inert),'exiting modal cannot trigger a second action');
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog',{state:'detached'});
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'settings','closing restores opener focus');
  await page.locator('[data-action=settings]').click();await settle();
  await page.keyboard.press('Escape');await page.waitForSelector('dialog',{state:'detached'});

  await open('03-01.2');await page.mouse.move(0,0);await settle();
  const road=page.locator('[data-edge="0"]'),line=road.locator('.edge-line');
  const normal=await line.evaluate(el=>getComputedStyle(el).stroke);
  await road.locator('.weight').hover();await settle();
  assert.notEqual(await line.evaluate(el=>getComputedStyle(el).stroke),normal,'road hover changes its line');
  const flow=road.locator('.edge-hover-flow');
  assert.ok(await flow.evaluate(el=>el.getAnimations().some(a=>a.effect.getTiming().iterations===Infinity)),'only hovered road has flowing inlay');
  const flowFrames=[];
  for(const time of [150,950]){
    await flow.evaluate((el,time)=>{const a=el.getAnimations().find(a=>a.effect.getTiming().iterations===Infinity);a.pause();a.currentTime=time;},time);
    flowFrames.push(await road.screenshot({path:`verification/motion-road-hover-${time}.png`}));
  }
  assert.notDeepEqual(flowFrames[0],flowFrames[1],'hover flow changes visible pixels');
  await page.mouse.move(0,0);await settle();
  assert.equal(await flow.evaluate(el=>getComputedStyle(el).opacity),'0','flow clears on pointer leave');
  const transition=await page.evaluate(()=>{
    document.querySelector('[data-edge="0"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const line=document.querySelector('[data-edge="0"] .edge-line');
    return {selected:line.closest('[data-edge]').getAttribute('aria-pressed'),frames:line.getAnimations().map(a=>a.effect.getKeyframes()),pageAnimations:document.querySelector('.tw-task-copy').getAnimations().length};
  });
  assert.equal(transition.selected,'true','selection is immediate, not delayed by animation');
  assert.ok(transition.frames.some(frames=>frames[0].stroke!==frames.at(-1).stroke),'selection interpolates previous and next paint');
  assert.equal(transition.pageAnimations,0,'editing does not restart page entry');
  await page.evaluate(()=>{for(const i of [0,0,2,4,4,4])document.querySelector(`[data-edge="${i}"]`).dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  await settle();
  assert.deepEqual((await state()).records['03-01.2'].state.selected,[0,2,4],'rapid edits are neither queued nor dropped');
  await page.locator('[data-action=undo]').click();await settle();
  assert.deepEqual((await state()).records['03-01.2'].state.selected,[0,2],'undo still removes exactly one edit');
  assert.equal(await page.locator('[data-edge="0"] .edge-line').evaluate(el=>getComputedStyle(el).stroke),'rgb(52, 122, 130)');
  await page.locator('[data-action=rules]').hover();await settle();
  await page.screenshot({path:'verification/motion-road-selected.png',fullPage:true});
  await page.locator('[data-action=rules]').click();await settle();
  await page.screenshot({path:'verification/motion-rules.png',fullPage:true});
  await page.locator('.tw-dialog-close').click();await page.waitForSelector('dialog',{state:'detached'});

  await open('04-01.1');await clickNow('[data-node="0"]');
  assert.ok(await page.locator('[data-node="0"] polygon').evaluate(el=>el.getAnimations().length>0),'textured region reveals its new color');
  await settle();
  await clickNow('[data-tool="2"]');
  assert.ok(await page.locator('[data-tool="2"]').evaluate(el=>el.getAnimations().length>0),'swatch selection transitions');
  await settle();
  await page.setViewportSize({width:390,height:844});await settle();
  await page.screenshot({path:'verification/motion-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'mobile has no horizontal overflow');

  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await open('04-02.2');
    await page.locator('#tw-solid canvas[data-surface=loaded]').waitFor();
    await page.mouse.move(0,0);await page.waitForTimeout(200);
    const canvas=page.locator('#tw-solid canvas'),box=await canvas.boundingBox();
    const pixels=await canvas.evaluate(c=>{const copy=document.createElement('canvas');copy.width=c.width;copy.height=c.height;const ctx=copy.getContext('2d');ctx.drawImage(c,0,0);return ctx.getImageData(0,0,c.width,c.height).data.filter((_,i)=>i%4===3).filter(a=>a>0).length;});
    assert.ok(pixels>1000,'solid is nonblank');
    const before=await canvas.evaluate(c=>c.toDataURL());
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(220);
    assert.equal(await canvas.evaluate(c=>c.style.cursor),'pointer','solid identifies a paintable face');
    assert.notEqual(await canvas.evaluate(c=>c.toDataURL()),before,'solid hover visibly highlights face');
    await page.mouse.move(0,0);await page.waitForTimeout(220);
    assert.equal(await canvas.evaluate(c=>c.toDataURL()),before,'solid hover fully clears');
    await page.selectOption('[data-face]','0');await page.waitForTimeout(80);
    const middle=await canvas.evaluate(c=>c.toDataURL());await page.waitForTimeout(240);
    assert.notEqual(await canvas.evaluate(c=>c.toDataURL()),middle,'focus face smoothly rotates');
    await page.screenshot({path:`verification/motion-solid-${width}.png`,fullPage:true});
  }

  await page.setViewportSize({width:1440,height:900});await open('03-01.2');
  await page.locator('[data-action=settings]').click();await settle();
  await page.locator('[data-setting=motion]').check();
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0,'app reduced-motion removes all animations');
  await page.locator('.tw-dialog-close').click();await page.waitForSelector('dialog',{state:'detached'});
  await page.locator('[data-edge="0"] .weight').hover();await clickNow('[data-edge="0"]');
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0,'reduced-motion board stays responsive and still');
  await page.locator('[data-action=settings]').click();await page.locator('[data-setting=motion]').uncheck();
  await page.locator('.tw-dialog-close').click();await page.waitForSelector('dialog',{state:'detached'});
  await page.emulateMedia({reducedMotion:'reduce'});
  await open('04-02.2');await page.locator('#tw-solid canvas[data-surface=loaded]').waitFor();await page.selectOption('[data-face]','1');
  const still=await page.locator('#tw-solid canvas').evaluate(c=>c.toDataURL());await page.waitForTimeout(100);
  assert.equal(await page.locator('#tw-solid canvas').evaluate(c=>c.toDataURL()),still,'system reduced-motion makes face focus immediate');
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await fs.writeFile('verification/motion-results.json',JSON.stringify({pass:true,secondaryViews:true,dialogExit:true,roadHover:true,rapidEdits:true,solidHover:true,reducedMotion:true,offline:true,errors},null,2));
  console.log('Motion passed: secondary views, modal enter/exit and focus, road flow and immediate edits, swatches/regions, mobile, solid hover/rotation, both reduced-motion settings, offline.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
