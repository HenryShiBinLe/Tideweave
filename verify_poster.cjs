const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/Teio/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=__dirname,out=path.join(root,'verification');
async function run(){
 const context=await chromium.launchPersistentContext(path.join(process.env.GRAPH_TEST_DIR,'browser'),{channel:'msedge',headless:true,viewport:{width:1440,height:1000},args:['--disable-background-networking']});
 const page=await context.newPage(),errors=[],external=[],sockets=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('websocket',s=>sockets.push(s.url()));
 page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:')&&!r.url().startsWith('data:'))external.push(r.url());});
 async function settled(){await page.waitForFunction(()=>!busy);}
 async function click(selector){const before=await page.evaluate(()=>model.revision);await page.locator(selector).click();await page.waitForFunction(r=>model.revision>r&&!busy,before);}
 async function close(){if(await page.locator('dialog').evaluate(d=>d.open))await page.locator('#dialog-close').click();}
 async function enter(i){
  await close();if(await page.evaluate(()=>screen==='play'))await page.locator('#back').click();
  const ch=await page.evaluate(i=>model.levels[i].chapter,i);await page.locator(`[data-chapter="${ch}"]`).click();await page.locator(`[data-level="${i}"]`).click();
  if(await page.locator('dialog').evaluate(d=>d.open))await page.locator('#dialog-actions button').last().click();
  await page.waitForFunction(i=>screen==='play'&&model.index===i&&!busy,i);
 }
 async function screenshot(name){await page.waitForTimeout(140);await page.screenshot({path:path.join(out,name),fullPage:true});}
 async function styleAudit(){
  const audit=await page.evaluate(()=>{
   const allowed=new Set(['rgb(217, 43, 43)','rgb(17, 17, 17)','rgb(242, 237, 228)','rgb(30, 58, 95)','rgba(0, 0, 0, 0)']);
   const problems=[];for(const e of document.querySelectorAll('body *')){if(!e.getClientRects().length||e.closest('svg'))continue;const s=getComputedStyle(e);for(const k of ['color','backgroundColor'])if(!allowed.has(s[k]))problems.push(`${e.tagName}.${e.className} ${k} ${s[k]}`);if(s.boxShadow!=='none'||s.textShadow!=='none'||s.filter!=='none'||s.backdropFilter!=='none'||s.borderRadius!=='0px'||s.backgroundImage.includes('gradient'))problems.push(`${e.tagName}.${e.className} forbidden effect`);if(s.animationName!=='none'&&s.animationName!=='press')problems.push('Unexpected animation '+s.animationName);}
   return problems;
  });assert.deepStrictEqual(audit,[]);
 }
 try{
  await page.goto(process.env.GRAPH_URL);await page.waitForFunction(()=>typeof model!=='undefined'&&model);
  await page.waitForFunction(()=>screen==='home');await screenshot('poster-home.png');await styleAudit();
  if(process.env.GRAPH_SMOKE_ONLY==='1'){
   await screenshot('packaged-home.png');await page.locator('#continue').click();await page.waitForFunction(()=>screen==='play');await screenshot('packaged-exe.png');
   assert.strictEqual(errors.length,0,errors.join('\n'));assert.strictEqual(external.length,0);assert.strictEqual(sockets.length,0);console.log('Packaged poster and game rendered');return;
  }
  const actions=JSON.parse(fs.readFileSync(process.env.GRAPH_SOLUTIONS,'utf8'));
  // Chapter selectors have only the current chapter's tickets, and never accompany play.
  assert.strictEqual(await page.locator('.level-ticket').count(),2);await page.locator('[data-chapter="1"]').click();assert.strictEqual(await page.locator('.level-ticket').count(),3);await page.locator('[data-chapter="0"]').click();
  await page.locator('#continue').click();await page.waitForFunction(()=>screen==='play');assert(await page.locator('#home').isHidden());assert.strictEqual(await page.locator('aside').count(),0);
  // Error feedback, keyboard operation, undo and confirmed reset.
  await page.locator('[data-node="1"]').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>model.state.current===1&&!busy);
  await click('[data-node="0"]');assert((await page.locator('#status').textContent()).includes('走过'));
  await page.keyboard.press('Control+z');await page.waitForFunction(()=>model.state.current===0&&!busy);
  await click('#hint');assert((await page.locator('#status').textContent()).includes('路口'));
  await click('[data-node="1"]');await page.locator('#back').click();await page.locator('#continue').click();assert.strictEqual(await page.evaluate(()=>model.state.current),1,'Returning to home must preserve current moves');
  await page.keyboard.press('Control+r');assert(await page.locator('#dialog').evaluate(d=>d.open));await page.locator('#dialog-actions button').last().click();await page.waitForFunction(()=>model.history===0&&!busy);
  const sizes=[];
  for(const [width,height]of [[1000,720],[1440,1000],[1920,1080],[3840,2160],[390,844]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(80);
   const info=await page.evaluate(()=>({font:parseFloat(getComputedStyle(document.documentElement).fontSize),title:parseFloat(getComputedStyle(document.querySelector('#title')).fontSize),overflow:document.documentElement.scrollWidth>innerWidth,nodeFont:parseFloat(getComputedStyle(document.querySelector('.node-name')).fontSize),toolbarBottom:document.querySelector('.toolbar').getBoundingClientRect().bottom}));
   assert(info.font>=14&&info.font<=20);assert(!info.overflow,`Game overflow at ${width}`);if(width>=1000)assert(info.toolbarBottom<=height+2,`Controls outside viewport at ${width}: ${info.toolbarBottom}`);sizes.push({width,height,...info});
   if([1000,1920,390].includes(width))await screenshot(`responsive-${width}.png`);
   await page.locator('#back').click();await styleAudit();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Home overflow at ${width}`);
   if([1000,390].includes(width))await screenshot(`poster-home-${width}.png`);
   await page.locator('#continue').click();
  }
  assert(sizes[3].font>sizes[0].font);await page.setViewportSize({width:1440,height:1000});
  for(let i=0;i<10;i++){
   if(i>0)await enter(i);await styleAudit();await screenshot(`web-level-${String(i+1).padStart(2,'0')}.png`);
   const text=await page.locator('body').innerText();assert(!/[\u{1F300}-\u{1FAFF}]/u.test(text),'Emoji visible');
   for(const [kind,n,c]of actions[i]){
    if(kind==='color'){await page.locator(`[data-color="${c}"]`).click();await click(`[data-node="${n}"]`);}
    else await click(kind==='submit'?'#submit':`[data-${kind}="${n}"]`);
    if(i===4&&n===2)await screenshot('web-distance-update.png');
   }
   await page.waitForFunction(()=>model.state.finished);assert.strictEqual(await page.evaluate(()=>model.state.stars),3);assert(await page.locator('dialog').evaluate(d=>d.open));
   if(i===8)await screenshot('poster-result.png');
   if([1,4,6,8,9].includes(i)){await page.locator('#dialog-actions button').last().click();assert.strictEqual(await page.locator('#dialog-eyebrow').textContent(),'本章发现');if(i===4)await screenshot('web-chapter-summary.png');}
  }
  assert.strictEqual(await page.evaluate(()=>model.progress.stars.reduce((a,b)=>a+b,0)),30);
  await close();await page.locator('#back').click();await screenshot('poster-complete.png');
  // Read a completed coloring map at the small desktop size: all five stamps remain available.
  await page.setViewportSize({width:1000,height:720});await enter(8);await styleAudit();assert.strictEqual(await page.locator('[data-color]').count(),5);await screenshot('poster-small-color.png');
  await page.locator('#help').click();assert((await page.locator('#dialog-body').textContent()).includes('不同颜色'));await close();
  await page.locator('#menu').click();await page.locator('.menu-row').first().click();await page.waitForFunction(()=>model.progress.sound&&!busy);await close();
  const css=fs.readFileSync(path.join(root,'web','style.css'),'utf8');assert(!/(?:linear|radial)-gradient|box-shadow|text-shadow|backdrop-filter|filter\s*:/.test(css));assert.strictEqual((css.match(/@keyframes/g)||[]).length,1);
  assert.strictEqual(errors.length,0,errors.join('\n'));assert.strictEqual(external.length,0);assert.strictEqual(sockets.length,0);
  const report={levels_passed:10,stars:30,keyboard:'passed',resume_without_reset:'passed',chapter_summaries:5,responsive:sizes,javascript_errors:errors,external_requests:external,websocket_connections:sockets,palette_audit:'passed',forbidden_effects:'none',emoji_nodes:false,left_level_sidebar:false,group_markers:5};
  fs.writeFileSync(path.join(out,'ui-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await context.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
