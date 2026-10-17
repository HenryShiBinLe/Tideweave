import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {serve} from './preview.mjs';
import {levels,levelById} from '../src/levels.mjs';
import {solution,evaluate} from '../src/engine.mjs';
import {fresh,recordAttempt} from '../src/progress.mjs';

await fs.mkdir('verification',{recursive:true});
const server=await serve(),url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:940},reducedMotion:'reduce'});
const errors=[],external=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',req=>{if(/^https?:/.test(req.url())&&!req.url().startsWith(url))external.push(req.url());});
const click=selector=>page.locator(selector).first().click();
async function open(id){const l=levelById[id];await click(`[data-chapter="${l.chapter}"]`);await click(`[data-level="${id}"]`);}
async function home(){await click('.tw-mission-head [data-action="home"]');}
async function selected(){return page.locator('[data-edge][aria-pressed="true"]').evaluateAll(els=>els.map(el=>Number(el.dataset.edge)).sort((a,b)=>a-b));}
async function edgePoint(id,kind='line'){
  return page.locator(`[data-edge="${id}"]`).evaluate((el,kind)=>{
    const line=el.querySelector('.edge-line');
    if(kind==='weight'){
      const b=el.querySelector('.weight rect').getBoundingClientRect();
      const p={x:b.x+b.width/2,y:b.y+b.height/2};
      return {...p,hit:document.elementFromPoint(p.x,p.y)?.closest('[data-edge]')?.dataset.edge};
    }
    for(const t of [.5,.35,.65,.2,.8]){
      const p=line.getPointAtLength(line.getTotalLength()*t).matrixTransform(line.getScreenCTM());
      const hit=document.elementFromPoint(p.x,p.y)?.closest('[data-edge]')?.dataset.edge;
      if(hit===el.dataset.edge)return {x:p.x,y:p.y,hit};
    }
    return {hit:null};
  },kind);
}
async function pointerToggle(id,kind){
  const p=await edgePoint(id,kind);assert.equal(p.hit,String(id),`edge ${id} ${kind} is obscured`);
  await page.mouse.click(p.x,p.y);
}
try{
  await page.goto(url);await click('[data-level="01-01.1"]');
  assert.equal(await page.locator('[data-action="hint"]').count(),0);
  assert.equal(await page.locator('.tw-task p').innerText(),levelById['01-01.1'].controls);
  await click('[data-action="rules"]');assert.match(await page.locator('dialog').innerText(),/本关规则/);
  await click('[data-action="close"]');await home();
  const seed=fresh();
  for(const l of levels){const s=solution(l);recordAttempt(seed,l,s,evaluate(l,s));delete seed.records[l.id].state;}
  seed.settings.motion=false;seed.briefings=[1,2,3,4,5];
  await page.evaluate(p=>localStorage.setItem('tideweave-progress',JSON.stringify(p)),seed);await page.reload();
  for(const l of levels){
    await open(l.id);
    assert.equal(await page.locator('.tw-task h2').innerText(),l.goal);
    assert.equal(await page.locator('.tw-task p').innerText(),l.controls);
    const ids=await page.locator('[data-edge]').evaluateAll(els=>els.map(e=>Number(e.dataset.edge)));
    for(const id of ids){
      await pointerToggle(id,'line');assert.deepEqual(await selected(),[id],l.id+' selected the wrong line');
      await pointerToggle(id,'line');assert.deepEqual(await selected(),[],l.id+' failed to toggle');
      if(await page.locator(`[data-edge="${id}"] .weight`).count()){
        await pointerToggle(id,'weight');assert.deepEqual(await selected(),[id],l.id+' selected the wrong cost');
        await pointerToggle(id,'weight');assert.deepEqual(await selected(),[]);
      }
    }
    results.push({id:l.id,clickableEdges:ids.length});await home();
  }
  await open('03-02.2');
  for(const scheme of [[0,1,3,5],[0,1,4,5],[0,1,2,3,5]]){
    for(const id of scheme)await pointerToggle(id,'weight');
    assert.match(await page.locator('.tw-context-tools output').innerText(),/已全部接通/);
    await click('[data-action="run"]');await page.waitForSelector('dialog');
    assert.match(await page.locator('dialog h2').innerText(),scheme.length===4?/联运有序/:/设施恢复/);
    await click('[data-action="close"]');await click('[data-action="reset"]');await click('[data-action="confirm-reset"]');
  }
  await home();
  for(const viewport of [{width:1440,height:940},{width:1280,height:720},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    for(const id of ['01-01.1','03-02.2','02-S1.1','04-01.3','04-02.2','05-03.3']){
      await open(id);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),id+' page overflow');
      const boxes=await page.locator('.tw-task,.tw-context-tools,.tw-board,.tw-operation').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return {top:b.top,bottom:b.bottom,height:b.height};}));
      for(let i=1;i<boxes.length;i++)assert.ok(boxes[i].top>=boxes[i-1].bottom-1,id+' overlapping sections');
      assert.ok(boxes[2].height>=270,id+' collapsed board');
      if(id==='03-02.2'){
        for(let i=0;i<7;i++){await pointerToggle(i,'weight');assert.deepEqual(await selected(),[i]);await pointerToggle(i,'weight');}
      }
      await page.screenshot({path:`verification/clear-${id}-${viewport.width}.png`,fullPage:true});
      await home();
    }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await fs.writeFile('verification/pointer-results.json',JSON.stringify({results,errors,external,schemes:3,viewports:[1440,1280,390]},null,2));
  console.log(`PASS: ${results.length} goal/control checks; ${results.reduce((n,r)=>n+r.clickableEdges,0)} pointer-selectable edges; 3 real mouse solutions; desktop/mobile screenshots.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
