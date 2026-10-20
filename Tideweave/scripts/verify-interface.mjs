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
const settle=async()=>{await page.waitForFunction(()=>!document.documentElement.dataset.pageTransition);await page.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished));});};
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
const checkClose=async()=>{
  await settle();
  const geometry=await page.locator('.tw-dialog-close').evaluate(button=>{
    const b=button.getBoundingClientRect(),s=button.querySelector('svg').getBoundingClientRect(),d=button.closest('dialog').getBoundingClientRect();
    return {dx:s.x+s.width/2-b.x-b.width/2,dy:s.y+s.height/2-b.y-b.height/2,inside:b.left>=d.left&&b.right<=d.right&&b.top>=d.top&&b.bottom<=d.bottom};
  });
  assert.ok(Math.abs(geometry.dx)<.5&&Math.abs(geometry.dy)<.5,'close icon is centered inside its button');
  assert.ok(geometry.inside,'close button stays within dialog');
};
try {
  await page.goto(url);
  assert.ok(await page.evaluate(()=>document.getAnimations().length>0),'page entrance is animated');
  const replayColor=await page.locator('.tw-menu-records').evaluate(el=>getComputedStyle(el).backgroundColor.match(/[\d.]+/g).slice(0,3).map(Number));
  assert.deepEqual(replayColor,[228,215,177],'replay entry slightly brightens the historical pale brown');
  const records=page.locator('.tw-menu-records');
  await records.hover();await settle();
  assert.equal(await records.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(228, 215, 177)','hover does not replace record brown with white');
  await shot('records-hover');
  await page.mouse.down();await settle();
  assert.equal(await records.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(228, 215, 177)','press keeps record brown');
  await page.mouse.move(0,0);await page.mouse.up();
  await records.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await settle();
  assert.ok(await records.evaluate(el=>el.matches(':focus-visible')));
  assert.equal(await records.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(228, 215, 177)','keyboard focus keeps record brown');
  await page.keyboard.press('Tab');await settle();
  for(const size of [{width:1920,height:1080},{width:1440,height:900},{width:1280,height:720},{width:900,height:620},{width:720,height:620},{width:390,height:844},{width:320,height:620}]){
    await page.setViewportSize(size);await check(`home-${size.width}`);
    assert.equal(await page.locator('.tw-home-subtitle').textContent(),'图论学习游戏');
    assert.ok(await page.locator('.tw-home-subtitle').isVisible(),`home-${size.width}: learning subtitle is visible`);
    assert.equal(await page.locator('.tw-home-options .tw-control-detail').count(),0,'utility buttons have no decorative flow motif');
    await shot(`home-${size.width}`);
  }
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    await page.locator('.tw-home-options [data-action="settings"]').click();
    await checkClose();await check(`settings-${width}`);await shot(`settings-${width}`);
    await page.locator('.tw-dialog-close').click();
    await page.waitForSelector('dialog',{state:'detached'});
    assert.equal(await page.locator('dialog').count(),0,'close button dismisses settings');
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
  await page.locator('.tw-menu-records').click();await settle();
  const recordEntry=page.locator('.tw-journal button').first();
  await recordEntry.hover();await settle();
  assert.equal(await recordEntry.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(222, 208, 168)','replay-list hover keeps its existing record brown');
  await shot('records-list');
  await page.locator('.tw-dialog-close').click();await page.waitForSelector('dialog',{state:'detached'});
  for(const width of [1440,900,720,390,320]){
    await page.setViewportSize({width,height:900});
    await selectMission(page,'03-03.3');await page.mouse.move(0,0);await check(`campaign-${width}`);await shot(`campaign-${width}`);
    const earnedColors=await page.locator('.tw-route-stop.passed .tw-route-symbol').evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundColor));
    assert.ok(earnedColors.length>1);
    assert.ok(earnedColors.every(color=>color==='rgb(228, 215, 177)'),'earned badges share brighter record brown, including the selected mission');
    assert.equal(await page.locator('.tw-chapters .active .tw-chapter-number').evaluate(el=>getComputedStyle(el).color),'rgb(242, 222, 131)','chapter highlight keeps its original action yellow');
    assert.equal(await page.locator('[data-action="deploy"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(242, 222, 131)','deploy action yellow is unchanged');
    await page.locator('[data-action="deploy"]').click();await check(`game-${width}`);await shot(`game-${width}`);
    await page.locator('[data-action="rules"]').click();await checkClose();await check(`rules-${width}`);await shot(`rules-${width}`);
    await page.locator('[data-action="close"]').first().click();
  }
  await page.setViewportSize({width:1440,height:900});
  await selectMission(page,'03-01.2');await page.locator('[data-action="deploy"]').click();await settle();
  const passiveStation=page.locator('.station.has-asset').first();
  await page.mouse.move(0,0);await settle();
  const passiveBefore=await passiveStation.locator('.station-asset').evaluate(el=>({transform:getComputedStyle(el).transform,filter:getComputedStyle(el).filter}));
  await passiveStation.locator('.station-body').hover();await settle();
  const passiveAfter=await passiveStation.locator('.station-asset').evaluate(el=>({transform:getComputedStyle(el).transform,filter:getComputedStyle(el).filter}));
  assert.equal(passiveAfter.transform,'matrix(1, 0, 0, 1, 0, -0.75)','passive station hover has a small lift');
  assert.equal(passiveAfter.filter,passiveBefore.filter,'passive station hover does not add the stronger clickable shadow');
  assert.equal(await passiveStation.evaluate(el=>getComputedStyle(el).cursor),'default','passive station keeps a non-click cursor');
  assert.equal(await passiveStation.locator('.station-selection').evaluate(el=>getComputedStyle(el).opacity),'0','passive station does not show a selection frame');
  await page.mouse.move(0,0);await settle();
  assert.equal(await passiveStation.locator('.station-asset').evaluate(el=>getComputedStyle(el).transform),passiveBefore.transform,'passive hover returns to rest');
  const normalRoad=await page.locator('[data-edge="0"] .edge-line').evaluate(el=>getComputedStyle(el).stroke);
  for(const i of [0,2,4])await page.locator(`[data-edge="${i}"]`).press('Enter');
  await settle();
  const selectedRoad=await page.locator('[data-edge="0"] .edge-line').evaluate(el=>getComputedStyle(el).stroke);
  assert.notEqual(selectedRoad,normalRoad,'selected road has a distinct color');
  assert.equal(selectedRoad,'rgb(52, 122, 130)','selected routes use the cool water palette');
  const surfaces=await page.locator('.tw-task,.tw-context-tools,.tw-operation').evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundColor.match(/[\d.]+/g).slice(0,3).map(Number)));
  for(const rgb of surfaces)assert.ok(Math.max(...rgb)-Math.min(...rgb)<9,'large UI surfaces stay neutral rather than yellow-green');
  assert.equal(await page.locator('[data-edge="0"] .edge-selection-rim').evaluate(el=>getComputedStyle(el).opacity),'1');
  assert.equal(await page.locator('[data-edge="4"]').evaluate(el=>getComputedStyle(el).outlineStyle),'none','keyboard focus follows the road, without a rectangular bounding box');
  const selectedCost=[0,2,4].reduce((sum,i)=>sum+levels.find(l=>l.id==='03-01.2').edges[i].w,0);
  assert.equal(await page.locator('.tw-cost strong').textContent(),String(selectedCost));
  for(const width of [1440,1280,390]){
    await page.setViewportSize({width,height:900});await check(`cost-${width}`);
    const cost=await page.locator('.tw-cost').boundingBox();
    assert.ok(cost.x<30&&cost.x+cost.width<width,'cost readout stays on the left and fits');
    assert.ok(await page.locator('.tw-cost strong').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=28));
    await shot(`selected-roads-${width}`);
  }
  await page.setViewportSize({width:1440,height:900});
  await selectMission(page,'01-03.1');await page.locator('[data-action="deploy"]').click();await settle();
  assert.equal(await page.locator('.station[data-node]').count(),0,'fixed broadcast stations cannot be edited');
  const fixedStation=page.locator('.station.has-asset').first();
  await fixedStation.locator('.station-body').hover();await settle();
  assert.equal(await fixedStation.locator('.station-asset').evaluate(el=>getComputedStyle(el).transform),'matrix(1, 0, 0, 1, 0, -0.75)','fixed broadcast stations use passive hover, despite their legacy editable class');
  assert.equal(await fixedStation.locator('.station-selection').evaluate(el=>getComputedStyle(el).opacity),'0');
  const fixedBoard=await page.locator('.graph-svg').innerHTML();
  await fixedStation.locator('.station-body').click();
  assert.equal(await page.locator('.graph-svg').innerHTML(),fixedBoard,'clicking a passive station never changes the puzzle');
  await selectMission(page,'01-01.1');await page.locator('[data-action="deploy"]').click();await settle();
  const clickableStation=page.locator('.station.has-asset[data-node]').first();
  await clickableStation.locator('.station-body').hover();await settle();
  assert.equal(await clickableStation.locator('.station-asset').evaluate(el=>getComputedStyle(el).transform),'matrix(1, 0, 0, 1, 0, -2)','clickable nodes retain their hover feedback');
  await page.mouse.move(0,0);await settle();
  const editAnimations=await page.evaluate(()=>{document.querySelector('[data-node="0"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));return document.getAnimations().filter(a=>a.effect.target?.matches('.tw-task-copy,.tw-mission-ident')).length;});
  assert.equal(editAnimations,0,'board edits never replay the page entrance');
  const run=page.locator('[data-action="run"]');
  const flow=run.locator('.detail-flow');
  assert.ok(await flow.evaluate(el=>el.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations===Infinity)),'primary action has a running idle effect');
  const labelBox=await run.locator('span').boundingBox(),detailBox=await run.locator('.tw-control-detail').boundingBox();
  assert.ok(detailBox.x>=labelBox.x+labelBox.width+3,'idle motif has its own space outside the label');
  const motionFrames=[];
  for(const time of [1800,3900]){
    await flow.evaluate((el,time)=>{const animation=el.getAnimations()[0];animation.pause();animation.currentTime=time;},time);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    motionFrames.push(await run.screenshot({path:`verification/interface-idle-${time}.png`}));
  }
  assert.notDeepEqual(motionFrames[0],motionFrames[1],'light flow visibly advances along the motif');
  await flow.evaluate(el=>el.getAnimations()[0].play());
  await page.locator('[data-action="settings"]').click();await settle();
  await page.locator('[data-setting="motion"]').check();
  assert.equal(await page.locator('html').getAttribute('data-motion'),'reduced');
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0,'reduced-motion switch immediately stops effects');
  await shot('settings');
  await page.locator('[data-setting="motion"]').uncheck();
  await page.locator('[data-action="close"]').first().click();
  await page.waitForSelector('dialog',{state:'detached'});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.tw-mission-head [data-action="home"]').click();
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0,'system reduced motion also stops entrance effects');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await fs.writeFile('verification/interface-results.json',JSON.stringify({pass:true,layouts,closeCentered:true,animation:true,idleFlow:true,selectedRoads:true,leftCost:true,reducedMotion:true,keyboardFocus:true,offline:true,errors},null,2));
  console.log(`Interface passed: ${layouts.length} layouts, historical pale-brown replay entry, passive/clickable node hover, centered close icon, water-blue roads, visible idle flow, navigation focus, both reduced-motion settings, offline requests.`);
} finally {await browser.close();await new Promise(r=>server.close(r));}
