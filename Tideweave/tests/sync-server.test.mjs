// 云同步服务端接口测试：用原始 HTTP 请求逐条核对 docs/云同步-技术方案.md 第三、六、七部分的约定
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSyncServer,MAX_BODY_BYTES} from '../server/index.mjs';
import {hashCode,createStore} from '../server/store.mjs';

const CODE='ABCD1234EFGH',OTHER='ZZZZ9999YYYY';
const envelope=(extra={},save={})=>({format:1,save:{version:1,records:{},...save},clock:{fields:{},savedAt:1},device:'test',...extra});

// 在临时目录起一个服务；stop() 关服务并删掉数据
async function start(options={}){
  const dir=options.dataDir??fs.mkdtempSync(path.join(os.tmpdir(),'tw-sync-test-'));
  const app=createSyncServer({log:()=>{},...options,dataDir:dir});
  const {port}=await app.listen(0,'127.0.0.1');
  return {app,port,dir,stop:async(keep=false)=>{await app.close();if(!keep)fs.rmSync(dir,{recursive:true,force:true});}};
}

// 原始 HTTP 请求：完全控制请求头，自动解开 gzip
function request(port,method,urlPath,{headers={},body,code}={}){
  return new Promise((resolve,reject)=>{
    const data=body===undefined?null:Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body));
    const req=http.request({host:'127.0.0.1',port,method,path:urlPath,headers:{...(code?{'X-Sync-Code':code}:{}),...(data?{'Content-Length':data.length,'Content-Type':'application/json'}:{}),...headers}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{
        let raw=Buffer.concat(chunks);if(res.headers['content-encoding']==='gzip')raw=zlib.gunzipSync(raw);
        const text=raw.toString('utf8');let json=null;try{json=JSON.parse(text);}catch{}
        resolve({status:res.statusCode,headers:res.headers,text,json});
      });
    });
    req.on('error',reject);req.end(data??undefined);
  });
}
const put=(port,code,body,precondition)=>request(port,'PUT','/api/v1/save',{code,body,headers:precondition});
const create=(port,code,body=envelope())=>put(port,code,body,{'If-None-Match':'*'});
const update=(port,code,rev,body=envelope())=>put(port,code,body,{'If-Match':`"${rev}"`});
const get=(port,code,headers={})=>request(port,'GET','/api/v1/save',{code,headers});

test('新建、读取、更新：版本号写在 ETag 里，版本对不上返回 412',async()=>{
  const s=await start();
  try{
    assert.deepEqual((await request(s.port,'GET','/api/v1/health')).json,{ok:true});
    assert.equal((await get(s.port,CODE)).status,404);
    assert.equal((await put(s.port,CODE,envelope(),{})).status,428,'没有前置条件的推送被拒绝');
    let r=await create(s.port,CODE);assert.equal(r.status,200);assert.deepEqual(r.json,{rev:1});assert.equal(r.headers.etag,'"1"');
    r=await get(s.port,CODE);assert.equal(r.status,200);assert.deepEqual(r.json,envelope());assert.equal(r.headers.etag,'"1"');assert.equal(r.headers['cache-control'],'no-store');
    assert.equal((await get(s.port,CODE,{'If-None-Match':'"1"'})).status,304);
    r=await create(s.port,CODE);assert.equal(r.status,412);assert.equal(r.json.rev,1,'已存在时不能再新建');
    r=await update(s.port,CODE,0);assert.equal(r.status,412);assert.equal(r.json.rev,1);
    r=await update(s.port,CODE,1,envelope({device:'second'}));assert.equal(r.status,200);assert.equal(r.json.rev,2);
    assert.equal((await get(s.port,CODE)).json.device,'second');
    assert.equal((await put(s.port,CODE,envelope(),{'If-Match':'abc'})).status,400);
    assert.equal((await update(s.port,OTHER,1)).status,412,'更新不存在的同步码按冲突处理');
  }finally{await s.stop();}
});

test('同步码必须是规范的 12 位格式，而且不会以明文出现在磁盘和日志里',async()=>{
  const logs=[];const s=await start({log:e=>logs.push(JSON.stringify(e))});
  try{
    for(const bad of ['abcd1234efgh','ABCD1234EFG','ABCD1234EFGU','ABCD-1234-EFGH'])assert.equal((await get(s.port,bad)).status,400,bad);
    assert.equal((await request(s.port,'GET','/api/v1/save')).status,400,'没带同步码');
    await create(s.port,CODE);
    const files=fs.readdirSync(s.dir,{recursive:true});
    assert.ok(files.some(f=>f.includes(hashCode(CODE))),'目录名是同步码的哈希');
    for(const f of files){
      assert.ok(!f.includes(CODE),`路径里出现了同步码：${f}`);
      const full=path.join(s.dir,f);if(fs.statSync(full).isFile())assert.ok(!fs.readFileSync(full,'utf8').includes(CODE));
    }
    assert.ok(logs.length>0&&logs.every(l=>!l.includes(CODE)),'日志里不记同步码');
    assert.ok(logs.some(l=>l.includes(hashCode(CODE).slice(0,8))),'日志里记哈希前缀，便于排查');
  }finally{await s.stop();}
});

test('多台设备同时基于同一版本推送：只有一个成功，其余收到 412',async()=>{
  const s=await start({limits:{write:{capacity:100,refillPerSecond:100}}});
  try{
    await create(s.port,CODE);
    const results=await Promise.all(Array.from({length:8},(_,i)=>update(s.port,CODE,1,envelope({device:`d${i}`}))));
    const winners=results.filter(r=>r.status===200);
    assert.equal(winners.length,1);assert.equal(results.filter(r=>r.status===412).length,7);
    const current=await get(s.port,CODE);assert.equal(current.headers.etag,'"2"');
    assert.equal(current.json.device,`d${results.indexOf(winners[0])}`,'云端是胜出那台设备推送的内容');
  }finally{await s.stop();}
});

test('两个进程（比如服务和运维脚本）同时写同一个同步码：同一个版本号只会写成功一次',async()=>{
  // 两个独立的存储实例各有各的写入队列，相当于两个进程；只能靠 link() 不覆盖已有文件来保证
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tw-store-'));
  try{
    const first=createStore({dir}),second=createStore({dir});
    await first.put(CODE,'{"n":0}',{expect:null});
    for(let rev=1;rev<=20;rev++){
      const results=await Promise.all([first.put(CODE,`{"by":1,"rev":${rev}}`,{expect:rev}),second.put(CODE,`{"by":2,"rev":${rev}}`,{expect:rev})]);
      assert.equal(results.filter(r=>r.ok).length,1,`第 ${rev} 轮应恰好一方成功：${JSON.stringify(results)}`);
      assert.equal((await first.get(CODE)).rev,rev+1);
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('信封格式不对返回 400，超过 4 MB 返回 413，被拒的请求不会写入',async()=>{
  const s=await start();
  try{
    assert.equal((await put(s.port,CODE,'{坏的 JSON',{'If-None-Match':'*'})).json.error,'bad-json');
    const bad=[envelope({format:2}),{format:1},envelope({},{version:2}),envelope({},{records:[]}),envelope({device:'x'.repeat(65)}),envelope({clock:[1]}),[1,2]];
    for(const body of bad){const r=await create(s.port,CODE,body);assert.equal(r.status,400,JSON.stringify(body).slice(0,60));assert.equal(r.json.error,'bad-envelope');}
    const huge=envelope({padding:'x'.repeat(MAX_BODY_BYTES)});
    const r=await create(s.port,CODE,huge);assert.equal(r.status,413);
    assert.equal((await get(s.port,CODE)).status,404,'被拒的请求都没有写入');
  }finally{await s.stop();}
});

test('旧格式不能覆盖云端更新的存档格式（409）',async()=>{
  const s=await start({supportedVersions:[1,2]});
  try{
    assert.equal((await create(s.port,CODE,envelope({},{version:2}))).status,200);
    const r=await update(s.port,CODE,1,envelope({},{version:1}));assert.equal(r.status,409);assert.equal(r.json.version,2);
    assert.equal((await update(s.port,CODE,1,envelope({},{version:2}))).status,200);
  }finally{await s.stop();}
});

test('历史版本：保留最近 N 个，外加窗口内每天最后一个，更早的清理掉',async()=>{
  const s=await start({keepRecent:3,keepDays:3});
  try{
    await create(s.port,CODE);for(const rev of [1,2])await update(s.port,CODE,rev);
    // 把版本 1、2、3 的保存时间改到 5 天前、2 天前、1 天前
    const vdir=path.join(s.dir,'saves',hashCode(CODE).slice(0,2),hashCode(CODE),'v'),day=24*3600*1000;
    [[1,5],[2,2],[3,1]].forEach(([rev,ago])=>{const t=new Date(Date.now()-ago*day);fs.utimesSync(path.join(vdir,`${String(rev).padStart(12,'0')}.json`),t,t);});
    for(const rev of [3,4,5,6])await update(s.port,CODE,rev);
    const r=await request(s.port,'GET','/api/v1/save/versions',{code:CODE});
    assert.deepEqual(r.json.versions.map(v=>v.rev),[7,6,5,3,2],'最近 3 个 + 1 天前、2 天前各一个；5 天前的超出窗口被清理');
    assert.ok(r.json.versions.every(v=>typeof v.size==='number'&&!Number.isNaN(Date.parse(v.savedAt))&&v.device==='test'));
  }finally{await s.stop();}
});

test('版本列表和回滚：回滚把旧内容写成新版本，不删除任何版本',async()=>{
  const s=await start();
  try{
    await create(s.port,CODE,envelope({device:'a'}));await update(s.port,CODE,1,envelope({device:'b'}));
    const list=await request(s.port,'GET','/api/v1/save/versions',{code:CODE});
    assert.deepEqual(list.json.versions.map(v=>[v.rev,v.device]),[[2,'b'],[1,'a']]);
    assert.equal(await s.app.store.restore(CODE,1),3);
    const current=await get(s.port,CODE);assert.equal(current.headers.etag,'"3"');assert.equal(current.json.device,'a');
    assert.equal((await request(s.port,'GET','/api/v1/save/versions',{code:CODE})).json.versions.length,3);
    assert.equal((await request(s.port,'GET','/api/v1/save/versions',{code:OTHER})).status,404);
    await assert.rejects(s.app.store.restore(CODE,99),/不存在/);
  }finally{await s.stop();}
});

test('限流：超过额度返回 429 和 Retry-After；推送和新建同步码分别限流',async()=>{
  let s=await start({limits:{ip:{capacity:3,refillPerSecond:0.01}}});
  try{
    for(let i=0;i<3;i++)assert.equal((await request(s.port,'GET','/api/v1/health')).status,200);
    const r=await request(s.port,'GET','/api/v1/health');assert.equal(r.status,429);assert.ok(Number(r.headers['retry-after'])>=1);assert.equal(r.json.error,'rate-limited');
  }finally{await s.stop();}
  s=await start({limits:{write:{capacity:2,refillPerSecond:0.01},create:{capacity:1,refillPerSecond:0.01}}});
  try{
    assert.equal((await create(s.port,CODE)).status,200);
    assert.equal((await update(s.port,CODE,1)).status,200);
    assert.equal((await update(s.port,CODE,2)).status,429,'同一个同步码推送太频繁');
    assert.equal((await create(s.port,OTHER)).status,429,'同一个 IP 新建同步码太多');
  }finally{await s.stop();}
});

test('CORS：白名单里的来源拿到跨域头，其他来源拿不到',async()=>{
  let s=await start();
  try{
    const pre=await request(s.port,'OPTIONS','/api/v1/save',{headers:{Origin:'http://localhost:5173','Access-Control-Request-Method':'PUT'}});
    assert.equal(pre.status,204);assert.equal(pre.headers['access-control-allow-origin'],'http://localhost:5173');
    assert.match(pre.headers['access-control-allow-headers'],/X-Sync-Code/);assert.match(pre.headers['access-control-allow-headers'],/If-Match/);
    const ok=await request(s.port,'GET','/api/v1/health',{headers:{Origin:'http://127.0.0.1:40123'}});
    assert.equal(ok.headers['access-control-allow-origin'],'http://127.0.0.1:40123');assert.match(ok.headers['access-control-expose-headers'],/ETag/);
    for(const origin of ['http://evil.example','http://localhost.evil.example:80','http://localhost:abc'])assert.equal((await request(s.port,'GET','/api/v1/health',{headers:{Origin:origin}})).headers['access-control-allow-origin'],undefined,origin);
  }finally{await s.stop();}
  s=await start({corsOrigins:['https://game.example']});
  try{
    assert.equal((await request(s.port,'GET','/api/v1/health',{headers:{Origin:'https://game.example'}})).headers['access-control-allow-origin'],'https://game.example');
    assert.equal((await request(s.port,'GET','/api/v1/health',{headers:{Origin:'https://game.example:8443'}})).headers['access-control-allow-origin'],undefined);
    assert.equal((await request(s.port,'GET','/api/v1/health',{headers:{Origin:'http://localhost:5173'}})).headers['access-control-allow-origin'],undefined,'自定义白名单后不再默认放行本机预览');
  }finally{await s.stop();}
});

test('托管网页版：默认关闭；开启后支持首页、gzip、304，挡住目录穿越',async()=>{
  let s=await start();
  try{assert.equal((await request(s.port,'GET','/')).status,404);}finally{await s.stop();}
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tw-static-')),site=path.join(root,'dist');
  fs.mkdirSync(site);fs.writeFileSync(path.join(site,'index.html'),'<!doctype html><title>脉序</title>');
  const script='console.log("tideweave");\n'.repeat(200);fs.writeFileSync(path.join(site,'app.js'),script);
  fs.writeFileSync(path.join(root,'secret.txt'),'不该被读到');
  s=await start({staticDir:site});
  try{
    const home=await request(s.port,'GET','/');assert.equal(home.status,200);assert.match(home.headers['content-type'],/text\/html/);assert.match(home.text,/脉序/);
    const js=await request(s.port,'GET','/app.js',{headers:{'Accept-Encoding':'gzip'}});
    assert.equal(js.headers['content-encoding'],'gzip');assert.equal(js.text,script);assert.match(js.headers['content-type'],/javascript/);
    assert.equal((await request(s.port,'GET','/app.js',{headers:{'If-Modified-Since':js.headers['last-modified']}})).status,304);
    for(const p of ['/../secret.txt','/..%2fsecret.txt','/%2e%2e/secret.txt','/..%5csecret.txt','/nope.js','/'+encodeURIComponent('\0')])assert.equal((await request(s.port,'GET',p)).status===200,false,p);
    // 扫描器真实发过的请求：双斜杠开头的路径曾被当成“//主机名/路径”解析，结果对 //.env 返回了首页（10/19 线上日志发现）
    for(const p of ['//.env','///.env'])assert.equal((await request(s.port,'GET',p)).status,404,p);
    assert.equal((await request(s.port,'GET','//index.html')).status,200,'多余的斜杠按普通路径处理，和常见服务器一样');
    assert.equal((await request(s.port,'GET','*')).status,400,'不以 / 开头的请求目标直接拒绝');
    assert.equal((await request(s.port,'PUT','/index.html',{body:'x'})).status,405);
  }finally{await s.stop();fs.rmSync(root,{recursive:true,force:true});}
});

test('磁盘快满时不再新建同步码，但已有同步码照常更新',async()=>{
  const normal=await start();
  try{await create(normal.port,CODE);}finally{await normal.stop(true);}
  const full=await start({dataDir:normal.dir,minFreeBytes:Number.MAX_SAFE_INTEGER});
  try{
    const r=await create(full.port,OTHER);assert.equal(r.status,507);assert.equal(r.json.error,'storage-full');
    assert.equal((await update(full.port,CODE,1)).status,200);
  }finally{await full.stop();}
});

test('未知接口返回 404，不支持的方法返回 405 并说明允许的方法',async()=>{
  const s=await start();
  try{
    assert.equal((await request(s.port,'GET','/api/v1/nope')).status,404);
    const r=await request(s.port,'DELETE','/api/v1/save',{code:CODE});assert.equal(r.status,405);assert.equal(r.headers.allow,'GET, PUT');
  }finally{await s.stop();}
});
