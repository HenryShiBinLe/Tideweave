import {chromium} from 'playwright';
import {serve} from './preview.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {levels,levelById} from '../src/levels.mjs';
import {solution,evaluate} from '../src/engine.mjs';
import {fresh,recordAttempt} from '../src/progress.mjs';
const seeded=fresh();for(const l of levels){const s=solution(l);recordAttempt(seeded,l,s,evaluate(l,s));delete seeded.records[l.id].state;}seeded.settings.motion=false;seeded.summaries=[];seeded.briefings=[1,2,3,4,5];
const server=await serve(),url=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const click=s=>page.locator(s).first().click();
const open=async id=>{const l=levelById[id];await click(`[data-chapter="${l.chapter}"]`);await click(`[data-level="${id}"]`);};
try{
  await page.goto(url);await page.evaluate(p=>localStorage.setItem('tideweave-progress',JSON.stringify(p)),seeded);await page.reload();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:940});await open('04-02.2');
    const canvas=page.locator('#tw-solid canvas');await canvas.waitFor();
    const box=await canvas.boundingBox(),beforeRotation=await canvas.evaluate(c=>c.toDataURL());
    await page.mouse.move(box.x+box.width*.1,box.y+box.height*.2);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.25,box.y+box.height*.3,{steps:12});await page.mouse.up();
    assert.notEqual(await canvas.evaluate(c=>c.toDataURL()),beforeRotation,'rotation changes actual rendered pixels');
    const afterDrag=await page.evaluate(()=>JSON.parse(localStorage.getItem('tideweave-progress')).records['04-02.2'].state);
    assert.ok(afterDrag.colors.every(c=>c===-1),'rotation does not paint a face');
    await canvas.click({position:{x:box.width/2,y:box.height/2}});
    await page.waitForTimeout(150);
    let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('tideweave-progress')).records['04-02.2'].state);
    assert.equal(saved.colors.filter(c=>c>=0).length,1,'click paints exactly one logical face');
    const painted=saved.colors.findIndex(c=>c>=0);
    await click('[data-action="net"]');assert.match(await page.locator(`[data-node="${painted}"]`).getAttribute('aria-label'),/水青/);
    await click('[data-tool="2"]');await page.locator(`[data-node="${painted}"]`).press('Enter');
    await click('[data-action="solid"]');
    await page.selectOption('[data-face]',String(painted));await page.waitForTimeout(100);
    await page.screenshot({path:`verification/solid-colored-${width}.png`,fullPage:true});
    const pixels=await page.locator('#tw-solid canvas').evaluate(c=>{const temp=document.createElement('canvas');temp.width=c.width;temp.height=c.height;const ctx=temp.getContext('2d');ctx.drawImage(c,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let count=0;for(let i=3;i<d.length;i+=4)if(d[i])count++;return count;});assert.ok(pixels>1000);
    saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('tideweave-progress')).records['04-02.2'].state);assert.equal(saved.colors[painted],2);
    await click('[data-action="reset"]');await click('[data-action="confirm-reset"]');await click('.tw-mission-head [data-action="home"]');
  }
  await page.setViewportSize({width:1440,height:940});
  await open('05-01.1');await click('[data-mode="probe"]');await page.locator('[data-edge="3"]').press('Enter');assert.match(await page.locator('.graph-note').textContent(),/2 片/);await page.locator('[data-edge="0"]').press('Enter');assert.match(await page.locator('.graph-note').textContent(),/1 片/);await click('.tw-mission-head [data-action="home"]');
  await open('04-01.4');await page.locator('[data-node="0"]').press('Enter');await page.locator('[data-node="1"]').press('Enter');assert.equal(await page.locator('.region.conflict').count(),0,'no premature answer warning');await click('.tw-mission-head [data-action="home"]');
  await page.evaluate(p=>localStorage.setItem('tideweave-progress',JSON.stringify(p)),{...seeded,records:{...seeded.records,'01-04.2':{...seeded.records['01-04.2'],state:solution(levelById['01-04.2'])}}});await page.reload();await open('01-04.2');await click('[data-action="run"]');await page.waitForSelector('dialog');await click('[data-action="continue"]');assert.match(await page.locator('dialog').textContent(),/无环的树/);await click('[data-action="next-chapter"]');assert.equal(await page.locator('[data-action="ack-briefing"]').count(),1);assert.match(await page.locator('.tw-mission-head').textContent(),/01-04\.2/);await click('[data-action="ack-briefing"]');assert.match(await page.locator('.tw-mission-head').textContent(),/02-01\.1/);
  const fallback=await browser.newPage();await fallback.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==='webgl'||type==='webgl2'||type==='experimental-webgl')return null;return get.call(this,type,...args);};});await fallback.goto(url);await fallback.evaluate(p=>localStorage.setItem('tideweave-progress',JSON.stringify(p)),seeded);await fallback.reload();await fallback.locator('[data-chapter="4"]').click();await fallback.locator('[data-level="04-02.2"]').click();await fallback.waitForSelector('.net-svg');assert.equal(await fallback.locator('#tw-solid canvas').count(),0);await fallback.close();
  assert.deepEqual(errors,[]);await fs.writeFile('verification/interaction-results.json',JSON.stringify({pass:true,solidPickDesktop:true,solidPickMobile:true,netSynchronization:true,webglFallback:true,faultReset:true,noEarlyColorError:true,chapterAdvance:true,errors},null,2));
  console.log('Advanced interactions passed.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
