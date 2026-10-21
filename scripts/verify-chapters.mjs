import {uiClick,selectMission} from './ui-navigation.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {serve} from './preview.mjs';
import {chapters,levels,levelById,units} from '../src/levels.mjs';
import {fresh,recordAttempt} from '../src/progress.mjs';
import {solution,evaluate} from '../src/engine.mjs';

await fs.mkdir('verification',{recursive:true});
const server=await serve(),url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const click=s=>uiClick(page,s);
const save=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tideweave-progress')));
const load=async p=>{await page.evaluate(p=>localStorage.setItem('tideweave-progress',JSON.stringify(p)),p);await page.reload();};
const pass=(p,l)=>{const state=solution(l);recordAttempt(p,l,state,evaluate(l,state));};
const check=async()=>{await click('[data-action="run"]');await page.waitForSelector('dialog');await click('[data-action="continue"]');};
const main=ch=>levels.filter(l=>l.chapter===ch&&!l.optional);

try{
  await page.goto(url);
  await click('[data-level="01-01.1"]');assert.equal(await page.locator('dialog').count(),0);
  await click('.tw-mission-head [data-action="home"]');
  for(const ch of chapters){
    await click(`[data-chapter="${ch.id}"]`);assert.equal(await page.locator('dialog').count(),0);
  }
  for(const ch of chapters){
    const p=fresh(),last=main(ch.id).at(-1),next=main(ch.id+1)[0];
    p.settings.motion=false;p.chapter=ch.id;
    // Old read markers must not suppress the newly requested transition briefing.
    p.briefings=ch.id===1?[1,2,3,4,5]:[];p.summaries=chapters.filter(c=>c.id<ch.id).map(c=>c.id);
    for(const l of levels.filter(l=>!l.optional&&l.chapter<=ch.id&&l.id!==last.id))pass(p,l);
    p.records[last.id]={revision:last.revision??1,state:solution(last)};
    await load(p);
    const optionals=units.filter(u=>u.chapter===ch.id&&u.optional);
    for(const u of optionals){
      await selectMission(page,`${u.id}.1`);
      const button=page.locator(`[data-level="${u.id}.1"]`);
      assert.equal(await button.isDisabled(),true);assert.match(await page.locator('.tw-lock-reason').innerText(),/完成本章全部普通关卡后开放/);
    }
    await click(`[data-level="${last.id}"]`);await check();
    assert.equal(await page.locator('dialog h2').innerText(),ch.title);
    assert.equal(await page.locator('[data-action="ack-briefing"]').count(),0,'summary comes before next chapter goals');
    if(optionals.length){
      await page.screenshot({path:`verification/chapter-${ch.id}-completed.png`});
      await click('[data-action="chapter-optional"]');
      for(const u of optionals){
        await selectMission(page,`${u.id}.1`);assert.equal(await page.locator(`[data-level="${u.id}.1"]`).isEnabled(),true);
        await selectMission(page,`${u.id}.2`);assert.equal(await page.locator(`[data-level="${u.id}.2"]`).isDisabled(),true);
      }
      const total=String(main(ch.id).length);
      assert.match(await page.locator('.tw-campaign-completion').innerText(),new RegExp(`${total}\\s*/\\s*${total}`));
      await click('[data-action="chapter-note"]');
    }
    await click('[data-action="next-chapter"]');
    if(!next){assert.equal(await page.locator('.tw-campaign').count(),1);assert.equal(await page.locator('dialog').count(),0);continue;}
    assert.equal(await page.locator('.tw-briefing-purpose strong').innerText(),chapters.find(c=>c.id===next.chapter).purpose);
    assert.equal(await page.locator('.tw-mission-ident').filter({hasText:next.id}).count(),0,'next level must wait for confirmation');
    assert.equal((await save()).last,last.id);
    if(ch.id===1){
      await page.screenshot({path:'verification/chapter-briefing.png'});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:'verification/chapter-transition-mobile.png'});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.setViewportSize({width:1280,height:720});
      await page.keyboard.press('Escape');assert.equal((await save()).last,last.id);
      await click('[data-action="chapter-note"]');await click('[data-action="next-chapter"]');
      await click('.tw-dialog-close');assert.equal(await page.locator('dialog').count(),0);
      await click('[data-action="chapter-note"]');await click('[data-action="next-chapter"]');
    }
    if(ch.id===3){
      await click('[data-action="close"]');
      assert.match(await page.locator('.tw-mission-head').innerText(),/03-04\.2/);
      await check();
      assert.equal(await page.locator('.tw-briefing-purpose strong').innerText(),chapters[3].purpose,'a read summary still leads to the next chapter briefing');
    }
    await click('[data-action="ack-briefing"]');
    assert.match(await page.locator('.tw-mission-head').innerText(),new RegExp(next.id.replaceAll('.','\\.')));
    assert.equal(await page.locator('dialog').count(),0);
    const entered=await save();assert.equal(entered.last,next.id);assert.equal(entered.records[next.id]?.attempts??0,0);
    assert.ok(entered.briefings.includes(next.chapter));
    assert.ok(levels.filter(l=>l.optional).every(l=>!entered.records[l.id]?.passed),'optional missions never block ordinary progression');
    await page.reload();await click(`[data-level="${next.id}"]`);assert.equal(await page.locator('dialog').count(),0,'reopening from map has no transition');
  }
  const replay=fresh();replay.settings.motion=false;
  for(const l of main(1))pass(replay,l);
  await load(replay);await click('[data-level="01-01.1"]');await check();
  assert.equal(await page.locator('dialog').count(),0,'replaying an early level never triggers the chapter summary');
  assert.match(await page.locator('.tw-mission-head').innerText(),/01-01\.2/);

  for(const u of units.filter(u=>u.optional)){
    const p=fresh();p.chapter=u.chapter;p.settings.motion=false;
    for(const l of levels.filter(l=>!l.optional&&l.chapter<=u.chapter))pass(p,l);
    const optional=levels.filter(l=>l.unit===u.id);
    for(const l of optional.slice(0,-1))pass(p,l);
    p.records[optional.at(-1).id]={revision:optional.at(-1).revision??1,state:solution(optional.at(-1))};
    await load(p);await click(`[data-level="${optional.at(-1).id}"]`);await check();
    assert.equal(await page.locator('.tw-campaign').count(),1);assert.equal(await page.locator('dialog').count(),0,'optional completion stays in its chapter');
    assert.equal((await save()).chapter,u.chapter);
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile('verification/chapter-results.json',JSON.stringify({pass:true,chapterEndings:5,nextChapterBriefings:4,optionalUnits:3,noMapBriefing:true,confirmationBeforeEntry:true,cancelKeepsCurrentChapter:true,replayDoesNotTriggerSummary:true,legacyReadMarkersSupported:true,errors},null,2));
  console.log('Chapter flow passed: 5 endings, 4 confirmed transitions, chapter-local electives, cancellation and legacy saves.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
