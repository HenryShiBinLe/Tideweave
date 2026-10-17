import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {serve} from './preview.mjs';
import {uiClick,selectMission} from './ui-navigation.mjs';
import {levels,levelById,legacyLevelById} from '../src/levels.mjs';
import {fresh,recordAttempt} from '../src/progress.mjs';
import {solution,evaluate} from '../src/engine.mjs';

const server=await serve(),url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const click=s=>uiClick(page,s);
const seed=fresh();seed.settings.motion=false;
for(const l of levels){const s=solution(l);recordAttempt(seed,l,s,evaluate(l,s));delete seed.records[l.id].state;}
const load=async p=>{await page.evaluate(p=>localStorage.setItem('tideweave-progress',JSON.stringify(p)),p);await page.reload();};
const pixelCount=canvas=>canvas.evaluate(c=>{
  const copy=document.createElement('canvas');copy.width=c.width;copy.height=c.height;const ctx=copy.getContext('2d');ctx.drawImage(c,0,0);
  const d=ctx.getImageData(0,0,c.width,c.height).data;let count=0;for(let i=3;i<d.length;i+=4)if(d[i])count++;return count;
});
try{
  await page.goto(url);
  for(const viewport of [{width:1440,height:900},{width:1280,height:720},{width:390,height:844},{width:390,height:620}]){
    await page.setViewportSize(viewport);
    const boxes=await page.evaluate(()=>['.tw-home-title','.tw-home-menu','.tw-home-status'].map(sel=>{const r=document.querySelector(sel).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i],b=boxes[j];assert.ok(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y,'home controls must not overlap');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`verification/overhaul-home-${viewport.width}-${viewport.height}.png`,fullPage:true});
  }
  await click('[data-action="resume"]');assert.match(await page.locator('.tw-mission-head').innerText(),/01-01.1/);
  await click('.tw-mission-head [data-action="home"]');
  await selectMission(page,'01-01.2');assert.ok(await page.locator('[data-action="deploy"]').isDisabled());
  assert.match(await page.locator('.tw-lock-reason').innerText(),/找到相通站点/);
  await load(seed);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await selectMission(page,'03-03.3');
    await page.screenshot({path:`verification/overhaul-campaign-${width}.png`,fullPage:true});
    await click('[data-action="deploy"]');assert.match(await page.locator('.tw-task h2').innerText(),/不需要.*所有任务/);
    await click('[data-action="reset"]');await click('[data-action="confirm-reset"]');
    for(const n of [1,2,3,1])await page.locator(`[data-node="${n}"]`).press('Enter');
    await click('[data-action="run"]');await page.waitForSelector('dialog');assert.match(await page.locator('dialog').innerText(),/联运有序/);
    await click('[data-action="close"]');await click('.tw-mission-head [data-action="home"]');
    for(const id of ['04-02.2','04-02.3']){
      await click(`[data-level="${id}"]`);
      const canvas=page.locator('#tw-solid canvas'),box=await canvas.boundingBox();assert.ok(await pixelCount(canvas)>1000);
      const before=await canvas.evaluate(c=>c.toDataURL());
      await page.mouse.move(box.x+box.width*.1,box.y+box.height*.2);await page.mouse.down();
      await page.mouse.move(box.x+box.width*.35,box.y+box.height*.32,{steps:12});await page.mouse.up();
      assert.notEqual(await canvas.evaluate(c=>c.toDataURL()),before,'solid must rotate');
      await canvas.click({position:{x:box.width/2,y:box.height/2}});
      const colors=await page.evaluate(id=>JSON.parse(localStorage.getItem('tideweave-progress')).records[id].state.colors,id);
      assert.equal(colors.filter(c=>c>=0).length,1,'drag must not paint; click paints one face');
      await page.screenshot({path:`verification/overhaul-${id}-solid-${width}.png`,fullPage:true});
      await click('[data-action="net"]');const painted=colors.findIndex(c=>c>=0);
      assert.match(await page.locator(`[data-node="${painted}"]`).getAttribute('aria-label'),/水青/);
      await page.screenshot({path:`verification/overhaul-${id}-net-${width}.png`,fullPage:true});
      await click('[data-action="reset"]');await click('[data-action="confirm-reset"]');await click('.tw-mission-head [data-action="home"]');
    }
    await click('[data-level="02-S1.2"]');
    const header=page.locator('.tw-floyd>p');await header.scrollIntoViewIfNeeded();assert.ok(await header.isVisible());
    assert.match(await header.innerText(),/原可中转：中站.*新增：东站/);
    await page.screenshot({path:`verification/overhaul-floyd-${width}.png`,fullPage:true});
    await click('.tw-mission-head [data-action="home"]');
  }
  const old=fresh();old.settings.motion=false;
  for(const l of Object.values(legacyLevelById)){const s=solution(l);recordAttempt(old,l,s,evaluate(l,s));}
  await load(old);await selectMission(page,'04-02.3');assert.match(await page.locator('.tw-mission-status').innerText(),/旧版已通关/);
  await click('[data-action="deploy"]');await click('[data-action="replay"]');
  assert.match(await page.locator('.tw-playback').innerText(),/旧版成绩已保留/);
  assert.deepEqual(errors,[]);
  await fs.writeFile('verification/overhaul-results.json',JSON.stringify({pass:true,homeSizes:4,solids:2,solidSizes:2,cycleSubset:true,legacyReplay:true,errors},null,2));
  console.log('Overhaul passed: home and campaign, locked preview, both solids at two sizes, Floyd labels, legacy replay.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
