import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {serve} from './preview.mjs';
import {uiClick} from './ui-navigation.mjs';
import {levels} from '../src/levels.mjs';
import {solution,evaluate} from '../src/engine.mjs';
import {fresh,recordAttempt} from '../src/progress.mjs';

const seed=fresh();
seed.settings={...seed.settings,sound:false,motion:true,speed:.5};
seed.briefings=[1,2,3,4,5];
for(const level of levels){
  const state=solution(level);
  recordAttempt(seed,level,state,evaluate(level,state));
  seed.records[level.id].hintUnlocked=true;
}
await fs.mkdir('verification',{recursive:true});
const server=await serve();
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:940},reducedMotion:'no-preference'});
const report={checks:[],errors:[]};
page.on('pageerror',error=>report.errors.push(error.message));
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(value=>localStorage.setItem('tideweave-progress',JSON.stringify(value)),seed);
  await page.reload();
  for(const mode of ['run','replay']){
    for(const [id,action]of [['01-03.2','hint'],['04-02.2','adjacent'],['01-03.2','rules']]){
      await uiClick(page,`[data-level="${id}"]`);
      await page.selectOption('[data-speed]','0.5');
      await page.locator(`[data-action="${mode}"]`).click();
      await page.locator(`[data-action="${action}"]`).click();
      const title=await page.locator('dialog h2').innerText();
      const frame=await page.locator('[data-frame]').inputValue();
      // Longer than one playback step: an uncleared timer would advance or replace the dialog.
      await page.waitForTimeout(1600);
      assert.equal(await page.locator('dialog h2').innerText(),title,`${mode}/${action}: reading is not interrupted`);
      assert.equal(await page.locator('[data-frame]').inputValue(),frame,`${mode}/${action}: playback stays paused`);
      await page.locator('dialog [data-action="close"]').first().click();
      assert.equal(await page.locator('[data-action="pause"]').getAttribute('aria-label'),'播放');
      await page.selectOption('[data-speed]','3');
      await page.locator('[data-action="pause"]').click();
      if(mode==='run'){
        await page.waitForSelector('dialog');
        assert.match(await page.locator('dialog').innerText(),/运行通过/);
        await page.locator('dialog [data-action="close"]').first().click();
      }else{
        await page.waitForFunction(()=>{
          const range=document.querySelector('[data-frame]');
          return range&&range.value===range.max&&document.querySelector('[data-action="pause"]')?.getAttribute('aria-label')==='播放';
        });
        await page.locator('[data-action="edit"]').click();
      }
      report.checks.push({level:id,mode,action,paused:true,resumed:true});
      console.log(`PASS ${mode}/${action}: paused while reading and resumed to completion`);
    }
  }
  await page.locator('.tw-mission-head [data-action="home"]').click();
  await page.locator('.tw-campaign-heading [data-action="title-home"]').click();
  for(const location of ['home','settings']){
    if(location==='settings')await page.locator('[data-action="settings"]').first().click();
    await page.locator('[data-action="fullscreen"]').last().click();
    await page.waitForFunction(()=>document.fullscreenElement!==null);
    await page.locator('[data-action="fullscreen"]').last().click();
    await page.waitForFunction(()=>document.fullscreenElement===null);
    report.checks.push({location,fullscreenEnter:true,fullscreenExit:true});
    console.log(`PASS ${location}: fullscreen toggles on and off`);
  }
  assert.deepEqual(report.errors,[]);
  await fs.writeFile('verification/modal-controls-results.json',JSON.stringify({pass:true,...report},null,2));
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
