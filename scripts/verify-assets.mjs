import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {serve} from './preview.mjs';
import {uiClick} from './ui-navigation.mjs';
import {levels, levelById} from '../src/levels.mjs';
import {assetManifest, chapterSceneKeys} from '../src/assets.mjs';
import {fresh, recordAttempt} from '../src/progress.mjs';
import {solution, evaluate} from '../src/engine.mjs';

await fs.mkdir('verification', {recursive:true});
const server = await serve(), url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({channel:'msedge', headless:true, args:['--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:1440,height:940}, reducedMotion:'reduce'});
  const errors = [], failures = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {if (response.status() >= 400) failures.push(response.url());});
  page.on('request', request => {if (/^https?:/.test(request.url()) && !request.url().startsWith(url)) external.push(request.url());});
  const click = selector => uiClick(page, selector);
  await page.goto(url);
  await page.locator('.tw-city-art').evaluate(image => image.decode());
  await page.waitForFunction(() => document.querySelector('#tw-city')?.hidden === true);
  assert.ok(await page.locator('.tw-city-art').isVisible(), 'home art is visible above the fallback scene');
  await page.screenshot({path:'verification/assets-home-1440.png',fullPage:true});
  const decoded = await page.evaluate(async assets => Promise.all(Object.entries(assets).map(async ([key, asset]) => {
    const image = new Image(); image.src = asset.path; await image.decode();
    return {key, width:image.naturalWidth, height:image.naturalHeight};
  })), assetManifest);
  for (const asset of decoded) assert.deepEqual([asset.width,asset.height],assetManifest[asset.key].size,asset.key);
  const seed = fresh(); seed.settings.motion = false;
  for (const level of levels) {const state = solution(level);recordAttempt(seed,level,state,evaluate(level,state));delete seed.records[level.id].state;}
  await page.evaluate(data => localStorage.setItem('tideweave-progress',JSON.stringify(data)),seed);
  await page.reload();
  for (const viewport of [{width:1440,height:940},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    for (const id of ['01-01.3','02-01.3','02-02.2','03-01.2','04-01.3','05-03.1']) {
      const level = levelById[id];
      await click(`[data-level="${id}"]`);
      await click('[data-action="reset"]');await click('[data-action="confirm-reset"]');
      const scene = page.locator('.tw-chapter-scene');
      assert.equal(await scene.getAttribute('src'),assetManifest[chapterSceneKeys[level.chapter]].path);
      await scene.evaluate(image => image.decode());
      assert.equal(await scene.evaluate(image => getComputedStyle(image).pointerEvents),'none');
      if (viewport.width === 1440) {
        assert.ok((await page.locator('.tw-task').boundingBox()).height < 100, 'objective and controls leave room for the board');
        assert.ok((await page.locator('.tw-board').boundingBox()).height > viewport.height * .6, 'board is the main play area');
      }
      if (id === '02-02.2') {
        const vehicle = page.locator('.station-dispatch-asset');
        const vehicleBox = await vehicle.boundingBox(), boardBox = await page.locator('.tw-board').boundingBox();
        assert.ok(vehicleBox.width > 30);
        assert.ok(vehicleBox.x >= boardBox.x && vehicleBox.x + vehicleBox.width <= boardBox.x + boardBox.width, 'vehicle stays within board');
        const point = await page.locator(`[data-node="${level.source}"] .station-body`).evaluate(element => {const box=element.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};});
        assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-node]')?.dataset.node,point),String(level.source),'vehicle and selection art do not intercept facility clicks');
        const outerPoint = await page.locator(`[data-node="${level.source}"]`).evaluate(element => {
          const p = new DOMPoint(47,0).matrixTransform(element.getScreenCTM());
          return {x:p.x,y:p.y};
        });
        assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-node]')?.dataset.node,outerPoint),String(level.source),'enlarged facility can be clicked beyond the old central hit target');
      }
      if (id === '01-01.3' || id === '04-01.3') {
        const values = solution(level)[id === '01-01.3' ? 'labels' : 'colors'];
        for (const [i, color] of values.entries()) {await click(`[data-tool="${color}"]`);await page.locator(`[data-node="${i}"]`).press('Enter');}
        if (id === '01-01.3') {
          assert.equal(await page.locator('.station-asset').count(),level.nodes.length);
          assert.equal(await page.locator('.station-group-badge').count(),level.nodes.length);
        } else assert.match(await page.locator('.region polygon').first().getAttribute('fill'),/^url\(#surface-/);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({path:`verification/assets-${id}-${viewport.width}.png`,fullPage:true});
    }
    await click('[data-level="04-02.3"]');
    await click('[data-action="reset"]');await click('[data-action="confirm-reset"]');
    const canvas = page.locator('#tw-solid canvas');
    await canvas.waitFor();
    await page.waitForFunction(() => document.querySelector('#tw-solid canvas')?.dataset.surface === 'loaded');
    const fingerprint = () => canvas.evaluate(canvas => {
      const copy = document.createElement('canvas');copy.width = canvas.width;copy.height = canvas.height;
      const ctx = copy.getContext('2d');ctx.drawImage(canvas,0,0);
      const data = ctx.getImageData(0,0,copy.width,copy.height).data;
      let painted = 0, hash = 0;
      for (let i=0;i<data.length;i+=4) {if(data[i+3])painted++;if(i%64===0)hash=(hash*31+data[i]+data[i+1]*2+data[i+2]*3)>>>0;}
      return {painted,hash};
    });
    const before = await fingerprint(); assert.ok(before.painted > 10000);
    await canvas.focus();await page.keyboard.press('ArrowRight');
    const rotated = await fingerprint();assert.notEqual(rotated.hash,before.hash);
    const colors = solution(levelById['04-02.3']).colors;
    for (const [i,color] of colors.entries()) {
      await click(`[data-tool="${color}"]`);
      await page.selectOption('[data-face]',String(i));
      await click('[data-action="paint-face"]');
    }
    await page.waitForFunction(() => document.querySelector('#tw-solid canvas')?.dataset.surface === 'loaded');
    assert.ok((await fingerprint()).painted > 10000);
    await page.screenshot({path:`verification/assets-solid-${viewport.width}.png`,fullPage:true});
    await click('[data-action="net"]');
    assert.equal(await page.locator('.region').count(),colors.length);
    for (const [i,color] of colors.entries()) assert.equal(await page.locator(`[data-node="${i}"] polygon`).getAttribute('fill'),`url(#surface-${color})`);
    await page.screenshot({path:`verification/assets-net-${viewport.width}.png`,fullPage:true});
    await click('[data-action="run"]');await page.waitForSelector('dialog');
    assert.match(await page.locator('dialog h2').innerText(),/联运有序/);
    await click('[data-action="close"]');
  }
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);assert.deepEqual(external,[]);
  await fs.writeFile('verification/assets-results.json',JSON.stringify({pass:true,decoded,chapters:5,groupArtRetained:true,solidTexture:true,solidRotation:true,netColorParity:true,viewports:[1440,390],errors,failures,external},null,2));
  console.log(`Assets passed: ${decoded.length} images decoded; five backgrounds; grouped facilities; solid/net coloring; desktop/mobile.`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
