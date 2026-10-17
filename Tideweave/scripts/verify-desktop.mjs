import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.join(root,'work',`portable-check-${Date.now()}`),copy=path.join(base,'迁移测试 游戏');
const release=path.join(root,'release/Tideweave-win32-x64');
await fs.mkdir(base,{recursive:true});await fs.cp(release,copy,{recursive:true});
let app;const errors=[];
async function launch(dir){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:path.join(dir,'Tideweave.exe'),cwd:root,env,timeout:30000,args:['--disable-gpu']});
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('[data-level="01-01.1"]');return {app,page};
}
try{
  let start=await launch(copy);app=start.app;let page=start.page;
  assert.match(page.url(),/^file:/);
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  await page.locator('[data-level="01-01.1"]').click();
  await page.locator('[data-node="0"]').press('Enter');
  await page.screenshot({path:path.join(root,'verification/desktop-exe.png')});
  const closed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=null;
  const save=JSON.parse(await fs.readFile(path.join(copy,'data/progress.json'),'utf8'));assert.deepEqual(save.records['01-01.1'].state.selected,[0]);
  const moved=path.join(base,'再次移动 后');
  // Chromium subprocesses may release their directory handles slightly after the main window closes.
  for(let attempt=0;attempt<20;attempt++){
    try{await fs.rename(copy,moved);break;}catch(e){if(attempt===19)throw e;await new Promise(resolve=>setTimeout(resolve,500));}
  }
  start=await launch(moved);app=start.app;page=start.page;
  await page.locator('[data-level="01-01.1"]').click();assert.equal(await page.locator('[data-node="0"]').getAttribute('aria-pressed'),'true');
  const runtime=await app.evaluate(({app})=>({version:process.versions.electron,userData:app.getPath('userData'),packaged:app.isPackaged}));assert.equal(runtime.packaged,true);assert.ok(runtime.userData.startsWith(moved));
  const closedAgain=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closedAgain;app=null;
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(root,'verification/desktop-results.json'),JSON.stringify({pass:true,fileProtocol:true,portableMove:true,unicodePath:true,saveOnWindowClose:true,isolatedRenderer:true,runtime,errors},null,2));
  console.log('Packaged desktop passed launch, local files, close-save, Unicode path and moved-directory restore.');
}finally{
  if(app){try{await app.close();}catch{}}
  // Only this script's unique temporary copy is removed; the release and player saves stay intact.
  if(base.startsWith(path.join(root,'work')+path.sep))await fs.rm(base,{recursive:true,force:true,maxRetries:10,retryDelay:500});
}
