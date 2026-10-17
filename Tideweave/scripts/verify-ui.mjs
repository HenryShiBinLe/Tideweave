import {chromium} from 'playwright';
import {serve} from './preview.mjs';
import fs from 'node:fs/promises';
import {levels} from '../src/levels.mjs';
import {solution,evaluate} from '../src/engine.mjs';
import {fresh,recordAttempt} from '../src/progress.mjs';
import assert from 'node:assert/strict';

await fs.mkdir('verification',{recursive:true});
const server=await serve(),url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(/^https?:/.test(req.url())&&!req.url().startsWith(url))external.push(req.url());});
const click=async selector=>{await page.locator(selector).first().click();};
const node=async i=>{
  const p=await page.locator(`[data-node="${i}"]`).evaluate(el=>{
    const target=el.querySelector('.station-body')??el.querySelector('text');
    const b=target.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
    return {x,y,hit:document.elementFromPoint(x,y)?.closest('[data-node]')?.dataset.node};
  });
  assert.equal(p.hit,String(i),'facility or region is obscured');
  await page.mouse.click(p.x,p.y);
};
const edge=async i=>{await page.locator(`[data-edge="${i}"]`).focus();await page.keyboard.press('Enter');};
async function openLevel(l){
  await click(`[data-chapter="${l.chapter}"]`);
  assert.equal(await page.locator('dialog').count(),0,'browsing chapters must not open a briefing');
  await click(`[data-level="${l.id}"]`);
  assert.equal(await page.locator('dialog').count(),0,'entering from the map must not open a briefing');
}
async function run(){await click('[data-action="run"]');await page.waitForSelector('dialog');}
const results=[];
try{
  await page.goto(url);assert.equal(await page.locator('[data-level]').count(),12);await page.screenshot({path:'verification/map-desktop.png',fullPage:true});
  await click('[data-action="settings"]');assert.ok(await page.locator('dialog').isVisible());await click('[data-action="close"]');
  const first=levels[0];await openLevel(first);await node(0);await page.screenshot({path:'verification/first-level-desktop.png'});
  assert.equal(await page.locator('[data-action="hint"]').count(),0);
  for(let i=0;i<3;i++){await run();await click('[data-action="close"]');}
  assert.equal(await page.locator('[data-action="hint"]').count(),1);
  await click('[data-action="reset"]');await click('[data-action="confirm-reset"]');await click('[data-action="undo"]');
  await page.reload();await openLevel(first);assert.equal(await page.locator('[data-node="0"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-action="hint"]').count(),1);
  await node(1);await node(2);await run();assert.match(await page.locator('dialog').innerText(),/联运有序/);await click('[data-action="continue"]');assert.match(await page.locator('.tw-mission-head').innerText(),/01-01\.2/);
  const seeded=fresh();for(const l of levels){const state=solution(l);recordAttempt(seeded,l,state,evaluate(l,state));delete seeded.records[l.id].state;}seeded.settings.motion=false;seeded.briefings=[1,2,3,4,5];
  await page.evaluate(data=>localStorage.setItem('tideweave-progress',JSON.stringify(data)),seeded);await page.reload();
  for(const l of levels){
    await openLevel(l);const answer=solution(l);
    if(l.type==='solid'){
      if(l.id==='04-02.2'){
        const canvas=page.locator('#tw-solid canvas');await canvas.waitFor();
        const pixels=await canvas.evaluate(c=>{const t=document.createElement('canvas');t.width=c.width;t.height=c.height;const ctx=t.getContext('2d');ctx.drawImage(c,0,0);const data=ctx.getImageData(0,0,t.width,t.height).data;let count=0;for(let i=3;i<data.length;i+=4)if(data[i]>0)count++;return count;});assert.ok(pixels>10000,'solid is nonblank');
        const box=await canvas.boundingBox();await page.mouse.move(box.x+box.width*.1,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3,{steps:12});await page.mouse.up();
        const painted=await page.evaluate(id=>JSON.parse(localStorage.getItem('tideweave-progress')).records[id].state?.colors??[],l.id);assert.ok(painted.every(c=>c===-1),'drag cannot paint');
        await page.screenshot({path:'verification/solid-desktop.png'});
      }
      await click('[data-action="net"]');
    }
    if(['reach','forest','mst','matching','isolation','cut','reinforce','fault'].includes(l.type)){
      for(const i of answer.selected)await (l.type==='reach'||l.type==='isolation'||l.type==='fault'&&l.faultKind==='node'?node(i):edge(i));
    }else if(['groups','scc'].includes(l.type)){
      for(const [i,c] of answer.labels.entries()){await click(`[data-tool="${c}"]`);await node(i);}
    }else if(['color','solid'].includes(l.type)){
      for(const [i,c] of answer.colors.entries()){await click(`[data-tool="${c}"]`);await node(i);}
    }else if(['dfs','euler','shortest','postman'].includes(l.type)){
      for(const i of answer.path.slice(1))await node(i);
    }else if(l.type==='routes'){
      for(const [t,path] of answer.routes.entries()){await click(`[data-target="${t}"]`);for(const i of path.slice(1))await node(i);}
    }else if(['topo','cycle'].includes(l.type)){for(const i of answer.order)await node(i);}
    else if(l.type==='schedule'){for(const [i,b] of answer.boosts.entries())for(let k=0;k<b;k++)await node(i);}
    else if(l.type==='broadcast'){if(!l.fixedSource)await node(answer.source);for(let i=0;i<answer.prediction;i++)await click('[data-action="more"]');}
    else if(l.type==='floyd'){for(const pair of answer.pairs)await click(`[data-pair="${pair}"]`);}
    await run();const text=await page.locator('dialog').innerText();assert.match(text,/联运有序|设施恢复/,l.id+': '+text);
    results.push({id:l.id,type:l.type,pass:true});console.log('UI PASS',l.id,l.type);
    await click('[data-action="close"]');await click('.tw-mission-head [data-action="home"]');
  }
  for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1440,height:900}]){
    await page.setViewportSize(viewport);await page.screenshot({path:`verification/map-${viewport.width}.png`,fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow');
    await openLevel(levels[0]);await page.screenshot({path:`verification/board-${viewport.width}.png`,fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no board page overflow');
    await click('.tw-mission-head [data-action="home"]');
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await fs.writeFile('verification/ui-results.json',JSON.stringify({results,errors,external,viewports:[390,768,1440]},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
