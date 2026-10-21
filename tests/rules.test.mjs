import test from 'node:test';
import assert from 'node:assert/strict';
import {levels,levelById,units} from '../src/levels.mjs';
import {solution,evaluate,initialState,optimization,act} from '../src/engine.mjs';
import {groups,faults,chromatic,postman,criticalSchedule,floydStages,strongGroups} from '../src/algorithms.mjs';
import {fresh,normalize,recordAttempt,cleanState} from '../src/progress.mjs';
import {GameSession} from '../src/session.mjs';
import {solids,faceTopology} from '../src/solids.mjs';

for(const l of levels)test(`playable ${l.id} ${l.type}`,()=>{const result=evaluate(l,solution(l));assert.equal(result.pass,true);assert.equal(result.perfect,!l.tutorial);assert.ok(result.frames.length);for(const id of l.requires)assert.ok(levelById[id]);});
test('20 units, acyclic unlock graph and all levels present',()=>{
  assert.equal(units.length,20);assert.equal(new Set(levels.map(l=>l.id)).size,levels.length);
  for(const l of levels){const seen=new Set();const visit=id=>{assert.ok(!seen.has(id));seen.add(id);levelById[id].requires.forEach(visit);seen.delete(id);};visit(l.id);}
});
test('independently specified optima',()=>{
  const expected={'01-03.1':3,'01-03.2':3,'01-04.1':7,'01-04.2':7,'02-02.1':8,'02-02.2':11,'02-03.1':14,'02-03.2':29,'02-S2.1':7,'02-S2.2':23,'03-01.1':5,'03-01.2':9,'03-02.1':17,'03-02.2':8,'03-04.1':1,'03-04.2':5,'04-01.2':2,'04-01.3':3,'04-01.4':4,'04-02.2':4,'04-02.3':3,'04-03.1':3,'04-03.2':5,'05-02.1':2,'05-02.2':1,'05-03.1':3,'05-03.2':5,'05-03.3':5};
  for(const [id,n] of Object.entries(expected))assert.equal(optimization(levelById[id]),n,id);
});
test('alternate topological order and tied trees are accepted',()=>{
  const l=levelById['03-03.2'];for(const order of [[0,1,3,2,4,5,6],[0,2,5,1,4,3,6]]){const s=initialState(l);s.order=order;assert.ok(evaluate(l,s).pass);}
  const m=levelById['03-02.2'];for(const selected of [[0,1,3,5],[0,1,4,5]]){const s=initialState(m);s.selected=selected;assert.ok(evaluate(m,s).perfect);}
});
test('color names can permute and overcoloring still passes',()=>{
  const l=levelById['04-02.3'],s=solution(l);s.colors=s.colors.map(c=>[4,5,3][c]);assert.ok(evaluate(l,s).perfect);
  s.colors[0]=0;assert.ok(evaluate(l,s).pass);assert.equal(evaluate(l,s).perfect,false);
  s.colors.fill(0);assert.equal(evaluate(l,s).pass,false);
});
test('bridge and cut vertex are distinct',()=>{const l=levelById['05-01.3'];assert.deepEqual(faults(l,'edge'),[]);assert.deepEqual(faults(l,'node'),[2,4]);const isolated={nodes:[{},{}],edges:[]};assert.deepEqual(faults(isolated,'node'),[]);});
test('multiple critical branches need coordinated boosts',()=>{const l=levelById['03-04.2'];assert.equal(criticalSchedule(l,[0,1,0,0,1,0,0]).total,9);assert.equal(criticalSchedule(l,[0,1,0,1,1,2,0]).total,6);});
test('complete Floyd stages preserve previously opened transit vertices',()=>{const stages=floydStages(levelById['02-S1.2']);assert.equal(stages.length,5);assert.equal(stages.at(-1).after[2][3],6);assert.deepEqual(stages[1].improved,['0-3','0-4','2-3','2-4','3-4']);});
test('SCC groups are maximal and singleton tails persist',()=>{assert.deepEqual(strongGroups(levelById['01-S.2']).map(x=>x.length).sort(),[1,1,2,2]);});
test('hint attempts persist through reset and undo; tutorials excluded',()=>{
  const p=fresh(),l=levelById['01-01.1'],g=new GameSession(l,p);g.change('node',0);
  for(let i=0;i<3;i++)g.finish(g.check());assert.equal(p.records[l.id].hintUnlocked,true);
  g.reset();g.undo();assert.equal(p.records[l.id].attempts,3);assert.deepEqual(g.state.selected,[0]);
  assert.equal(normalize(p).records[l.id].hintUnlocked,true);
  const t=levelById['03-03.1'];recordAttempt(p,t,solution(t),evaluate(t,solution(t)));assert.equal(p.records[t.id].attempts,0);
});
test('undo and redo restore full color, source and sequence state',()=>{const p=fresh(),l=levelById['04-01.2'],g=new GameSession(l,p);g.change('node',0,3);g.change('node',1,4);g.undo();assert.deepEqual(g.state.colors,[3,...Array(8).fill(-1)]);g.redo();assert.deepEqual(g.state.colors,[3,4,...Array(7).fill(-1)]);});
test('invalid imported path and duplicate topological task are cleared',()=>{const l=levelById['02-02.1'];assert.deepEqual(cleanState(l,{path:[0,4]}).path,[0]);const t=levelById['03-03.2'];assert.deepEqual(cleanState(t,{order:[0,0,0,0,0]}).order,[]);});
test('solid topology and net geometry are consistent at every uncut seam',()=>{
  for(const solid of Object.values(solids)){
    const edges=faceTopology(solid);assert.ok(edges.every(e=>Number.isInteger(e.b)));assert.equal(solid.vertices.length-edges.length+solid.faces.length,2);
    const segments=[];solid.net.forEach((p,i)=>{const poly=solid.faces.length===6?[[p[0],p[1]],[p[0]+140,p[1]],[p[0]+140,p[1]+140],[p[0],p[1]+140]]:p;assert.deepEqual([...solid.netVertices[i]].sort(),[...solid.faces[i]].sort());poly.forEach((p,j)=>segments.push({xy:[p,poly[(j+1)%poly.length]].map(x=>x.join(',')).sort().join('/'),key:[solid.netVertices[i][j],solid.netVertices[i][(j+1)%poly.length]].sort((a,b)=>a-b).join('-')}));});
    const byPosition=Map.groupBy(segments,e=>e.xy);for(const pair of byPosition.values())if(pair.length===2)assert.equal(pair[0].key,pair[1].key);
    for(const edge of edges)assert.equal(segments.filter(s=>s.key===edge.key).length,2);
  }
});
