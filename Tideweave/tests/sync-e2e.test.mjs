// 云同步端到端测试：两台模拟设备通过真实 HTTP 连真实服务端，走完整的拉取 → 合并 → 推送
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {levelById} from '../src/levels.mjs';
import {solution,evaluate} from '../src/engine.mjs';
import {fresh,normalize,recordAttempt} from '../src/progress.mjs';
import {createClient,SyncError} from '../src/sync/client.mjs';
import {syncOnce} from '../src/sync/sync.mjs';
import {generateCode} from '../src/sync/code.mjs';
import {stableJSON} from '../src/sync/util.mjs';
import {createSyncServer} from '../server/index.mjs';

// 一台设备的本机数据：在 fresh 存档上通关若干关
function device(...ids){
  const save=fresh();
  for(const id of ids){const l=levelById[id],s=solution(l);recordAttempt(save,l,s,evaluate(l,s));}
  return {save:normalize(save),clock:{fields:{},savedAt:Date.now()}};
}
// 同步成功后，设备采用合并结果（相当于前端应用云端进度）
function adopt(dev,result){assert.equal(result.status,'ok',JSON.stringify(result));dev.save=result.local.save;dev.clock=result.local.clock;return result;}
const passed=(save,id)=>!!save.records[id]?.passed;

async function start(options={}){
  const dir=options.dataDir??fs.mkdtempSync(path.join(os.tmpdir(),'tw-e2e-'));
  const app=createSyncServer({log:()=>{},...options,dataDir:dir});
  const {port}=await app.listen(options.port??0,'127.0.0.1');
  return {app,dir,port,baseUrl:`http://127.0.0.1:${port}`,stop:async(keep=false)=>{await app.close();if(!keep)fs.rmSync(dir,{recursive:true,force:true});}};
}

test('设备 A 开启同步、设备 B 输入同步码：进度双向合并，最后两边一致',async()=>{
  const s=await start(),code=generateCode();
  try{
    const a=device('01-01.1','01-01.2'),b=device('02-01.1');
    const clientA=createClient({code,baseUrl:s.baseUrl}),clientB=createClient({code,baseUrl:s.baseUrl});
    let r=adopt(a,await syncOnce(clientA,a,{create:true,device:'A'}));assert.equal(r.pushed,true);assert.equal(r.rev,1);
    r=adopt(b,await syncOnce(clientB,b,{device:'B'}));assert.equal(r.rev,2);
    assert.ok(passed(b.save,'01-01.1')&&passed(b.save,'01-01.2')&&passed(b.save,'02-01.1'),'B 拿到了 A 的进度');
    r=adopt(a,await syncOnce(clientA,a,{device:'A'}));assert.equal(r.localChanged,true);assert.ok(passed(a.save,'02-01.1'),'A 拿到了 B 的进度');
    const without=s=>stableJSON({...s,settings:null});
    assert.equal(without(a.save),without(b.save));
    for(const [dev,client] of [[a,clientA],[b,clientB]]){r=await syncOnce(client,dev);assert.equal(r.pushed,false);assert.equal(r.localChanged,false);}
  }finally{await s.stop();}
});

test('输入一个云端不存在的同步码：返回 not-found，不会悄悄新建',async()=>{
  const s=await start(),client=createClient({code:generateCode(),baseUrl:s.baseUrl});
  try{
    assert.deepEqual(await syncOnce(client,device('01-01.1')),{status:'not-found'});
    assert.deepEqual(await client.pull(),{status:'not-found'});
  }finally{await s.stop();}
});

test('两台设备同时同步：后推送的收到 412，重新拉取合并后再推，两边的新进度都不丢',async()=>{
  const s=await start(),code=generateCode();
  try{
    const a=device('01-01.1'),b=device();
    adopt(a,await syncOnce(createClient({code,baseUrl:s.baseUrl}),a,{create:true}));
    adopt(b,await syncOnce(createClient({code,baseUrl:s.baseUrl}),b));
    // 两台设备离线各自通关一关
    for(const [dev,id] of [[a,'03-01.1'],[b,'04-01.1']]){const l=levelById[id],st=solution(l);recordAttempt(dev.save,l,st,evaluate(l,st));}
    // A 拉取完、正要推送时被拦住；等 B 完整同步一次后再放行，制造“同时同步”
    let reached,release,conflicts=0;const atPush=new Promise(r=>reached=r),gate=new Promise(r=>release=r);let armed=true;
    const gatedFetch=async(url,init)=>{if(armed&&init?.method==='PUT'){armed=false;reached();await gate;}const res=await fetch(url,init);if(res.status===412)conflicts++;return res;};
    const pendingA=syncOnce(createClient({code,baseUrl:s.baseUrl,fetch:gatedFetch}),a);
    await atPush;
    adopt(b,await syncOnce(createClient({code,baseUrl:s.baseUrl}),b));
    release();
    const r=adopt(a,await pendingA);
    assert.equal(conflicts,1,'A 的第一次推送因为 B 抢先而冲突');assert.equal(r.pushed,true);
    const cloud=await createClient({code,baseUrl:s.baseUrl}).pull();
    const merged=normalize(cloud.envelope.save);
    for(const id of ['01-01.1','03-01.1','04-01.1'])assert.ok(passed(merged,id),`云端缺少 ${id}`);
    assert.equal(cloud.rev,r.rev);
  }finally{await s.stop();}
});

test('服务端挂了：同步报“连不上”，本机存档不受影响；服务恢复后接着同步',async()=>{
  let s=await start();const code=generateCode(),port=s.port,dir=s.dir;
  const dev=device('01-01.1'),client=createClient({code,baseUrl:s.baseUrl,timeoutMs:2000});
  adopt(dev,await syncOnce(client,dev,{create:true}));
  await s.stop(true);
  const before=stableJSON(dev);
  await assert.rejects(syncOnce(client,dev),e=>e instanceof SyncError&&e.kind==='offline');
  assert.equal(stableJSON(dev),before,'同步失败不改本机数据');
  s=await start({dataDir:dir,port});
  try{
    const l=levelById['01-02.1'],st=solution(l);recordAttempt(dev.save,l,st,evaluate(l,st));
    const r=adopt(dev,await syncOnce(client,dev));assert.equal(r.rev,2,'沿用重启前的数据继续编号');
  }finally{await s.stop();}
});

test('云端存档格式比本机新：暂停同步，不推送任何东西',async()=>{
  const s=await start({supportedVersions:[1,2]}),code=generateCode();
  try{
    await s.app.store.put(code,JSON.stringify({format:1,save:{version:2,records:{}},clock:{}}),{expect:null});
    const client=createClient({code,baseUrl:s.baseUrl});
    assert.deepEqual(await syncOnce(client,device('01-01.1')),{status:'newer-version',version:2});
    assert.equal((await client.pull()).rev,1,'云端没有被改动');
  }finally{await s.stop();}
});

test('云端信封格式认不出（比如以后的新格式）：暂停同步，不覆盖它',async()=>{
  const s=await start(),code=generateCode(),client=createClient({code,baseUrl:s.baseUrl});
  try{
    // 服务端只接受当前格式的推送，所以直接写进存储，模拟将来新版本服务端存下的信封
    await s.app.store.put(code,JSON.stringify({format:2,save:{version:1,records:{}}}),{expect:null});
    assert.deepEqual(await syncOnce(client,device('01-01.1')),{status:'incompatible'});
    assert.equal((await client.pull()).rev,1,'云端没有被改动');
  }finally{await s.stop();}
});

test('客户端把超时、限流和被拒分别报成 offline、rate-limited、rejected',async()=>{
  const hang=http.createServer(()=>{});await new Promise(r=>hang.listen(0,'127.0.0.1',r));
  try{
    const client=createClient({code:generateCode(),baseUrl:`http://127.0.0.1:${hang.address().port}`,timeoutMs:100});
    await assert.rejects(client.pull(),e=>e instanceof SyncError&&e.kind==='offline'&&/超时/.test(e.message));
  }finally{hang.closeAllConnections();hang.close();}
  const s=await start({limits:{ip:{capacity:1,refillPerSecond:0.01}}});
  try{
    const client=createClient({code:generateCode(),baseUrl:s.baseUrl});
    await client.pull();
    await assert.rejects(client.pull(),e=>e instanceof SyncError&&e.kind==='rate-limited'&&e.retryAfter>=1);
  }finally{await s.stop();}
  const s2=await start();
  try{await assert.rejects(createClient({code:'bad',baseUrl:s2.baseUrl}).pull(),e=>e instanceof SyncError&&e.kind==='rejected'&&e.status===400);}
  finally{await s2.stop();}
});
