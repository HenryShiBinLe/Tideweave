import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {serve} from './preview.mjs';
import {levels,levelById} from '../src/levels.mjs';
import {fresh,recordAttempt} from '../src/progress.mjs';
import {solution,evaluate} from '../src/engine.mjs';
import {selectMission} from './ui-navigation.mjs';

await fs.mkdir('verification',{recursive:true});
const server=await serve(),url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
const errors=[],layouts=[],entryFrames=[];page.on('pageerror',e=>errors.push(e.message));
const seed=fresh();seed.settings.sound=false;
for(const level of levels){const state=solution(level);recordAttempt(seed,level,state,evaluate(level,state));delete seed.records[level.id].state;}
const settle=async()=>{await page.waitForFunction(()=>!document.documentElement.dataset.pageTransition);await page.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished));});};
const click=s=>page.evaluate(s=>document.querySelector(s).dispatchEvent(new MouseEvent('click',{bubbles:true})),s);
const geometry=()=>page.evaluate(()=>{
  const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();
  const card=document.querySelector('.tw-deployment'),b=card.getBoundingClientRect();
  const outside=[...card.querySelectorAll('h2,p,.tw-deployment-badge,[data-action=deploy]')].filter(el=>{
    const r=el.getBoundingClientRect();return r.bottom>b.bottom+1||r.right>b.right+1||el.scrollWidth>el.clientWidth+1;
  }).map(el=>el.textContent.trim());
  return {width:innerWidth,height:innerHeight,documentHeight:document.documentElement.scrollHeight,documentWidth:document.documentElement.scrollWidth,
    list:rect('.tw-route-map'),card:b.toJSON(),button:rect('[data-action=deploy]'),header:rect('.tw-header'),outside};
});
try{
  await page.goto(url);await page.evaluate(data=>localStorage.setItem('tideweave-progress',JSON.stringify(data)),seed);await page.reload();await settle();
  assert.equal(await page.locator('.tw-home-seal').evaluate(el=>getComputedStyle(el).transform),'none','home seal is upright');
  await page.screenshot({path:'verification/shell-home.png'});
  await page.locator('[data-action=campaign]').click();
  for(const viewport of [{width:1920,height:1080},{width:1440,height:900},{width:1280,height:720},{width:900,height:620},{width:720,height:580},{width:390,height:844},{width:320,height:620}]){
    await page.setViewportSize(viewport);
    for(const level of levels){
      await click(`[data-chapter="${level.chapter}"]`);
      await click(`[data-campaign-tab="${level.optional?'optional':'main'}"]`);
      await click(`[data-select-level="${level.id}"]`);
      const g=await geometry(),name=`${viewport.width}x${viewport.height} ${level.id}`;
      if(g.documentHeight>g.height+1||g.card.bottom>g.height+1||g.outside.length){await page.screenshot({path:'verification/shell-error.png',fullPage:true});console.log(JSON.stringify({name,...g}));}
      assert.ok(g.documentHeight<=g.height+1,`${name}: page must not scroll`);
      assert.ok(g.documentWidth<=g.width+1,`${name}: no horizontal overflow`);
      assert.ok(g.card.bottom<=g.height+1&&g.button.bottom<=g.height+1,`${name}: deployment always visible`);
      assert.ok(g.list.height>=65,`${name}: mission list remains usable`);
      assert.deepEqual(g.outside,[],`${name}: card text and button stay inside`);
      layouts.push({name,listHeight:g.list.height,cardHeight:g.card.height});
    }
    await selectMission(page,'01-04.2');await settle();
    await page.screenshot({path:`verification/shell-campaign-${viewport.width}.png`});
  }
  await page.setViewportSize({width:1440,height:900});await selectMission(page,'01-04.2');await settle();
  const before=await geometry();
  await page.locator('.tw-route-map').hover();await page.mouse.wheel(0,1500);await page.waitForTimeout(150);
  const scroll=await page.locator('.tw-route-map').evaluate(el=>el.scrollTop),after=await geometry();
  assert.ok(scroll>0);assert.equal(before.header.y,after.header.y);assert.deepEqual(before.card,after.card);
  await click('[data-select-level="01-04.1"]');
  assert.equal(await page.locator('.tw-route-map').evaluate(el=>el.scrollTop),scroll,'selecting a level keeps list position');
  await page.emulateMedia({reducedMotion:'no-preference'});
  const frames=await page.evaluate(async()=>{
    const frames=[];document.querySelector('[data-action=deploy]').click();
    for(let i=0;i<40;i++){
      await new Promise(requestAnimationFrame);const game=document.querySelector('.tw-game');
      if(game)frames.push({width:game.getBoundingClientRect().width,height:game.getBoundingClientRect().height,scroll:document.documentElement.scrollHeight,group:getComputedStyle(document.documentElement,'::view-transition-group(root)').animationName});
    }
    return frames;
  });
  assert.ok(frames.length>10);
  for(const f of frames){assert.equal(f.width,1440);assert.equal(f.height,900);assert.equal(f.scroll,900);assert.equal(f.group,'none');}
  entryFrames.push(...frames);
  await page.locator('.tw-mission-head [data-action=home]').click();await settle();
  assert.equal(await page.locator('.tw-route-map').evaluate(el=>el.scrollTop),scroll,'return from game restores mission list position');
  for(const id of ['04-01.4','04-02.2']){
    await selectMission(page,id);await page.locator('[data-action=deploy]').click();await settle();
    const colors=solution(levelById[id]).colors;
    if(id==='04-02.2'){await page.locator('[data-action=net]').click();await settle();}
    for(const [i,color] of colors.entries()){await click(`[data-tool="${color}"]`);await click(`[data-node="${i}"]`);}
    await settle();
    await page.screenshot({path:`verification/palette-${id}.png`});
    if(id==='04-02.2'){
      await page.locator('[data-action=solid]').click();await page.locator('#tw-solid canvas[data-surface=loaded]').waitFor();await settle();
      await page.screenshot({path:'verification/palette-solid.png'});
    }
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(data=>localStorage.setItem('tideweave-progress',JSON.stringify(data)),fresh());await page.reload();
  await page.locator('[data-action=campaign]').click();
  for(const viewport of [{width:1280,height:720},{width:720,height:580},{width:320,height:620}]){
    await page.setViewportSize(viewport);
    for(const level of levels.filter(level=>level.optional||level.goal.length>35)){
      await click(`[data-chapter="${level.chapter}"]`);await click(`[data-campaign-tab="${level.optional?'optional':'main'}"]`);await click(`[data-select-level="${level.id}"]`);
      const g=await geometry();
      if(g.outside.length)await page.screenshot({path:'verification/shell-locked-error.png'});
      assert.ok(g.card.bottom<=g.height+1&&g.button.bottom<=g.height+1,`locked ${level.id}: always visible`);
      assert.deepEqual(g.outside,[],`locked ${viewport.width} ${level.id}: unlock reason and goal fit`);
    }
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile('verification/campaign-shell-results.json',JSON.stringify({pass:true,layouts,entryFrames,scrollRestored:true,errors},null,2));
  console.log(`PASS: ${layouts.length} fixed-shell layouts, scroll isolation and restoration, stable entry frames, upright seal and painted previews.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
