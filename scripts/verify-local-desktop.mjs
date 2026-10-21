import {uiClick,selectMission} from './ui-navigation.mjs';
import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {levels,levelById} from '../src/levels.mjs';
import {assetManifest} from '../src/assets.mjs';
import {fresh,recordAttempt} from '../src/progress.mjs';
import {solution,evaluate} from '../src/engine.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const electronPath=createRequire(import.meta.url)('electron');
// 桌面版按网页版的方式把进度存在网页存储里（desktop/main.cjs）
const readSave=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('tideweave-progress')));
await fs.mkdir(path.join(root,'work'),{recursive:true});
const fixture=await fs.mkdtemp(path.join(root,'work','local-check-'));
// Test the current source shell with an isolated save, never the player's data or release.
for(const name of ['desktop','dist','package.json'])await fs.cp(path.join(root,name),path.join(fixture,name),{recursive:true});
// 测试不连同步服务
const env={...process.env,TIDEWEAVE_SYNC_SERVER:''};delete env.ELECTRON_RUN_AS_NODE;
// Windows 上关掉 GPU 仍有软件渲染的 WebGL；Mac 上关掉 GPU 后立体关的 WebGL 起不来，所以只在 Windows 上关
const gpuArgs=process.platform==='win32'?['--disable-gpu']:[];
const launch=()=>electron.launch({executablePath:electronPath,cwd:fixture,env,args:[fixture,...gpuArgs]});
let app;
try{
  app=await launch();
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('[data-action="resume"]');
  assert.match(page.url(),/^tideweave:\/\/app\//);
  await page.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished));});
  for(const action of ['settings','quit']){
    const button=page.locator(`.tw-home-options [data-action="${action}"]`);
    await button.hover();
    await page.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished));});
    assert.equal(await button.locator('.tw-control-detail').count(),0,`${action} has no decorative flow motif`);
  }
  await page.screenshot({path:path.join(root,'verification/local-desktop-home-options.png')});
  const windowBefore=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
  const frames=await page.evaluate(async()=>{
    document.querySelector('[data-action="resume"]').click();const frames=[];
    for(let i=0;i<42;i++){
      await new Promise(requestAnimationFrame);const game=document.querySelector('.tw-game');
      if(game)frames.push({width:game.offsetWidth,client:document.documentElement.clientWidth,height:game.offsetHeight,viewport:innerHeight,scroll:document.documentElement.scrollHeight});
    }
    return frames;
  });
  assert.ok(frames.length>10);
  assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds()),windowBefore,'native window bounds remain unchanged');
  for(const frame of frames){
    assert.equal(frame.width,frames[0].width,'no transient scrollbar width shift');
    assert.equal(frame.client,frames[0].client);
    assert.equal(frame.height,frame.viewport);
    assert.equal(frame.scroll,frame.viewport,'entrance animation cannot grow the page');
  }
  assert.equal(await page.locator('dialog').count(),0,'first level is not interrupted by a chapter briefing');
  assert.equal(await page.locator('.tw-task p').innerText(),levelById['01-01.1'].controls);
  assert.equal(await page.locator('.tw-header').count(),0);
  await page.locator('[data-node="0"] .station-body').click();
  await page.locator('[data-action="rules"]').click();
  assert.match(await page.locator('dialog').innerText(),/本关规则/);
  await page.locator('[data-action="close"]').first().click();
  const runtime=await app.evaluate(({app})=>({packaged:app.isPackaged,userData:app.getPath('userData')}));
  assert.equal(runtime.packaged,false);assert.ok(runtime.userData.startsWith(fixture+path.sep));
  await page.screenshot({path:path.join(root,'verification/local-desktop.png')});
  const decoded=await page.evaluate(async assets=>{
    for(const asset of Object.values(assets)){const image=new Image();image.src=asset.path;await image.decode();}
    return Object.keys(assets).length;
  },assetManifest);
  const seed=fresh();seed.settings.motion=false;
  for(const level of levels){const state=solution(level);recordAttempt(seed,level,state,evaluate(level,state));delete seed.records[level.id].state;}
  seed.records['01-01.1'].state={...solution(levelById['01-01.1']),selected:[0]};
  await page.evaluate(data=>localStorage.setItem('tideweave-progress',JSON.stringify(data)),seed);await page.reload();
  await uiClick(page,'[data-level="04-02.3"]');
  await page.waitForFunction(()=>document.querySelector('#tw-solid canvas')?.dataset.surface==='loaded');
  assert.ok(await page.locator('#tw-solid canvas').evaluate(canvas=>{
    const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
    const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);
    return ctx.getImageData(0,0,copy.width,copy.height).data.some((v,i)=>i%4===3&&v>0);
  }),'textured solid renders offline through the app protocol');
  await page.screenshot({path:path.join(root,'verification/local-desktop-solid.png')});
  const closed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=null;
  // 关窗前存的档，重新打开后还在
  app=await launch();const reopened=await app.firstWindow();await reopened.waitForSelector('[data-action="resume"]');
  const save=await readSave(reopened);
  const reclosed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await reclosed;app=null;
  assert.deepEqual(save.records['01-01.1'].state.selected,[0]);assert.deepEqual(save.briefings,[]);assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(root,'verification/local-desktop-results.json'),JSON.stringify({pass:true,appProtocol:true,currentSource:true,isolatedSave:true,closeSave:true,decoded,solidTexture:true,runtime,errors},null,2));
  console.log(`Local Electron passed: ${decoded} app-protocol assets, textured solid, rules dialog, isolated close-save.`);
}finally{if(app)await app.close();}
