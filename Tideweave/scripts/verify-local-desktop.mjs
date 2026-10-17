import {uiClick,selectMission} from './ui-navigation.mjs';
import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {levelById} from '../src/levels.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.mkdir(path.join(root,'work'),{recursive:true});
const fixture=await fs.mkdtemp(path.join(root,'work','local-check-'));
// Test the current source shell with an isolated save, never the player's data or release.
for(const name of ['desktop','dist','package.json'])await fs.cp(path.join(root,name),path.join(fixture,name),{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
  app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),cwd:fixture,env,args:[fixture,'--disable-gpu']});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('[data-action="resume"]');
  assert.match(page.url(),/^file:/);
  await page.locator('[data-action="resume"]').click();
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
  const closed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=null;
  const save=JSON.parse(await fs.readFile(path.join(fixture,'data/progress.json'),'utf8'));
  assert.deepEqual(save.records['01-01.1'].state.selected,[0]);assert.deepEqual(save.briefings,[]);assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(root,'verification/local-desktop-results.json'),JSON.stringify({pass:true,fileProtocol:true,currentSource:true,isolatedSave:true,closeSave:true,runtime,errors},null,2));
  console.log('Local Electron passed: current source, file protocol, plain instructions, rules dialog, isolated close-save.');
}finally{if(app)await app.close();}
