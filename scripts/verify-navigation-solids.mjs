import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {serve} from './preview.mjs';
import {selectMission} from './ui-navigation.mjs';
import {levels,levelById} from '../src/levels.mjs';
import {solids} from '../src/solids.mjs';
import {assetManifest,chapterSceneKeys} from '../src/assets.mjs';
import {fresh,recordAttempt} from '../src/progress.mjs';
import {solution,evaluate} from '../src/engine.mjs';

await fs.mkdir('verification',{recursive:true});
const server=await serve(),url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
const errors=[],transitions=[],backgrounds=[],faces=[];
page.on('pageerror',e=>errors.push(e.message));
const seed=fresh();
for(const l of levels){const s=solution(l);recordAttempt(seed,l,s,evaluate(l,s));delete seed.records[l.id].state;}
seed.settings.sound=false;
const settle=async()=>{
  await page.waitForFunction(()=>!document.documentElement.dataset.pageTransition);
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished));});
};
const dispatch=selector=>page.evaluate(s=>document.querySelector(s).dispatchEvent(new MouseEvent('click',{bubbles:true})),selector);
async function navigate(selector,name){
  await settle();await dispatch(selector);
  await page.waitForFunction(()=>document.documentElement.dataset.pageTransition==='active');
  const motion=await page.evaluate(()=>({direction:document.documentElement.dataset.navigation,animations:document.getAnimations().map(a=>a.animationName).filter(n=>n?.startsWith('tw-page-'))}));
  assert.ok(motion.animations.includes('tw-page-leave'),`${name}: outgoing frame fades`);
  assert.ok(motion.animations.includes(motion.direction==='back'?'tw-page-return':'tw-page-arrive'),`${name}: incoming frame moves`);
  transitions.push({name,...motion});await settle();
}
try{
  await page.goto(url);await page.evaluate(p=>localStorage.setItem('tideweave-progress',JSON.stringify(p)),seed);await page.reload();await settle();
  assert.equal(await page.locator('.tw-home-options .tw-control-detail').count(),0);
  await navigate('[data-action="campaign"]','home to chapter selection');
  for(const chapter of [2,3,4,5,1]){
    await navigate(`[data-chapter="${chapter}"]`,`chapter ${chapter}`);
    const image=page.locator('.tw-campaign-scene');await image.evaluate(el=>el.decode());
    assert.equal(await image.getAttribute('src'),assetManifest[chapterSceneKeys[chapter]].path);
    backgrounds.push(await image.getAttribute('src'));
    await page.locator('.tw-campaign-summary').screenshot({path:`verification/chapter-panorama-${chapter}.png`});
  }
  assert.equal(new Set(backgrounds).size,5);
  await navigate('[data-campaign-tab="optional"]','main to optional');
  await navigate('[data-campaign-tab="main"]','optional to main');
  await page.locator('[data-select-level="01-01.1"]').click();await settle();
  const detail=await page.locator('.tw-deployment .tw-btn.primary').evaluate(el=>{
    const a=el.querySelector('span').getBoundingClientRect(),b=el.querySelector('.tw-control-detail').getBoundingClientRect();
    return {width:b.width,gap:b.left-a.right};
  });
  assert.ok(detail.width>=70&&detail.gap>8,'large deployment motif is clear of the label');
  await navigate('[data-action="deploy"]','enter level');
  await dispatch('[data-node="0"]');
  assert.equal(await page.locator('html').getAttribute('data-page-transition'),null,'puzzle changes remain immediate');
  await navigate('.tw-mission-head [data-action="home"]','leave level');
  await page.evaluate(()=>{for(const id of [2,4,5])document.querySelector(`[data-chapter="${id}"]`).click();});
  await settle();
  assert.equal(await page.locator('.tw-chapters [aria-current="page"]').getAttribute('data-chapter'),'5','rapid navigation keeps the last choice');

  for(const id of ['04-02.1','04-02.2','04-02.3']){
    await selectMission(page,id);await page.locator('[data-action="deploy"]').click();await settle();
    const spec=solids[levelById[id].solid];
    for(let i=0;i<spec.faces.length;i++){
      await page.locator('#tw-solid canvas[data-surface="loaded"]').waitFor();
      await page.selectOption('[data-face]',String(i));await page.waitForTimeout(310);
      await page.mouse.move(0,0);await page.waitForTimeout(190);
      const before=await page.locator('#tw-solid canvas').evaluate(c=>c.toDataURL());
      const color=i%4;
      await page.locator(`[data-tool="${color}"]`).click();
      await page.locator('#tw-solid canvas[data-surface="loaded"]').waitFor();await settle();
      assert.equal(await page.locator('#tw-solid canvas').evaluate(c=>c.toDataURL()),before,`${id} face ${i}: tool change keeps the focused orientation`);
      const box=await page.locator('#tw-solid canvas').boundingBox();
      await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
      await page.waitForFunction(({id,i,color})=>JSON.parse(localStorage.getItem('tideweave-progress')).records[id].state.colors[i]===color,{id,i,color});
      await page.locator('#tw-solid canvas[data-surface="loaded"]').waitFor();
      if(i===0||i===spec.faces.length-1)await page.screenshot({path:`verification/solid-readable-${id}-${i}.png`});
      faces.push({id,face:i,paintable:true});
    }
    await page.setViewportSize({width:390,height:844});await settle();
    const nonblank=await page.locator('#tw-solid canvas').evaluate(c=>{
      const canvas=document.createElement('canvas');canvas.width=c.width;canvas.height=c.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(c,0,0);
      return ctx.getImageData(0,0,c.width,c.height).data.filter((v,i)=>i%4===3&&v>0).length;
    });
    assert.ok(nonblank>1000,`${id}: visible on narrow screens`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`verification/solid-readable-mobile-${id}.png`});
    await page.setViewportSize({width:1440,height:900});await settle();
  }
  await navigate('.tw-mission-head [data-action="home"]','solid to chapters');
  await page.setViewportSize({width:390,height:844});await settle();
  await page.screenshot({path:'verification/chapter-panorama-mobile.png',fullPage:true});
  await navigate('.tw-campaign-heading [data-action="title-home"]','chapters to home');
  await page.emulateMedia({reducedMotion:'reduce'});
  await dispatch('[data-action="campaign"]');
  assert.equal(await page.locator('html').getAttribute('data-page-transition'),null);
  assert.ok(await page.locator('.tw-campaign').count(),'reduced motion switches immediately');
  assert.deepEqual(errors,[]);
  await fs.writeFile('verification/navigation-solids-results.json',JSON.stringify({pass:true,transitions,backgrounds,faces,errors},null,2));
  console.log(`PASS: ${transitions.length} complete page transitions, 5 chapter panoramas, ${faces.length} focused/paintable faces, orientation retained on redraw, narrow screens, reduced motion.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
