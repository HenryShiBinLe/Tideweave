import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {serve} from './preview.mjs';
import {uiClick} from './ui-navigation.mjs';
import {levels, levelById} from '../src/levels.mjs';
import {fresh, recordAttempt} from '../src/progress.mjs';
import {solution, evaluate, initialState} from '../src/engine.mjs';
import {graphBoard} from '../src/board.mjs';
import {assetManifest} from '../src/assets.mjs';

await fs.mkdir('verification', {recursive:true});
const seed = fresh(); seed.settings.sound = false;
for (const level of levels) {const state = solution(level); recordAttempt(seed, level, state, evaluate(level, state));}
seed.briefings = [1,2,3,4,5];
const server = await serve(), url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({channel:'msedge', headless:true, args:['--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:1440,height:940}}), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const box = () => page.locator('.tw-board').evaluate(el => {
  const r=el.getBoundingClientRect();
  (window.__layoutSamples??=[]).push([...document.querySelector('.tw-game').children].map(child=>({class:child.className,height:child.getBoundingClientRect().height,top:child.getBoundingClientRect().top+scrollY})));
  return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};
});
const same = (before, after, label) => {for (const key of Object.keys(before)) assert.ok(Math.abs(before[key]-after[key])<1, `${label}: ${key} moved from ${before[key]} to ${after[key]}`);};
const settle = () => page.waitForFunction(() => !document.documentElement.dataset.pageTransition && !document.querySelector('.tw-board')?.getAnimations().some(a=>a.playState==='running'));
const enter = async id => {await uiClick(page, `[data-level="${id}"]`);await settle();};
try {
  await page.goto(url);
  await page.locator('[data-action="settings"]').first().click();
  assert.equal(await page.locator('[data-setting="volume"]').inputValue(), '1');
  assert.equal(await page.locator('[data-setting="musicVolume"]').inputValue(), '0.5');
  await page.evaluate(p => localStorage.setItem('tideweave-progress',JSON.stringify(p)), seed);await page.reload();
  for(const size of [{width:1440,height:940},{width:900,height:720},{width:720,height:620},{width:390,height:844}].filter(size=>!process.env.TW_UI_WIDTH||size.width===Number(process.env.TW_UI_WIDTH))) {
    await page.setViewportSize(size);
    for(const id of ['01-03.2','03-02.2','03-03.2','03-04.2','04-02.3','04-03.2','02-S1.2'].filter(id=>!process.env.TW_UI_LEVEL||id===process.env.TW_UI_LEVEL)) {
      await enter(id);
      assert.equal(await page.locator('.tw-speed').count(),1);
      await page.selectOption('.tw-speed','3');
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tideweave-progress')).settings.speed),3);
      const before = await box();
      await page.evaluate(() => {document.querySelector('[data-action="run"]').click();document.querySelector('[data-action="pause"]')?.click();});
      assert.equal(await page.locator('.tw-playback').count(),1, `${id} runs`);
      assert.equal(await page.locator('.tw-speed').inputValue(),'3');
      same(before,await box(), `${id}/${size.width} run`);
      await page.locator('[data-frame]').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));});
      same(before,await box(), `${id}/${size.width} last frame`);
      await page.locator('[data-action="edit"]').click();
      same(before,await box(), `${id}/${size.width} edit`);
      await page.evaluate(() => {document.querySelector('[data-action="replay"]').click();document.querySelector('[data-action="pause"]')?.click();});
      same(before,await box(), `${id}/${size.width} replay`);
      if(id==='03-03.2'||id==='04-02.3')await page.screenshot({path:`verification/stable-${id}-${size.width}.png`,fullPage:true});
      await page.locator('[data-action="edit"]').click();
      await page.evaluate(() => {document.querySelector('[data-action="run"]').click();document.querySelector('[data-action="skip"]')?.click();});
      await page.waitForSelector('dialog[open]');
      same(before,await box(),`${id}/${size.width} result`);
      await page.locator('.tw-dialog-close').click();await page.waitForSelector('dialog',{state:'detached'});
      same(before,await box(),`${id}/${size.width} after result`);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
      assert.ok(overflow<=1,`${id}/${size.width} horizontal overflow`);
      if(size.width>=720){const footer=await page.locator('.tw-operation').boundingBox();assert.ok(footer.y+footer.height<=size.height+1,`${id}/${size.width} footer fits`);}
      checks.push({id,...size,board:before});
      console.log(`Stable: ${id} at ${size.width}x${size.height}`);
    }
    await enter('05-01.2');
    const before=await box();
    await page.locator('[data-mode="probe"]').click();
    await page.locator('[data-node="0"]').press('Enter');
    same(before,await box(),`probe/${size.width}`);
    await page.locator('[data-action="clear-probe"]').click();
    same(before,await box(),`clear probe/${size.width}`);
  }
  await page.setViewportSize({width:1440,height:940});
  await enter('01-03.2');
  const aligned=await page.locator('.station-source').evaluate(async group=>{
    const marker=group.querySelector('.station-source-marker'), plate=group.querySelector('.station-source-plate');
    const centers=[];
    for(const time of [0,900,1800]){
      for(const animation of marker.getAnimations()){animation.pause();animation.currentTime=time;}
      await new Promise(r=>requestAnimationFrame(r));
      const a=marker.getBoundingClientRect(), b=plate.getBoundingClientRect();centers.push(Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2));
    }
    return centers;
  });
  assert.ok(aligned.every(delta=>delta<.2),'source animation keeps its center aligned');
  await page.screenshot({path:'verification/source-marker-aligned.png',fullPage:true});
  const artPage=await browser.newPage({viewport:{width:1200,height:740}});
  const images=Object.fromEntries(Object.entries(assetManifest).map(([key,asset])=>[key,`${url}/${asset.path}`]));
  for(const [id,name,ui] of [['03-03.2','complete',{frame:{nodes:[0,1,2]}}],['04-03.1','conflict',{result:{nodes:[2]}}]]) {
    const level=levelById[id];
    await artPage.setContent(`<link rel="stylesheet" href="${url}/style.css"><main class="tw-game" style="display:block;padding:30px"><section class="tw-board" style="height:660px">${graphBoard(level,solution(level),{images,...ui})}</section></main>`);
    await artPage.locator('.station-status').first().waitFor();
    await artPage.waitForFunction(()=>[...document.querySelectorAll('svg image')].every(el=>el.getAttribute('href')));
    await artPage.waitForLoadState('networkidle');
    assert.equal(await artPage.locator(`.station-status-plate.status-${name}`).first().evaluate(el=>getComputedStyle(el).fill), name==='complete'?'rgb(114, 151, 123)':'rgb(174, 88, 70)');
    assert.equal(await artPage.locator(`.station-status.status-${name}`).first().evaluate(el=>getComputedStyle(el).opacity),'1');
    await artPage.screenshot({path:`verification/status-${name}.png`});
  }
  await artPage.close();
  assert.deepEqual(errors,[]);
  await fs.writeFile('verification/stable-board-results.json',JSON.stringify({pass:true,checks,sourceAlignment:aligned,errors},null,2));
  console.log(`Stable board passed: ${checks.length} viewport/mission combinations, edit/run/replay/result transitions, probe, speed preselection, audio defaults and badge alignment.`);
} catch(error) {
  await page.screenshot({path:'verification/stable-failure.png',fullPage:true});
  console.log('Recent layouts:',JSON.stringify(await page.evaluate(()=>window.__layoutSamples?.slice(-5)),null,2));
  console.log('Toolbar:',await page.locator('.tw-context-tools').evaluate(el=>[...el.children].map(child=>({tag:child.tagName,class:child.className,height:child.getBoundingClientRect().height,top:child.getBoundingClientRect().top,html:child.outerHTML.slice(0,90)}))));
  throw error;
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
