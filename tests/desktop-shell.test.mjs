// Windows 版外壳（desktop/）：自定义协议 tideweave://app/ 的读文件、Range、防穿越，以及 /api/ 转发给同步服务
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createSyncServer} from '../server/index.mjs';

const require=createRequire(import.meta.url);
const {createHandler,ENTRY}=require('../desktop/protocol.cjs');

// 临时 dist：首页、脚本、10 字节的音频，外加一个不该被读到的文件
function site(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tw-win-')),dist=path.join(root,'dist');
  fs.mkdirSync(path.join(dist,'assets','audio'),{recursive:true});
  fs.writeFileSync(path.join(dist,'index.html'),'<!doctype html><title>脉序</title>');
  fs.writeFileSync(path.join(dist,'app.js'),'console.log(1)');
  fs.writeFileSync(path.join(dist,'assets','audio','sfx_click.wav'),'0123456789');
  fs.writeFileSync(path.join(root,'secret.txt'),'不该被读到');
  return {root,dist,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const get=(handler,url,headers={},init={})=>handler(new Request(url,{headers,...init}));

test('Windows 版：从 dist 读文件，类型正确，挡住目录穿越和别的主机',async()=>{
  const s=site(),handler=createHandler({root:s.dist,syncServer:''});
  try{
    assert.equal(ENTRY,'tideweave://app/index.html');
    const home=await get(handler,'tideweave://app/');
    assert.equal(home.status,200);assert.match(home.headers.get('content-type'),/text\/html/);assert.match(await home.text(),/脉序/);
    assert.match((await get(handler,'tideweave://app/app.js')).headers.get('content-type'),/javascript/);
    assert.equal((await get(handler,'tideweave://app/assets/audio/sfx_click.wav')).headers.get('content-type'),'audio/wav');
    assert.equal((await get(handler,'tideweave://app/nope.js')).status,404);
    for(const p of ['/../secret.txt','/..%2fsecret.txt','/%2e%2e/secret.txt','/..%5csecret.txt','/'+encodeURIComponent('\0')]){
      const r=await get(handler,'tideweave://app'+p);assert.notEqual(r.status,200,p);
    }
    assert.equal((await get(handler,'tideweave://other/index.html')).status,400);
    assert.equal((await handler(new Request('tideweave://app/index.html',{method:'POST',body:'x'}))).status,405);
  }finally{s.cleanup();}
});

test('Windows 版：音频支持按字节范围读取',async()=>{
  const s=site(),handler=createHandler({root:s.dist,syncServer:''}),url='tideweave://app/assets/audio/sfx_click.wav';
  try{
    const probe=await get(handler,url,{Range:'bytes=0-1'});
    assert.equal(probe.status,206);assert.equal(await probe.text(),'01');assert.equal(probe.headers.get('content-range'),'bytes 0-1/10');
    assert.equal(await (await get(handler,url,{Range:'bytes=7-'})).text(),'789');
    assert.equal(await (await get(handler,url,{Range:'bytes=-3'})).text(),'789');
    const out=await get(handler,url,{Range:'bytes=10-'});assert.equal(out.status,416);assert.equal(out.headers.get('content-range'),'bytes */10');
    const multi=await get(handler,url,{Range:'bytes=0-1,3-4'});assert.equal(multi.status,200);assert.equal(await multi.text(),'0123456789');
  }finally{s.cleanup();}
});

test('Windows 版：/api/ 转发给真实同步服务，只带同步协议用到的头，状态码原样返回',async()=>{
  const s=site(),dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'tw-win-sync-'));
  const server=createSyncServer({log:()=>{},dataDir});const {port}=await server.listen(0,'127.0.0.1');
  const handler=createHandler({root:s.dist,syncServer:`http://127.0.0.1:${port}/`});
  try{
    const health=await get(handler,'tideweave://app/api/v1/health');
    assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true});
    // 用真实接口建一个同步码，再按 ETag 做条件请求
    const code='ABCD1234EFGH',envelope={format:1,save:{version:1,records:{}},clock:{fields:{},savedAt:1},device:'win-test'};
    const created=await handler(new Request('tideweave://app/api/v1/save',{method:'PUT',headers:{'Content-Type':'application/json','X-Sync-Code':code,'If-None-Match':'*','Cookie':'session=should-not-forward'},body:JSON.stringify(envelope)}));
    assert.ok(created.status===200||created.status===201,String(created.status));
    const etag=created.headers.get('etag');assert.ok(etag,'要把 ETag 转回给网页');
    const read=await get(handler,'tideweave://app/api/v1/save',{'X-Sync-Code':code});
    assert.equal(read.status,200);assert.equal((await read.json()).device,'win-test');
    const same=await get(handler,'tideweave://app/api/v1/save',{'X-Sync-Code':code,'If-None-Match':read.headers.get('etag')});
    assert.equal(same.status,304);
    assert.equal((await get(handler,'tideweave://app/api/v1/save',{'X-Sync-Code':'ZZZZ9999YYYY'})).status,404);
  }finally{await server.close();fs.rmSync(dataDir,{recursive:true,force:true});s.cleanup();}
});

test('Windows 版：没配同步服务回 503，服务连不上时让网页的请求失败',async()=>{
  const s=site();
  try{
    assert.equal((await get(createHandler({root:s.dist,syncServer:''}),'tideweave://app/api/v1/health')).status,503);
    // 只转发白名单里的头，并且把路径、查询串拼到服务地址后面
    let seen;
    const fake=createHandler({root:s.dist,syncServer:'http://sync.test/base/',fetch:async(url,init)=>{seen={url:String(url),init};return new Response('{}',{status:200,headers:{'Content-Type':'application/json','Set-Cookie':'x=1'}});}});
    const r=await get(fake,'tideweave://app/api/v1/save?x=1',{'X-Sync-Code':'C','Cookie':'secret'});
    assert.equal(seen.url,'http://sync.test/base/api/v1/save?x=1');
    assert.deepEqual(Object.keys(seen.init.headers),['x-sync-code']);
    assert.equal(r.headers.get('set-cookie'),null);
    const down=createHandler({root:s.dist,syncServer:'http://127.0.0.1:9'});
    await assert.rejects(()=>get(down,'tideweave://app/api/v1/health'));
  }finally{s.cleanup();}
});
