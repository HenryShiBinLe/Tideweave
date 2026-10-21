import test from 'node:test';
import assert from 'node:assert/strict';
import { levels, levelById } from '../src/levels.mjs';
import { algorithmReplay, evaluate, initialState } from '../src/engine.mjs';
import { groups, cycle, maximumMatching, mst } from '../src/algorithms.mjs';
import { condensation, matchingReplay, treeReplay } from '../src/replays.mjs';
import { graphBoard, condensedBoard, distanceTable } from '../src/board.mjs';

test('replays carry their own valid solution without mutating levels', () => {
  for (const l of levels) {
    const before = structuredClone(l), replay = algorithmReplay(l);
    assert.deepEqual(l, before); assert.ok(replay.frames.length); assert.ok(evaluate(l, replay.state).pass);
  }
});
test('Prim accepts only the lowest cost crossing edge', () => {
  for (const l of levels.filter(l => l.unit === '03-01')) {
    const visited = new Set([l.source]), selected = [];
    for (const f of treeReplay(l).frames.filter(f => f.phase === 'accept')) {
      const added = f.edges.find(i => !selected.includes(i)), e = l.edges[added];
      assert.notEqual(visited.has(e.a), visited.has(e.b));
      const minimum = Math.min(...l.edges.filter(x => visited.has(x.a) !== visited.has(x.b)).map(x => x.w));
      assert.equal(e.w, minimum); selected.push(added); visited.add(e.a); visited.add(e.b);
    }
    assert.equal(visited.size, l.nodes.length); assert.equal(selected.reduce((a, i) => a + l.edges[i].w, 0), mst(l).cost);
  }
});
test('Kruskal exposes cycle rejection and yields exact minimum forest', () => {
  for (const l of levels.filter(l => l.type === 'forest' || l.unit === '03-02')) {
    const frames = treeReplay(l).frames;
    for (const f of frames.filter(f => f.phase === 'reject')) {
      const e = l.edges[f.focusEdges[0]];
      assert.ok(groups(l, f.edges).find(g => g.includes(e.a)).includes(e.b));
      assert.ok(!f.edges.includes(f.focusEdges[0]));
    }
    assert.equal(frames.at(-1).edges.reduce((a, i) => a + l.edges[i].w, 0), mst(l).cost);
  }
  assert.ok(treeReplay(levelById['03-02.2']).frames.some(f => f.phase === 'reject'));
});
test('augmentation flips an alternating odd chain and adds exactly one job', () => {
  let longChain = false;
  for (const l of levels.filter(l => l.type === 'matching')) {
    let before = [];
    for (const frame of matchingReplay(l).frames) {
      const ends = frame.edges.flatMap(i => [l.edges[i].a, l.edges[i].b]);
      assert.equal(new Set(ends).size, ends.length, 'every committed frame is a matching');
      if (frame.phase !== 'augment') continue;
      const chain = frame.augmentation;
      assert.equal(chain.length % 2, 1);
      chain.forEach((edge, i) => assert.equal(before.includes(edge), i % 2 === 1));
      const flipped = [...before.filter(i => !chain.includes(i)), ...chain.filter(i => !before.includes(i))];
      assert.deepEqual([...frame.edges].sort(), flipped.sort());
      assert.equal(frame.edges.length, before.length + 1);
      if (chain.length > 1) longChain = true;
      before = frame.edges;
    }
    assert.equal(before.length, maximumMatching(l).length);
  }
  assert.ok(longChain, 'at least one current level demonstrates a real reassignment');
});
test('condensation preserves intergroup directions, removes internal and duplicate edges', () => {
  for (const l of levels.filter(l => l.type === 'scc')) {
    const c = condensation(l);
    assert.ok(c.edges.every(e => e.a !== e.b));
    const expected = [...new Set(l.edges.filter(e => c.labels[e.a] !== c.labels[e.b]).map(e => `${c.labels[e.a]}-${c.labels[e.b]}`))];
    assert.deepEqual(c.edges.map(e => `${e.a}-${e.b}`).sort(), expected.sort());
    assert.deepEqual(cycle({ nodes: c.components, edges: c.edges }), []);
    assert.match(condensedBoard(l, c), /强连通缩点/);
    assert.ok(!condensedBoard(l, c).includes('data-node='));
  }
});
test('Dijkstra replay respects directed arcs and tentative versus settled labels', () => {
  const l = { ...levelById['02-02.1'], directed: true, target: 2,
    nodes: levelById['02-02.1'].nodes.slice(0, 3), edges: [{a:0,b:1,w:2},{a:2,b:0,w:1},{a:1,b:2,w:4}] };
  const replay = algorithmReplay(l);
  assert.deepEqual(replay.frames[0].values, [0, 2, Infinity]);
  assert.deepEqual(replay.frames.at(-1).values, [0, 2, 6]);
  const markup = graphBoard(l, initialState(l), {frame: replay.frames[0]});
  assert.match(markup, /已确认 0/); assert.match(markup, /暂定 2/);
});
test('route frames move the token with the executed prefix', () => {
  const l = levelById['02-02.1'], replay = algorithmReplay(l);
  const result = evaluate(l, replay.state), first = result.frames[0], last = result.frames.at(-1);
  assert.deepEqual(first.path, [l.source]); assert.deepEqual(last.path, replay.state.path);
  assert.match(graphBoard(l, replay.state, {frame:first}), new RegExp(`current[^>]+data-node="${l.source}"`));
});
test('Floyd replay matrix presents the current stage, not a fixed question table', () => {
  const l = levelById['02-S1.2'], replay = algorithmReplay(l);
  const markup = distanceTable(l, replay.frames.at(-1).matrix);
  assert.match(markup, /距离矩阵/); assert.match(markup, /<td>6<\/td>/); assert.ok(!markup.includes('data-pair'));
});
