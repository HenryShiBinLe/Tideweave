import {uiClick,selectMission} from './ui-navigation.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {serve} from './preview.mjs';
import {levels,levelById,chapters} from '../src/levels.mjs';
import {fresh,recordAttempt} from '../src/progress.mjs';
import {solution,evaluate} from '../src/engine.mjs';

await fs.mkdir('verification',{recursive:true});
const server=await serve(),url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:940},reducedMotion:'reduce'});
const errors=[],external=[],layouts=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(url))external.push(r.url());});
const click=s=>uiClick(page,s);
const home=()=>click('.tw-mission-head [data-action="home"]');
const open=async id=>{await click(`[data-chapter="${levelById[id].chapter}"]`);await click(`[data-level="${id}"]`);};

try{
  await page.goto(url);
  await page.evaluate(()=>document.fonts.ready);
  assert.ok(await page.evaluate(()=>document.fonts.check('700 25px TideweaveSerif')),'bundled display font loaded');
  await page.locator('.tw-city-art').evaluate(image=>image.decode());
  await page.waitForFunction(()=>document.querySelector('#tw-city')?.hidden===true);
  const variation=await page.locator('.tw-city-art').evaluate(image=>{
    const c=document.createElement('canvas');c.width=160;c.height=90;c.getContext('2d').drawImage(image,0,0,160,90);
    const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data,colors=new Set();
    for(let i=0;i<data.length;i+=400)colors.add(`${data[i]},${data[i+1]},${data[i+2]}`);
    return colors.size;
  });
  assert.ok(variation>30,'provided home scene is nonblank and replaces the fallback');
  await click('[data-level="01-01.1"]');
  assert.equal(await page.locator('dialog').count(),0,'first level opens without a briefing');
  await page.reload();await click('[data-level="01-01.1"]');
  assert.equal(await page.locator('dialog').count(),0,'read briefing does not interrupt replay');
  await home();
  for(const ch of chapters.slice(1)){
    await click(`[data-chapter="${ch.id}"]`);
    assert.equal(await page.locator('dialog').count(),0,'browsing a chapter opens no briefing');
    assert.equal(await page.locator('.tw-campaign-summary p').innerText(),ch.purpose);
  }
  const seed=fresh();seed.settings.motion=false;seed.briefings=[1,2,3,4,5];
  for(const l of levels){const s=solution(l);recordAttempt(seed,l,s,evaluate(l,s));delete seed.records[l.id].state;}
  await page.evaluate(p=>localStorage.setItem('tideweave-progress',JSON.stringify(p)),seed);await page.reload();
  for(const viewport of [{width:1440,height:940},{width:1280,height:720},{width:900,height:620},{width:720,height:620},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await page.screenshot({path:`verification/design-map-${viewport.width}.png`,fullPage:true});
    for(const id of ['01-01.1','01-01.3','02-S1.1','03-02.2','03-04.2','04-01.3','04-02.2','04-02.3','02-S1.2']){
      await open(id);
      if(id==='01-01.3'||id==='04-01.3'){
        for(const [i,c] of solution(levelById[id])[id==='01-01.3'?'labels':'colors'].entries()){
          await click(`[data-tool="${c}"]`);await page.locator(`[data-node="${i}"]`).press('Enter');
        }
      }
      const layout=await page.evaluate(()=>{
        const box=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};
        const sections=[...document.querySelectorAll('.tw-mission-head,.tw-task,.tw-context-tools,.tw-board,.tw-operation')].map(box);
        const clipped=[...document.querySelectorAll('.tw-task h2,.tw-control-line p,.tw-city-purpose,.tw-operation .tw-btn,.tw-dialog h2,.tw-dialog p')].filter(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1).map(e=>e.textContent.trim());
        return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,sections,clipped};
      });
      assert.ok(layout.pageWidth<=viewport.width+1,`${id}: horizontal overflow`);
      assert.deepEqual(layout.clipped,[],`${id}: clipped text`);
      for(let i=1;i<layout.sections.length;i++)assert.ok(layout.sections[i].top>=layout.sections[i-1].bottom-1,`${id}: overlapping sections`);
      assert.ok(layout.sections[3].height>=270,`${id}: collapsed board`);
      if(viewport.width>=1280)assert.ok(layout.sections[4].bottom<=viewport.height+1,`${id}: desktop footer outside viewport`);
      layouts.push({id,...layout});
      await page.screenshot({path:`verification/design-${id}-${viewport.width}.png`,fullPage:true});
      if(id==='01-01.1'){
        await click('[data-action="rules"]');
        await page.screenshot({path:`verification/design-rules-${viewport.width}.png`,fullPage:true});
        await click('[data-action="close"]');
      }
      await home();
    }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await fs.writeFile('verification/design-results.json',JSON.stringify({pass:true,chapterPurposes:5,noMapBriefing:true,fontLoaded:true,cityColors:variation,layouts,errors,external},null,2));
  console.log(`Design passed: chapter purpose reference, offline font, city pixels, ${layouts.length} viewport/level layouts.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
