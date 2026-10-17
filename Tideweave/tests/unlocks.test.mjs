import test from 'node:test';
import assert from 'node:assert/strict';
import {chapters,levels,levelById,units} from '../src/levels.mjs';
import {fresh,unlocked,normalize,recordAttempt} from '../src/progress.mjs';
import {solution,evaluate} from '../src/engine.mjs';

test('each optional unit opens after its own chapter, without later chapters or medals',()=>{
  for(const unit of units.filter(u=>u.optional)){
    const p=fresh(),main=levels.filter(l=>l.chapter===unit.chapter&&!l.optional);
    const first=levels.find(l=>l.unit===unit.id);
    assert.equal(unlocked(p,first),false);
    for(const l of main.slice(0,-1))p.records[l.id]={passed:true,perfect:false};
    assert.equal(unlocked(p,first),false,'the last ordinary level must be passed');
    p.records[main.at(-1).id]={passed:true,perfect:false};
    assert.equal(unlocked(p,first),true,unit.id);
    assert.ok(first.requires.every(id=>levelById[id].chapter===unit.chapter&&!levelById[id].optional));
  }
});

test('optional levels keep their internal order and cannot bypass an unfinished ordinary level',()=>{
  for(const unit of units.filter(u=>u.optional)){
    const p=fresh(),main=levels.filter(l=>l.chapter===unit.chapter&&!l.optional);
    for(const l of main)p.records[l.id]={passed:true};
    for(const l of levels.filter(l=>l.unit===unit.id)){
      if(l.step>1){
        const previous=levelById[l.requires.at(-1)];
        delete p.records[previous.id];assert.equal(unlocked(p,l),false);
        p.records[previous.id]={passed:true};
      }
      assert.equal(unlocked(p,l),true);
      delete p.records[main[0].id];assert.equal(unlocked(p,l),false);
      p.records[main[0].id]={passed:true};p.records[l.id]={passed:true};
    }
  }
});

test('optional missions never block the next ordinary chapter',()=>{
  const p=fresh();
  for(const ch of chapters.slice(0,-1)){
    for(const l of levels.filter(l=>l.chapter===ch.id&&!l.optional))p.records[l.id]={passed:true,perfect:false};
    const next=levels.find(l=>l.chapter===ch.id+1&&!l.optional);
    assert.equal(unlocked(p,next),true);
    assert.ok(Object.keys(p.records).every(id=>!levelById[id].optional));
  }
});

test('legacy saves gain chapter-local optional unlocks without changing solved records',()=>{
  const p=fresh();delete p.briefings;
  for(const l of levels.filter(l=>l.chapter===1&&!l.optional)){
    const s=solution(l);recordAttempt(p,l,s,evaluate(l,s));
  }
  const restored=normalize(p);
  assert.equal(unlocked(restored,levelById['01-S.1']),true);
  for(const [id,r] of Object.entries(p.records))assert.deepEqual(restored.records[id].best,r.best);
  assert.deepEqual(restored.briefings,[]);
});
