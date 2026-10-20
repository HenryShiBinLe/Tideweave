import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {assetManifest, chapterSceneKeys} from '../src/assets.mjs';
import {levels, levelById, chapters} from '../src/levels.mjs';
import {initialState, solution} from '../src/engine.mjs';
import {graphBoard, regionBoard, netBoard} from '../src/board.mjs';

const images = Object.fromEntries(Object.entries(assetManifest).map(([id, asset]) => [id, asset.path]));
const count = (html, pattern) => [...html.matchAll(pattern)].length;

test('every registered material exists and all chapters have distinct backgrounds', async () => {
  await Promise.all(Object.values(assetManifest).map(asset => access(new URL('../' + asset.path, import.meta.url))));
  assert.equal(new Set(chapters.map(chapter => chapterSceneKeys[chapter.id])).size, chapters.length);
  for (const chapter of chapters) assert.ok(images[chapterSceneKeys[chapter.id]]);
});

test('physical graph stations all have art, while tasks and jobs keep semantic glyphs', () => {
  for (const level of levels.filter(level => !['color', 'solid'].includes(level.type))) {
    const html = graphBoard(level, initialState(level), {images});
    const expected = ['topo', 'cycle', 'schedule', 'matching'].includes(level.type) ? 0 : level.nodes.length;
    assert.equal(count(html, /class="station-asset"/g), expected, level.id);
  }
});

test('streets, districts and farmland select their own materials, with facility glyph fallback', () => {
  const renderNode = label => graphBoard({title:'test', type:'reach', nodes:[{label,x:100,y:100}], edges:[]}, {selected:[],labels:[-1],order:[]}, {images});
  for (const [label, key] of [['仓街','node_road_point'], ['桥区','node_district'], ['田区','node_field_entry'], ['东站','node_station'], ['北站','node_station'], ['北关','node_access_gate']]) {
    assert.ok(renderNode(label).includes(`class="station-asset" href="${images[key]}"`), label);
  }
  const level = levelById['01-01.1'];
  const html = graphBoard(level, initialState(level));
  assert.equal(count(html, /class="station-glyph"/g), level.nodes.length);
  assert.ok(!html.includes('has-asset'));
});

test('grouping keeps every facility, with a passive colored base and numbered badge', () => {
  for (const id of ['01-01.3', '01-S.2']) {
    const level = levelById[id], state = solution(level), before = structuredClone(state);
    const html = graphBoard(level, state, {images});
    assert.equal(count(html, /class="station-asset"/g), level.nodes.length);
    assert.equal(count(html, /class="station-group-surface"/g), level.nodes.length);
    assert.equal(count(html, /class="station-group-badge"/g), level.nodes.length);
    assert.deepEqual(state, before);
  }
});

test('field and net textures preserve the interactive polygons and solution data', () => {
  for (const level of levels.filter(level => ['color', 'solid'].includes(level.type))) {
    const state = solution(level), before = structuredClone(state);
    const render = (assets = {}) => level.type === 'color' ? regionBoard(level, state, {images:assets}) : netBoard(level, state, null, assets);
    const html = render(images), fallback = render();
    assert.equal(count(html, /data-node="/g), level.nodes.length);
    assert.deepEqual([...html.matchAll(/points="([^"]+)"/g)].map(m => m[1]), [...fallback.matchAll(/points="([^"]+)"/g)].map(m => m[1]));
    assert.ok(html.includes('url(#surface-'));
    assert.ok(fallback.includes('url(#pat-'));
    assert.deepEqual(state, before);
  }
});
