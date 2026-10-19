// 云同步调度测试：模拟设备（内存里的本机存储 + 同步层）连真实服务端，时间参数缩短到几十毫秒
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {levelById} from '../src/levels.mjs';
import {solution,evaluate} from '../src/engine.mjs';
import {normalize,recordAttempt} from '../src/progress.mjs';
import {createSyncController,PROGRESS_KEY,META_KEY,BACKUP_KEY} from '../src/sync/controller.mjs';
import {createClient} from '../src/sync/client.mjs';
import {createSyncServer} from '../server/index.mjs';

// 防抖 20 毫秒、重试 30～120 毫秒；不监听页面事件（需要时单独传）
const FAST={debounceMs:20,pollMs:60000,applyCheckMs:15,retryMinMs:30,retryMaxMs:120,events:null,page:null};
const active=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function memoryStorage(){const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>void m.set(k,String(v)),removeItem:k=>void m.delete(k)};}
async function start(options={}){
  const dir=options.dataDir??fs.mkdtempSync(path.join(os.tmpdir(),'tw-ctl-'));
  const app=createSyncServer({log:()=>{},...options,dataDir:dir});
  const {port}=await app.listen(options.port??0,'127.0.0.1');
  return {app,dir,port,baseUrl:`http://127.0.0.1:${port}`,stop:async(keep=false)=>{await app.close();if(!keep)fs.rmSync(dir,{recursive:true,force:true});}};
}
// 会记账的 fetch：数一数发了几次拉取（GET）、推送（PUT）
function countingFetch(inner=fetch){const calls=[];const f=(url,init={})=>{calls.push(init.method??'GET');return inner(url,init);};f.calls=calls;f.count=m=>calls.filter(x=>x===m).length;return f;}
// 一台模拟设备：游戏存档 + 同步层；inLevel 表示玩家正在关卡里（这时不能应用新进度）
function device(baseUrl,{storage=memoryStorage(),fetch:inner,...extra}={}){
  const f=countingFetch(inner);
  const d={storage,fetch:f,inLevel:false,applied:0};
  d.sync=createSyncController({storage,server:baseUrl,fetch:f,...FAST,...extra});
  d.progress=normalize(d.sync.load().data);
  d.play=id=>{const l=levelById[id],s=solution(l);recordAttempt(d.progress,l,s,evaluate(l,s));d.sync.save(d.progress);};
  d.start=()=>d.sync.start({progress:d.progress,canApply:()=>!d.inLevel,apply:p=>{d.progress=p;d.applied++;d.sync.save(d.progress);}});
  active.push(d);
  return d;
}
const passed=(d,id)=>!!d.progress.records[id]?.passed;
async function waitFor(check,label,ms=4000){const t0=Date.now();while(!(await check())){if(Date.now()-t0>ms)throw new Error('等待超时：'+label);await sleep(10);}}
async function cloud(baseUrl,code){const r=await createClient({code:code.replace(/-/g,''),baseUrl}).pull();return r.status==='ok'?normalize(r.envelope.save):null;}
async function cleanup(...servers){for(const d of active.splice(0))await d.sync.stop();for(const s of servers)await s.stop();}

test('没开启同步：存档只写本机，不联网',async()=>{
  const s=await start();
  try{
    const d=device(s.baseUrl);d.start();d.play('01-01.1');await sleep(80);
    assert.equal(d.fetch.calls.length,0);assert.equal(d.sync.status().state,'off');
    assert.ok(JSON.parse(d.storage.getItem(PROGRESS_KEY)).records['01-01.1'].passed,'和原来一样写进本机存储');
  }finally{await cleanup(s);}
});

test('开启同步：本地生成同步码、云端新建；刷新页面后同步码和设备标识还在',async()=>{
  const s=await start();
  try{
    const d=device(s.baseUrl);d.play('01-01.1');d.start();
    const st=await d.sync.enable();
    assert.equal(st.state,'ok');assert.match(st.code,/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/);
    assert.ok((await cloud(s.baseUrl,st.code)).records['01-01.1'].passed);
    const meta=JSON.parse(d.storage.getItem(META_KEY));
    assert.equal(meta.code,st.code.replace(/-/g,''));assert.equal(meta.created,true);assert.match(meta.device,/^d-[0-9a-z]{8}$/);
    const reloaded=createSyncController({storage:d.storage,server:s.baseUrl,...FAST});
    assert.equal(reloaded.status().code,st.code);assert.equal(JSON.parse(d.storage.getItem(META_KEY)).device,meta.device);
  }finally{await cleanup(s);}
});

test('第二台设备输入同步码：两边进度合并并应用到游戏，应用前先备份',async()=>{
  const s=await start();
  try{
    const a=device(s.baseUrl),b=device(s.baseUrl);
    a.play('01-01.1');a.start();const {code}=await a.sync.enable();
    b.play('01-01.2');b.start();
    const r=await b.sync.join(code.toLowerCase());
    assert.equal(r.ok,true,JSON.stringify(r));
    assert.ok(passed(b,'01-01.1')&&passed(b,'01-01.2'),'B 拿到了 A 的进度');assert.equal(b.applied,1);
    assert.ok(JSON.parse(b.storage.getItem(BACKUP_KEY)).save.records['01-01.2'].passed,'应用前备份了 B 原来的存档');
    assert.ok(JSON.parse(b.storage.getItem(PROGRESS_KEY)).records['01-01.1'].passed,'本机存储里也是新进度');
    await a.sync.syncNow();
    assert.ok(passed(a,'01-01.2'),'A 也拿到了 B 的进度');
  }finally{await cleanup(s);}
});

test('连续存档只推送一次（防抖）',async()=>{
  const s=await start();
  try{
    const a=device(s.baseUrl);a.start();await a.sync.enable();
    const puts=a.fetch.count('PUT');
    for(const id of ['01-01.1','01-01.2','01-02.1'])a.play(id);
    await waitFor(()=>a.fetch.count('PUT')>puts&&a.sync.status().state==='ok'&&!a.sync.status().dirty,'推送完成');
    await sleep(100);
    assert.equal(a.fetch.count('PUT')-puts,1);
  }finally{await cleanup(s);}
});

test('玩家在关卡里时不应用新进度，退出关卡后自动应用',async()=>{
  const s=await start();
  try{
    const a=device(s.baseUrl),b=device(s.baseUrl);
    a.start();const {code}=await a.sync.enable();b.start();await b.sync.join(code);
    b.inLevel=true;
    a.play('03-01.1');await a.sync.syncNow();
    await b.sync.syncNow();
    assert.equal(passed(b,'03-01.1'),false,'在关卡里：先不应用');assert.equal(b.sync.status().pendingApply,true);
    b.inLevel=false;
    await waitFor(()=>passed(b,'03-01.1'),'退出关卡后应用');
    assert.equal(b.sync.status().pendingApply,false);
  }finally{await cleanup(s);}
});

test('同步途中玩家又存了档：这一轮结果不应用，再同步一轮，新改动不丢',async()=>{
  const s=await start();
  try{
    const a=device(s.baseUrl);a.play('01-01.1');a.start();const {code}=await a.sync.enable();
    // B 的拉取在拿到响应后先停住，等玩家在这期间存一次档
    let armed=false,reached,release;const atGate=new Promise(r=>reached=r),gate=new Promise(r=>release=r);
    const gated=async(url,init={})=>{const res=await fetch(url,init);if(armed&&(init.method??'GET')==='GET'){armed=false;reached();await gate;}return res;};
    const b=device(s.baseUrl,{fetch:gated});b.start();await b.sync.join(code);
    a.play('02-01.1');await a.sync.syncNow();
    armed=true;const pending=b.sync.syncNow();
    await atGate;
    b.play('03-01.1');
    release();await pending;
    await waitFor(()=>passed(b,'02-01.1')&&passed(b,'03-01.1')&&b.sync.status().state==='ok'&&!b.sync.status().dirty,'再同步一轮后两边的进度都在');
    assert.ok((await cloud(s.baseUrl,code)).records['03-01.1'].passed,'新改动也推到了云端');
  }finally{await cleanup(s);}
});

test('断网时自动重试，服务恢复后补上没推送的改动',async()=>{
  let s=await start();const {port,dir}=s;
  try{
    const a=device(s.baseUrl);a.start();const {code}=await a.sync.enable();
    await s.stop(true);
    a.play('01-01.1');
    await waitFor(()=>a.sync.status().state==='offline','进入离线状态');
    assert.equal(a.sync.status().dirty,true);
    s=await start({dataDir:dir,port});
    await waitFor(()=>a.sync.status().state==='ok'&&!a.sync.status().dirty,'恢复后自动补上',6000);
    assert.ok((await cloud(s.baseUrl,code)).records['01-01.1'].passed);
  }finally{await cleanup(s);}
});

test('输错同步码：格式不对或云端没有，都不保存',async()=>{
  const s=await start();
  try{
    const d=device(s.baseUrl);d.start();
    assert.equal((await d.sync.join('abc')).reason,'invalid');
    assert.equal((await d.sync.join('ZZZZ-ZZZZ-ZZZZ')).reason,'not-found');
    assert.equal(d.sync.status().state,'off');assert.equal(JSON.parse(d.storage.getItem(META_KEY)).code,null);
  }finally{await cleanup(s);}
});

test('云端存档格式比本机新：暂停同步，之后存档也不推送',async()=>{
  const s=await start({supportedVersions:[1,2]});
  try{
    await s.app.store.put('ABCD2345EFGH',JSON.stringify({format:1,save:{version:2,records:{}},clock:{}}),{expect:null});
    const d=device(s.baseUrl);d.start();
    await d.sync.join('ABCD-2345-EFGH');
    assert.equal(d.sync.status().state,'paused');assert.equal(d.fetch.count('PUT'),0);
    const calls=d.fetch.calls.length;
    d.play('01-01.1');await d.sync.syncNow();await sleep(80);
    assert.equal(d.fetch.calls.length,calls,'暂停后存档、手动同步都不再联网（既不推送，也不反复拉取）');
  }finally{await cleanup(s);}
});

test('应用云端进度不算本机改动：不会紧接着又推送一次',async()=>{
  const s=await start();
  try{
    const a=device(s.baseUrl),b=device(s.baseUrl);
    a.start();const {code}=await a.sync.enable();b.start();await b.sync.join(code);
    a.play('01-01.1');await a.sync.syncNow();
    await b.sync.syncNow();assert.ok(passed(b,'01-01.1'));
    const puts=b.fetch.count('PUT');await sleep(120);
    assert.equal(b.fetch.count('PUT'),puts,'应用后没有多余的推送');assert.equal(b.sync.status().dirty,false);
  }finally{await cleanup(s);}
});

test('关闭同步：忘掉同步码，之后的存档只留在本机',async()=>{
  const s=await start();
  try{
    const d=device(s.baseUrl);d.start();await d.sync.enable();
    d.sync.disable();const calls=d.fetch.calls.length;
    d.play('01-01.1');await sleep(80);
    assert.equal(d.fetch.calls.length,calls);assert.equal(d.sync.status().state,'off');
    assert.equal(JSON.parse(d.storage.getItem(META_KEY)).code,null);
  }finally{await cleanup(s);}
});

test('服务器上的数据丢了：自动按新建重新上传本机进度',async()=>{
  const s=await start();
  try{
    const a=device(s.baseUrl);a.play('01-01.1');a.start();const {code}=await a.sync.enable();
    fs.rmSync(path.join(s.dir,'saves'),{recursive:true,force:true});
    a.play('01-01.2');
    await waitFor(async()=>{const c=await cloud(s.baseUrl,code);return !!(c?.records['01-01.1']?.passed&&c.records['01-01.2']?.passed);},'重新上传');
  }finally{await cleanup(s);}
});

test('切回页面时拉取一次；切走前把没推送的改动推上去',async()=>{
  const s=await start();
  try{
    const page=new EventTarget();page.visibilityState='visible';
    const d=device(s.baseUrl,{page,debounceMs:10000});// 防抖设得很长，确保推送是切页面触发的
    d.start();await d.sync.enable();
    const gets=d.fetch.count('GET');
    page.dispatchEvent(new Event('visibilitychange'));
    await waitFor(()=>d.fetch.count('GET')>gets&&d.sync.status().state==='ok','切回页面时拉取');
    d.play('01-01.1');const puts=d.fetch.count('PUT');
    page.visibilityState='hidden';page.dispatchEvent(new Event('visibilitychange'));
    await waitFor(()=>d.fetch.count('PUT')>puts,'切走前推送');
  }finally{await cleanup(s);}
});
