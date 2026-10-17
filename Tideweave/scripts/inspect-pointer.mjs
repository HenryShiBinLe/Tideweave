import { chromium } from 'playwright';
import { serve } from './preview.mjs';
import { levels } from '../src/levels.mjs';
import { solution, evaluate } from '../src/engine.mjs';
import { fresh, recordAttempt } from '../src/progress.mjs';
const p = fresh();
for (const l of levels) { const s = solution(l); recordAttempt(p,l,s,evaluate(l,s)); delete p.records[l.id].state; }
const server = await serve(), browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:940}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(p => localStorage.setItem('tideweave-progress',JSON.stringify(p)),p); await page.reload();
  await page.locator('[data-chapter="3"]').click(); await page.locator('[data-level="03-02.2"]').click();
  console.log(JSON.stringify(await page.locator('.network-edge').evaluateAll(edges => edges.map(el => {
    const line = el.querySelector('.edge-line'), point = line.getPointAtLength(line.getTotalLength()/2).matrixTransform(line.getScreenCTM());
    return {intended:el.dataset.edge,actual:document.elementFromPoint(point.x,point.y)?.closest('[data-edge]')?.dataset.edge ?? 'not an edge'};
  })),null,2));
  await page.screenshot({path:'verification/pointer-before.png'});
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
