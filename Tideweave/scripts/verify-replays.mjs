import {uiClick,selectMission} from './ui-navigation.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { serve } from './preview.mjs';
import { levels, levelById } from '../src/levels.mjs';
import { initialState, solution, evaluate, algorithmReplay } from '../src/engine.mjs';
import { fresh, recordAttempt } from '../src/progress.mjs';
const progress = fresh();
for (const l of levels) {
  const solved = solution(l); recordAttempt(progress, l, solved, evaluate(l, solved));
  progress.records[l.id].state = initialState(l);
}
progress.records['04-03.2'].state.selected = [0];
progress.settings.motion = true; progress.settings.speed = 0.5; progress.briefings = [1,2,3,4,5];
const server = await serve(), browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:940}}), errors = [];
page.on('pageerror', e => errors.push(e.message));
const click = selector => uiClick(page,selector);
const seek = async index => page.locator('[data-frame]').evaluate((el, i) => {
  el.value = i === 'last' ? el.max : String(i); el.dispatchEvent(new Event('input', {bubbles:true}));
}, index);
const saved = id => page.evaluate(id => JSON.parse(localStorage.getItem('tideweave-progress')).records[id], id);
const enter = async id => {
  await click(`[data-chapter="${levelById[id].chapter}"]`); await click(`[data-level="${id}"]`);
  await click('[data-action="replay"]'); await seek(0);
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(p => localStorage.setItem('tideweave-progress', JSON.stringify(p)), progress); await page.reload();
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:940});
    await enter('04-03.2');
    const before = await saved('04-03.2');
    assert.equal(await page.locator('.network-edge.selected').count(), 0, 'empty reference state, not saved player selection');
    const pathIndex = algorithmReplay(levelById['04-03.2']).frames.findIndex(f => f.phase === 'path' && f.augmentation.length > 1);
    await seek(pathIndex); assert.ok(await page.locator('.replay-focus').count() >= 3);
    await page.screenshot({path:`verification/replay-matching-${width}.png`,fullPage:true});
    await seek('last'); assert.equal(await page.locator('.network-edge.selected').count(), 5);
    await click('[data-action="compare-replay"]'); await seek('last');
    assert.match(await page.locator('.tw-context-tools output').textContent(), /我的最佳/);
    await click('[data-action="edit"]'); assert.equal(await page.locator('.network-edge.selected').count(), 1);
    assert.deepEqual(await saved('04-03.2'), before, 'replay must not overwrite the in-progress state or scoring');
    await click('.tw-mission-head [data-action="home"]');
    await enter('01-S.2'); await seek('last');
    assert.equal(await page.locator('.station').count(), 4); assert.equal(await page.locator('.network-edge').count(), 3);
    assert.equal(await page.locator('[data-node]').count(), 0);
    await page.screenshot({path:`verification/replay-condensed-${width}.png`,fullPage:true});
    await click('.tw-mission-head [data-action="home"]');
    await enter('02-S1.2'); await seek('last');
    assert.equal(await page.locator('.replay-matrix tbody tr').count(), 5);
    assert.equal(await page.locator('.replay-matrix tbody tr').nth(2).locator('td').nth(3).textContent(), '6');
    await page.screenshot({path:`verification/replay-floyd-${width}.png`,fullPage:true});
    await click('.tw-mission-head [data-action="home"]');
    await enter('03-02.2');
    const skip = algorithmReplay(levelById['03-02.2']).frames.findIndex(f => f.phase === 'reject');
    await seek(skip); assert.match(await page.locator('.tw-playback').textContent(), /会成环/);
    await page.screenshot({path:`verification/replay-tree-${width}.png`,fullPage:true});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await click('.tw-mission-head [data-action="home"]');
  }
  assert.deepEqual(errors, []);
  await fs.writeFile('verification/replay-results.json', JSON.stringify({pass:true,viewports:[1440,390],matchingChain:true,condensation:true,floydMatrix:true,cycleRejection:true,playerStateUnchanged:true,errors},null,2));
  console.log('Replay UI passed: real augmentation, condensation, matrix, cycle rejection and unchanged player save.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
