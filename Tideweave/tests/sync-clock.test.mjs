// 云同步修改时间测试：只给变了的现场型字段记时间，坏数据能清洗
import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,normalize} from '../src/progress.mjs';
import {touch,timeOf,cleanClock,emptyClock,statePath} from '../src/sync/clock.mjs';

test('存档变化时只给变了的现场型字段记时间',()=>{
  const before=normalize(fresh()),after=structuredClone(before);
  after.records['04-01.2']={state:{colors:[1]}};after.last='02-01.1';
  const c1=touch(emptyClock(),before,after,100);
  assert.deepEqual(c1,{fields:{[statePath('04-01.2')]:100,last:100},savedAt:100});
  // 只有成绩类字段变了：不改字段时间，只更新整份存档时间
  const after2=structuredClone(after);after2.records['04-01.2'].attempts=3;
  const c2=touch(c1,after,after2,200);
  assert.deepEqual(c2.fields,c1.fields);assert.equal(c2.savedAt,200);
  // 什么都没变：时间不动
  assert.deepEqual(touch(c2,after2,structuredClone(after2),300),c2);
  // 只改设置：设置不同步，不算存档变化
  const after3=structuredClone(after2);after3.settings.volume=0.9;
  assert.deepEqual(touch(c2,after2,after3,400),c2);
  // 不修改传入的时间数据
  assert.equal(c1.savedAt,100);
});

test('没有单独记录的字段用整份存档的时间兜底，坏数据被清洗',()=>{
  assert.equal(timeOf({fields:{a:5},savedAt:9},'a'),5);
  assert.equal(timeOf({fields:{},savedAt:9},'a'),9);
  assert.equal(timeOf(undefined,'a'),0);assert.equal(timeOf({fields:{a:'x'},savedAt:'y'},'a'),0);
  assert.deepEqual(cleanClock({fields:{a:'x',b:2,c:NaN,d:null},savedAt:'y'}),{fields:{b:2},savedAt:0});
  for(const junk of [null,1,'x',[],{fields:[1,2]}])assert.deepEqual(cleanClock(junk),emptyClock());
});
