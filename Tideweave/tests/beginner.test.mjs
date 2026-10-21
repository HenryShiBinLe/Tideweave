import test from 'node:test';
import assert from 'node:assert/strict';
import {levels,levelById,chapters} from '../src/levels.mjs';
import {fresh,normalize} from '../src/progress.mjs';
import {initialState,evaluate} from '../src/engine.mjs';
import {edgeGeometry} from '../src/board.mjs';

test('every level explains its goal, controls and constraints without prerequisite jargon',()=>{
  for(const l of levels){
    assert.ok(l.goal.length>5,l.id+' missing goal');
    assert.ok(l.controls.length>20,l.id+' missing operation explanation');
    assert.match(l.controls,/点|填/,l.id);
    assert.doesNotMatch(l.goal+l.controls,/奇度|偶度|欧拉|拓扑|生成树|强连通|增广|最小割|Dijkstra|Floyd|回溯|共棱|邻接/,l.id);
    assert.ok(l.rules.length>=(l.type==='groups'?1:2) && l.rules.length<=3,l.id);
    if(l.budget!==undefined && l.type!=='cut')assert.ok(l.goal.includes(String(l.budget)),l.id+' visible budget');
    if(l.deadline!==undefined)assert.ok(l.goal.includes(`${l.deadline} 天`),l.id+' visible deadline');
  }
});

test('chapter purposes and briefing completion persist without breaking legacy saves',()=>{
  for(const ch of chapters){assert.ok(ch.intro && ch.purpose && ch.outcome);assert.ok(ch.title.length<=6);}
  const old=fresh();delete old.briefings;assert.deepEqual(normalize(old).briefings,[]);
  assert.deepEqual(normalize({...old,briefings:[1,3,3,8,'2']}).briefings,[1,3]);
  assert.match(levelById['04-02.1'].controls,/不要求涂满/);
  assert.doesNotMatch(levelById['04-02.1'].rules.join(''),/隐藏的面也要上色/);
});

test('03-02.2 accepts different optimal routes and a non-optimal affordable network',()=>{
  const l=levelById['03-02.2'];
  for(const selected of [[0,1,3,5],[0,1,4,5],[0,2,3,5]]){
    const s={...initialState(l),selected};
    assert.equal(evaluate(l,s).metric,8);
    assert.equal(evaluate(l,s).perfect,true);
  }
  const r=evaluate(l,{...initialState(l),selected:[0,1,2,3,5]});
  assert.equal(r.metric,10);assert.equal(r.pass,true);assert.equal(r.perfect,false);
});

test('no graph road passes through the body of an unrelated facility',()=>{
  for(const l of levels.filter(l=>!['color','solid'].includes(l.type))){
    for(const [id,e] of l.edges.entries()){
      const geometry=edgeGeometry(l,e),task=['topo','cycle','schedule'].includes(l.type);
      for(let k=0;k<=100;k++){
        const p=geometry.point(k/100);
        for(const [j,n] of l.nodes.entries()){
          if(j===e.a||j===e.b)continue;
          assert.ok(!(Math.abs(p.x-n.x)<(task?57:33) && Math.abs(p.y-n.y)<(task?37:29)),`${l.id} edge ${id} crosses node ${j}`);
        }
      }
    }
  }
});

test('opposing arrows have separate visible paths; Floyd bypasses its middle station',()=>{
  const l=levelById['01-S.2'];
  assert.notDeepEqual(edgeGeometry(l,l.edges[0]).label,edgeGeometry(l,l.edges[1]).label);
  const f=levelById['02-S1.1'];
  assert.ok(edgeGeometry(f,f.edges[2]).label.y<f.nodes[1].y-60);
});

test('every road overlaps its station plate so card corners never leave a visible gap',()=>{
  for(const l of levels.filter(l=>!['color','solid'].includes(l.type))){
    for(const e of l.edges){
      const geometry=edgeGeometry(l,e),task=['topo','cycle','schedule'].includes(l.type);
      for(const [point,id] of [[geometry.start,e.a],[geometry.end,e.b]]){
        const dx=Math.abs(point.x-l.nodes[id].x),dy=Math.abs(point.y-l.nodes[id].y);
        assert.ok(Number.isFinite(dx+dy),l.id);
        if(task)assert.ok(dx<58&&dy<34&&dx+dy<81,`${l.id}: road must reach beneath the task's clipped plate`);
        else assert.ok(Math.hypot(dx,dy)<24,`${l.id}: road must reach beneath the fallback facility`);
      }
    }
  }
});
