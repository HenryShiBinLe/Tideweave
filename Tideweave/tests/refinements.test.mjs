import test from 'node:test';
import assert from 'node:assert/strict';
import {levels,levelById,legacyLevelById} from '../src/levels.mjs';
import {initialState,solution,evaluate,reinforcementValid} from '../src/engine.mjs';
import {fresh,normalize,recordAttempt,unlocked} from '../src/progress.mjs';
import {floydStages} from '../src/algorithms.mjs';
import {solids,faceTopology} from '../src/solids.mjs';

test('cycle task explicitly accepts only the closed subset, not all tasks',()=>{
  const l=levelById['03-03.3'];
  assert.match(l.goal,/不需要.*所有任务/);
  assert.ok(evaluate(l,{...initialState(l),order:[1,2,3,1]}).pass);
  assert.equal(evaluate(l,{...initialState(l),order:[0,1,2,3,1,4]}).pass,false);
});
test('first transit change has two independent hand-calculated answers',()=>{
  const l=levelById['02-S1.1'],stage=floydStages(l)[0];
  assert.equal(stage.before[1][2],9);assert.equal(stage.after[1][2],5);
  assert.equal(stage.before[2][3],Infinity);assert.equal(stage.after[2][3],8);
  assert.equal(stage.after[1][3],1);
  assert.ok(evaluate(l,{...initialState(l),pairs:['1-2','2-3']}).pass);
  assert.equal(evaluate(l,{...initialState(l),pairs:['1-2']}).pass,false);
});
test('Floyd stages equal exhaustive legal simple paths, including unchanged pairs',()=>{
  for(const l of levels.filter(l=>l.type==='floyd'))for(const stage of floydStages(l)){
    for(let a=0;a<l.nodes.length;a++)for(let b=a+1;b<l.nodes.length;b++){
      let best=Infinity;
      const walk=(at,seen,cost)=>{
        if(at===b){best=Math.min(best,cost);return;}
        if(at!==a&&at>stage.k)return;
        for(const e of l.edges){const next=e.a===at?e.b:e.b===at?e.a:-1;if(next<0||seen.includes(next))continue;walk(next,[...seen,next],cost+e.w);}
      };
      walk(a,[a],0);assert.equal(stage.after[a][b],best,`${l.id} stage ${stage.k} ${a}-${b}`);
    }
  }
});
test('new reinforcement finales require combinations for the best cost',()=>{
  for(const id of ['05-03.2','05-03.3']){
    const l=levelById[id],c=l.edges.map((e,i)=>e.candidate?i:-1).filter(i=>i>=0);
    for(const i of c)assert.ok(!evaluate(l,{...initialState(l),selected:[i]}).perfect);
    assert.ok(reinforcementValid(l,c.slice(0,2)));
    assert.ok(evaluate(l,{...initialState(l),selected:c.slice(0,2)}).perfect);
  }
});
test('solid progression uses three different structures with more faces',()=>{
  assert.deepEqual(levels.filter(l=>l.type==='solid').map(l=>l.solid),['tetra','prism','truncated']);
  assert.equal(solids.truncated.faces.length,14);
  for(const name of ['prism','truncated']){
    const s=solids[name],segments=faceTopology(s);
    assert.equal(segments.length,s.faces.reduce((n,f)=>n+f.length,0)/2);
    assert.equal(s.net.length,s.faces.length);
    for(const p of s.net.flat())assert.ok(p[0]>=50&&p[0]<=950&&p[1]>=40&&p[1]<=560);
  }
});
test('past achievements survive revised content without treating old arrays as new solutions',()=>{
  const p=fresh();
  for(const l of Object.values(legacyLevelById)){const s=solution(l);recordAttempt(p,l,s,evaluate(l,s));}
  const migrated=normalize(p);
  for(const l of levels.filter(l=>l.revision===2)){
    const r=migrated.records[l.id];assert.ok(r.passed);assert.ok(r.legacy);assert.equal(r.best,null);
    assert.deepEqual(r.state,initialState(l));assert.ok(unlocked(migrated,l));
  }
  assert.deepEqual(normalize(migrated),migrated,'migration is idempotent');
  const l=levelById['04-02.3'],answer=solution(l);recordAttempt(migrated,l,answer,evaluate(l,answer));
  assert.ok(normalize(migrated).records[l.id].best);assert.equal(normalize(migrated).records[l.id].legacy,false);
});
test('changed color puzzles have a real pass constraint, not an unlimited color bypass',()=>{
  const l=levelById['04-02.3'],s=solution(l);s.colors[0]=3;s.colors[1]=4;
  assert.equal(evaluate(l,s).pass,false);assert.match(evaluate(l,s).message,/最多 4 色/);
  s.colors=[0,1];assert.equal(evaluate(l,s).valid,false);
});
