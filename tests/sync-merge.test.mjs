// 云同步合并逻辑测试。规则见 docs/云同步-技术方案.md 第五部分。
import test from 'node:test';
import assert from 'node:assert/strict';
import {levels,levelById,legacyLevelById} from '../src/levels.mjs';
import {initialState,solution,evaluate} from '../src/engine.mjs';
import {fresh,normalize,recordAttempt} from '../src/progress.mjs';
import {merge,checkNoRegression} from '../src/sync/merge.mjs';
import {statePath} from '../src/sync/clock.mjs';
import {stableJSON} from '../src/sync/util.mjs';

// ---- 构造数据的小工具 ----
// 用某个方案完成一次运行，和游戏里点“运行检查”走同一条路（recordAttempt）
function play(save,level,state=solution(level)){recordAttempt(save,level,state,evaluate(level,state));return save;}
// 一边的同步数据：存档 + 同步层记的时间
const side=(save,fields={},savedAt=0)=>({save,clock:{fields,savedAt}});
// 只有编辑现场、还没运行过的记录
function editing(level,edit){const s=initialState(level);edit(s);const p=fresh();p.records[level.id]={revision:level.revision??1,state:s,attempts:0,hintUnlocked:false};return normalize(p);}
// 可复现的伪随机数（mulberry32），让随机测试每次结果一样
function rng(seed){return()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
// 随机构造一台设备的进度：部分关通关，部分关留着编辑现场（初始或参考答案），随机的修改时间
function randomDevice(random,t0){
  const p=fresh(),fields={};
  for(const l of levels){
    const roll=random();
    if(roll<0.35)play(p,l);
    else if(roll<0.55)p.records[l.id]={revision:l.revision??1,state:random()<0.5?initialState(l):solution(l),attempts:Math.floor(random()*5),hintUnlocked:random()<0.3};
    else continue;
    if(random()<0.7)fields[statePath(l.id)]=t0+Math.floor(random()*1000);
  }
  p.last=levels[Math.floor(random()*levels.length)].id;p.chapter=1+Math.floor(random()*5);
  p.summaries=[1,2,3,4,5].filter(()=>random()<0.3);p.briefings=[1,2,3,4,5].filter(()=>random()<0.3);
  fields.last=t0+Math.floor(random()*1000);
  return side(normalize(p),fields,t0+1000);
}
const passedIds=save=>Object.keys(save.records).filter(id=>save.records[id].passed);
const perfectIds=save=>Object.keys(save.records).filter(id=>save.records[id].perfect);

test('云端为空：本机存档原样成为云端副本',()=>{
  const save=normalize(play(fresh(),levelById['01-01.1']));
  const r=merge(side(save,{},5),null);
  assert.equal(r.status,'ok');assert.equal(r.cloudChanged,true);assert.equal(r.localChanged,false);
  assert.deepEqual(normalize(r.cloud.save),save);assert.deepEqual(r.local.save,save);
});

test('累积型字段：两台设备的通关合在一起，尝试次数取较大，提示解锁取或，章节标记取并集',()=>{
  const a=play(fresh(),levelById['01-01.1']),b=play(fresh(),levelById['01-01.2']);
  a.records['01-01.1'].attempts=7;
  b.records['01-01.1']={revision:1,attempts:2,hintUnlocked:true,passed:false,perfect:false};
  a.summaries=[1,4];b.summaries=[2,1];a.briefings=[1];b.briefings=[3];
  const r=merge(side(normalize(a)),side(normalize(b)));
  const p=r.local.save;
  assert.ok(p.records['01-01.1'].passed);assert.ok(p.records['01-01.2'].passed);
  assert.equal(p.records['01-01.1'].attempts,7);assert.equal(p.records['01-01.1'].hintUnlocked,true);
  assert.deepEqual(p.summaries,[1,2,4]);assert.deepEqual(p.briefings,[1,3]);
  assert.deepEqual(r.cloud.save.summaries,[1,2,4]);
});

test('最佳方案：先验证再比较，哪边更好留哪边；指标好看但不成立的方案不会被留下',()=>{
  const l=levelById['04-02.3'],perfect=solution(l);
  const fourColors=structuredClone(perfect);fourColors.colors=fourColors.colors.map(c=>[4,5,3][c]);fourColors.colors[0]=0;
  assert.ok(evaluate(l,fourColors).pass&&!evaluate(l,fourColors).perfect,'测试数据：四色方案通过但不完美');
  const withBest=s=>normalize(play(fresh(),l,s));
  for(const [mine,theirs] of [[fourColors,perfect],[perfect,fourColors]]){
    const r=merge(side(withBest(mine)),side(withBest(theirs)));
    assert.equal(r.local.save.records[l.id].perfect,true);
    assert.equal(evaluate(l,r.cloud.save.records[l.id].best).perfect,true);
  }
  // 云端那份声称完美、指标更好，但方案本身不成立（所有面同色）
  const forged=withBest(fourColors);
  forged.records[l.id]={...forged.records[l.id],best:{...perfect,colors:perfect.colors.map(()=>0)},bestMetric:1,perfect:true};
  const r=merge(side(withBest(fourColors)),side(forged));
  const rec=r.local.save.records[l.id];
  assert.equal(rec.passed,true);assert.equal(rec.perfect,false);assert.equal(rec.bestMetric,4);
});

test('同分方案保留云端的，两台设备反复同步不会来回替换',()=>{
  const l=levelById['03-02.2'];
  const treeA={...initialState(l),selected:[0,1,3,5]},treeB={...initialState(l),selected:[0,1,4,5]};
  assert.ok(evaluate(l,treeA).perfect&&evaluate(l,treeB).perfect,'测试数据：两棵树都是完美解');
  const a=normalize(play(fresh(),l,treeA)),b=normalize(play(fresh(),l,treeB));
  assert.deepEqual(merge(side(b),side(a)).cloud.save.records[l.id].best.selected,[0,1,3,5]);
  assert.deepEqual(merge(side(a),side(b)).cloud.save.records[l.id].best.selected,[0,1,4,5]);
});

test('匹配题指标越大越好：安排 3 个岗位胜过 2 个',()=>{
  const l=levelById['04-03.1'],full=solution(l),partial={...full,selected:full.selected.slice(0,2)};
  assert.ok(evaluate(l,full).perfect);assert.ok(evaluate(l,partial).pass&&!evaluate(l,partial).perfect,'测试数据：2 岗通过但不完美');
  for(const [x,y] of [[full,partial],[partial,full]]){
    const r=merge(side(normalize(play(fresh(),l,x))),side(normalize(play(fresh(),l,y))));
    assert.equal(r.local.save.records[l.id].bestMetric,full.selected.length);assert.equal(r.local.save.records[l.id].perfect,true);
  }
});

test('编辑现场取修改时间较新的；时间相同保留云端；没有逐关时间就用整份存档的时间',()=>{
  const l=levelById['04-01.2'],path=statePath(l.id);
  const mine=editing(l,s=>{s.colors[0]=3;}),theirs=editing(l,s=>{s.colors[0]=4;});
  const pick=(lf,ls,cf,cs)=>merge(side(mine,lf,ls),side(theirs,cf,cs)).local.save.records[l.id].state.colors[0];
  assert.equal(pick({[path]:200},0,{[path]:100},0),3,'本机较新');
  assert.equal(pick({[path]:100},0,{[path]:200},0),4,'云端较新');
  assert.equal(pick({[path]:100},0,{[path]:100},0),4,'时间相同保留云端');
  assert.equal(pick({},300,{[path]:200},0),3,'本机没有逐关时间，用整份存档的时间 300');
  assert.equal(pick({},0,{},0),4,'都没有时间，保留云端');
  const r=merge(side(mine,{[path]:200}),side(theirs,{[path]:100}));
  assert.equal(r.cloud.clock.fields[path],200,'选中那份的时间写进合并后的时间数据');
});

test('上次所在关和章节跟着较新的设备走',()=>{
  const mine=normalize({...fresh(),last:'02-01.1',chapter:2}),theirs=normalize({...fresh(),last:'03-01.1',chapter:3});
  let r=merge(side(mine,{last:200,chapter:200},200),side(theirs,{last:100,chapter:100},100));
  assert.equal(r.local.save.last,'02-01.1');assert.equal(r.local.save.chapter,2);assert.equal(r.cloud.clock.fields.last,200);
  r=merge(side(mine,{},50),side(theirs,{last:100},100));
  assert.equal(r.local.save.last,'03-01.1');assert.equal(r.local.save.chapter,3);
  r=merge(side(mine,{last:100,chapter:100},100),side(theirs,{last:100,chapter:100},100));
  assert.equal(r.local.save.last,'03-01.1','时间相同保留云端');assert.equal(r.local.save.chapter,3);
});

test('整份照抄一边的记录时，带上那一边的编辑现场时间，后续合并仍按真实时间比较',()=>{
  const l=levelById['04-01.2'],path=statePath(l.id),mine=editing(l,s=>{s.colors[0]=3;});
  assert.equal(merge(side(mine,{[path]:500},900),null).cloud.clock.fields[path],500);
  // 本机没有逐关时间：写明本机整份存档的时间 300，而不是合并后整份时间的较大值 800
  const r=merge(side(mine,{},300),side(normalize(fresh()),{},800));
  assert.equal(r.cloud.clock.fields[path],300);
  // 第三台设备在 600 时刻改过这一关：比照抄过去的 300 时刻新，应该胜出
  const r2=merge(side(editing(l,s=>{s.colors[0]=4;}),{[path]:600},600),r.cloud);
  assert.equal(r2.local.save.records[l.id].state.colors[0],4);
});

test('设置不同步：本机保留自己的，推回云端的沿用云端原有的',()=>{
  const mine=normalize({...fresh(),settings:{sound:false,volume:0.8,motion:true,speed:2}});
  const theirs=normalize({...fresh(),settings:{sound:true,volume:0.1,motion:false,speed:1}});
  const r=merge(side(mine,{},999),side(theirs));
  assert.deepEqual(r.local.save.settings,mine.settings);assert.deepEqual(r.cloud.save.settings,theirs.settings);
});

test('本机不认识的关卡和字段：推回云端时原样保留，本机看不到；两边都有的未知字段取较新的',()=>{
  const l=levelById['01-01.1'],mine=normalize(play(fresh(),l)),theirs=structuredClone(mine);
  theirs.records['06-01.1']={revision:1,best:{selected:[9]},passed:true,futureField:'新版本的字段'};
  theirs.records[l.id].futureField={a:1};theirs.futureTop=[1,2,3];theirs.summaries=[1,6];
  const r=merge(side(mine,{},999),side(theirs,{},1));
  assert.deepEqual(r.cloud.save.records['06-01.1'],theirs.records['06-01.1']);
  assert.deepEqual(r.cloud.save.records[l.id].futureField,{a:1});
  assert.deepEqual(r.cloud.save.futureTop,[1,2,3]);assert.deepEqual(r.cloud.save.summaries,[1,6]);
  assert.equal(r.local.save.records['06-01.1'],undefined);assert.equal(r.local.save.futureTop,undefined);
  assert.deepEqual(r.local.save.summaries,[1]);
  const mine2={...structuredClone(mine),futureTop:'本机的'};
  assert.equal(merge(side(mine2,{},999),side(theirs,{},1)).cloud.save.futureTop,'本机的');
  assert.deepEqual(merge(side(mine2,{},1),side(theirs,{},999)).cloud.save.futureTop,[1,2,3]);
});

test('修订号不同：旧修订号的成绩按旧题验证后作为旧版成绩，方案和编辑现场以当前修订号为准',()=>{
  const l=levelById['04-02.3'],old=legacyLevelById[l.id];
  assert.equal(l.revision,2);
  const oldDevice=play(fresh(),old);// 旧版本设备：按原题通关，记录的修订号是 1
  assert.equal(oldDevice.records[l.id].revision,1);
  const r=merge(side(normalize(play(fresh(),l))),side(oldDevice));
  const rec=r.local.save.records[l.id];
  assert.ok(rec.passed&&rec.perfect&&!rec.legacy);
  assert.equal(evaluate(l,rec.best).perfect,true);
  assert.ok(rec.legacyBest,'原题成绩作为旧版成绩保留');assert.ok(evaluate(old,rec.legacyBest).pass);
  // 本机只有新题的编辑现场：合并后显示“旧版已通关”，编辑现场用本机的，即使云端那份时间更新
  const draft=editing(l,s=>{s.colors[0]=2;});
  const r2=merge(side(draft,{[statePath(l.id)]:10}),side(oldDevice,{[statePath(l.id)]:999}));
  const rec2=r2.local.save.records[l.id];
  assert.ok(rec2.passed&&rec2.legacy);assert.equal(rec2.best,null);assert.equal(rec2.state.colors[0],2);
});

test('22 个改版关：旧版本设备的原题成绩合并进新版本存档后都保留“通过”',()=>{
  const oldDevice=fresh();
  for(const l of Object.values(legacyLevelById))play(oldDevice,l);
  const r=merge(side(normalize(fresh())),side(oldDevice));
  const revised=levels.filter(l=>l.revision===2);
  assert.equal(revised.length,22);
  for(const l of revised){const rec=r.local.save.records[l.id];assert.ok(rec.passed&&rec.legacy,l.id);assert.equal(rec.best,null);}
});

test('云端记录的修订号比本机新：原样留在云端，本机继续用自己的成绩',()=>{
  const l=levelById['04-02.3'],mine=normalize(play(fresh(),l)),theirs=structuredClone(mine);
  theirs.records[l.id]={revision:3,best:{colors:[9,9]},passed:true,perfect:true,newRule:true};
  const r=merge(side(mine),side(theirs,{},999));
  assert.deepEqual(r.cloud.save.records[l.id],theirs.records[l.id]);
  assert.deepEqual(r.local.save.records[l.id],mine.records[l.id]);
  const r2=merge(side(normalize(fresh())),side(theirs));
  assert.equal(r2.local.save.records[l.id],undefined);assert.deepEqual(r2.cloud.save.records[l.id],theirs.records[l.id]);
});

test('云端存档格式比本机新时暂停同步，认不出的格式不合并，本机格式不对直接报错',()=>{
  const mine=normalize(fresh());
  assert.deepEqual(merge(side(mine),side({version:2,records:{}})),{status:'newer-version',version:2});
  assert.equal(merge(side(mine),side({version:'1',records:{}})).status,'incompatible');
  assert.equal(merge(side(mine),side({version:1,records:[]})).status,'incompatible');
  assert.equal(merge(side(mine),side([])).status,'incompatible');
  assert.throws(()=>merge(side({version:2,records:{}}),null),/本机存档/);
});

test('合并不修改传入的存档和时间数据',()=>{
  const random=rng(1),a=randomDevice(random,1000),b=randomDevice(random,2000),before=stableJSON([a,b]);
  merge(a,b);assert.equal(stableJSON([a,b]),before);
});

test('两台设备轮流同步：结果收敛，不丢成绩，之后再同步不再产生变化',()=>{
  const random=rng(20261017);
  for(let round=0;round<8;round++){
    const devices=[randomDevice(random,1000),randomDevice(random,3000)];
    const passed=new Set(devices.flatMap(d=>passedIds(d.save))),perfect=new Set(devices.flatMap(d=>perfectIds(d.save)));
    let cloud=null;
    for(let pass=0;pass<3;pass++)for(const d of devices){
      const r=merge(d,cloud);assert.equal(r.status,'ok');
      d.save=r.local.save;d.clock=r.local.clock;
      if(r.cloudChanged)cloud=JSON.parse(JSON.stringify(r.cloud));// 模拟经过网络传输
    }
    const withoutSettings=s=>({...s,settings:null});
    assert.deepEqual(withoutSettings(devices[0].save),withoutSettings(devices[1].save),`第 ${round} 轮两台设备不一致`);
    for(const id of passed)assert.ok(devices[0].save.records[id].passed,`${id} 丢了通过`);
    for(const id of perfect)assert.ok(devices[0].save.records[id].perfect,`${id} 丢了徽记`);
    for(const d of devices){const r=merge(d,cloud);assert.equal(r.cloudChanged,false);assert.equal(r.localChanged,false);}
  }
});

test('云端存档被随机破坏：合并不抛错，本机已有的成绩一个不丢',()=>{
  const random=rng(7),junk=[null,0,-1,1e9,'x','',true,[],{},[1,'a'],{colors:'x'},{selected:[1,1,99]}];
  const mine=randomDevice(random,1000),base=randomDevice(random,2000);
  const kept=passedIds(mine.save);
  // 收集一份存档里所有可替换的位置（最深到方案内部的字段）
  const paths=(value,prefix=[],depth=0)=>value&&typeof value==='object'&&depth<4?Object.keys(value).flatMap(k=>[[...prefix,k],...paths(value[k],[...prefix,k],depth+1)]):[];
  let merged=0;
  for(let i=0;i<150;i++){
    const save=structuredClone(base.save),all=paths(save);
    for(let k=1+Math.floor(random()*5);k>0;k--){
      const path=all[Math.floor(random()*all.length)],parent=path.slice(0,-1).reduce((o,key)=>o?.[key],save);
      if(!parent||typeof parent!=='object')continue;
      if(random()<0.2)delete parent[path.at(-1)];else parent[path.at(-1)]=structuredClone(junk[Math.floor(random()*junk.length)]);
    }
    const clock=random()<0.2?junk[Math.floor(random()*junk.length)]:base.clock;
    const r=merge(mine,{save,clock});
    if(r.status!=='ok')continue;
    merged++;
    for(const id of kept)assert.ok(r.local.save.records[id].passed,`第 ${i} 份：${id} 丢了通过`);
  }
  assert.ok(merged>100,`大部分破坏过的存档仍应能合并（实际 ${merged} 份）`);
});

test('自检：合并结果比原来少了通过或徽记时报错',()=>{
  const l=levelById['01-01.1'],passed=normalize(play(fresh(),l)),empty=normalize(fresh());
  assert.throws(()=>checkNoRegression(empty,{local:passed,cloud:empty}),/01-01\.1/);
  assert.throws(()=>checkNoRegression(empty,{local:empty,cloud:passed}),/云端/);
  assert.doesNotThrow(()=>checkNoRegression(passed,{local:passed,cloud:empty}));
  assert.doesNotThrow(()=>checkNoRegression(empty,{local:empty,cloud:passed},new Set([l.id])));
});
