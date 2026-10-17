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
const errors=[],external=[],layouts=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(url))external.push(r.url());});
const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().map(a=>a.finished));});
const shot=async name=>{await settle();await page.screenshot({path:`verification/interface-${name}.png`,fullPage:true});};
const check=async name=>{
  await settle();
  const layout=await page.evaluate(()=>{
    const selectors='.tw-home-title h1,.tw-home-subtitle,.tw-continue-copy,.tw-menu-panel strong,.tw-route-stop b,.tw-deployment h2,.tw-deployment-goal p,.tw-btn span,.tw-task h2,.tw-control-line p,.tw-dialog h2';
    return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,
      clipped:[...document.querySelectorAll(selectors)].filter(e=>e.clientWidth&&e.scrollWidth>e.clientWidth+1).map(e=>e.textContent.trim())};
  });
  assert.equal(layout.overflow,false,`${name}: horizontal overflow`);
  assert.deepEqual(layout.clipped,[],`${name}: clipped control text`);layouts.push({name,...layout});
};
try {
  await page.goto(url);
  assert.ok(await page.evaluate(()=>document.getAnimations().length>0),'page entrance is animated');
  for(const size of [{width:1920,height:1080},{width:1440,height:900},{width:1280,height:720},{width:900,height:620},{width:720,height:620},{width:390,height:844},{width:320,height:620}]){
    await page.setViewportSize(size);await check(`home-${size.width}`);
    assert.equal(await page.locator('.tw-home-subtitle').textContent(),'图论学习游戏');
    assert.ok(await page.locator('.tw-home-subtitle').isVisible(),`home-${size.width}: learning subtitle is visible`);
    await shot(`home-${size.width}`);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.locator('[data-action="campaign"]').click();await settle();
  await page.locator('[data-chapter="2"]').focus();await page.keyboard.press('Enter');await settle();
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.chapter),'2','keyboard chapter focus survives render');
  await page.locator('[data-campaign-tab="optional"]').focus();await page.keyboard.press('Enter');await settle();
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.campaignTab),'optional');
  assert.equal(await page.locator('[data-action="deploy"]').isDisabled(),true,'locked optional stays locked');
  await shot('locked');
  const seed=fresh();
  for(const l of levels){const state=solution(l);recordAttempt(seed,l,state,evaluate(l,state));delete seed.records[l.id].state;}
  await page.evaluate(p=>localStorage.setItem('tideweave-progress',JSON.stringify(p)),seed);await page.reload();
  for(const width of [1440,900,720,390,320]){
    await page.setViewportSize({width,height:900});
    await selectMission(page,'03-03.3');await check(`campaign-${width}`);await shot(`campaign-${width}`);
    await page.locator('[data-action="deploy"]').click();await check(`game-${width}`);await shot(`game-${width}`);
    await page.locator('[data-action="rules"]').click();await check(`rules-${width}`);await shot(`rules-${width}`);
    await page.locator('[data-action="close"]').first().click();
  }
  await page.setViewportSize({width:1440,height:900});
  await selectMission(page,'01-01.1');await page.locator('[data-action="deploy"]').click();await settle();
  const editAnimations=await page.evaluate(()=>{document.querySelector('[data-node="0"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));return document.getAnimations().filter(a=>a.effect.target?.matches('.tw-task-copy,.tw-mission-ident')).length;});
  assert.equal(editAnimations,0,'board edits never replay the page entrance');
  await page.locator('[data-action="settings"]').click();await settle();
  await page.locator('[data-setting="motion"]').check();
  assert.equal(await page.locator('html').getAttribute('data-motion'),'reduced');
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0,'reduced-motion switch immediately stops effects');
  await shot('settings');
  await page.locator('[data-setting="motion"]').uncheck();
  await page.locator('[data-action="close"]').first().click();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.tw-mission-head [data-action="home"]').click();
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0,'system reduced motion also stops entrance effects');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await fs.writeFile('verification/interface-results.json',JSON.stringify({pass:true,layouts,animation:true,reducedMotion:true,keyboardFocus:true,offline:true,errors},null,2));
  console.log(`Interface passed: ${layouts.length} layouts, navigation focus, animation lifecycle, both reduced-motion settings, offline requests.`);
} finally {await browser.close();await new Promise(r=>server.close(r));}
