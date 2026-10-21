import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {measureAudioOutput} from './measure-audio-output.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const {_electron: electron} = require('playwright');
const {fresh, recordAttempt} = await import(pathToFileURL(path.join(root, 'src/progress.mjs')));
const {levels, levelById} = await import(pathToFileURL(path.join(root, 'src/levels.mjs')));
const {solution, evaluate, initialState} = await import(pathToFileURL(path.join(root, 'src/engine.mjs')));
const {uiClick} = await import(pathToFileURL(path.join(root, 'scripts/ui-navigation.mjs')));
// Run only against a temporary app and save, never the player's data directory.
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'Tideweave-audio-check-'));
// server/http-range.cjs 是桌面外壳和服务端共用的 Range 解析
for (const name of ['desktop', 'dist', 'package.json', 'server/http-range.cjs']) await fs.cp(path.join(root, name), path.join(fixture, name), {recursive: true});
const progress = fresh(); progress.settings.motion = false;
for (const level of levels) {
  const state = solution(level);
  recordAttempt(progress, level, state, evaluate(level, state));
}
progress.last = '01-01.1';
progress.records['01-01.1'].state = initialState(levelById['01-01.1']);
await fs.mkdir(path.join(fixture, 'data'), {recursive: true});
await fs.writeFile(path.join(fixture, 'data/progress.json'), JSON.stringify(progress));
const env = {...process.env, TIDEWEAVE_SYNC_SERVER: ''}; delete env.ELECTRON_RUN_AS_NODE; // 测试不连同步服务
// Windows 上关掉 GPU 仍有软件渲染的 WebGL；Mac 上关掉 GPU 后 WebGL 起不来，所以只在 Windows 上关
const gpuArgs = process.platform === 'win32' ? ['--disable-gpu'] : [];
let app;
const report = {fixture, errors: []};
try {
  // 预先写好的 data/progress.json 会在首次启动时迁移进网页存储（desktop/main.cjs）
  app = await electron.launch({executablePath: require('electron'), cwd: fixture, env, args: [fixture, ...gpuArgs]});
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.__audio = [];
    window.__audioEvents = [];
    window.__audioContexts = [];
    window.__outputGains = [];
    window.__outputMeters = [];
    const NativeContext = window.AudioContext;
    window.AudioContext = new Proxy(NativeContext, {
      construct(Target, args) {
        const context = new Target(...args);
        window.__audioContexts.push(context);
        const createGain = context.createGain.bind(context);
        context.createGain = () => {const node = createGain(); window.__outputGains.push(node); return node;};
        const createShaper = context.createWaveShaper.bind(context);
        context.createWaveShaper = () => {
          const node = createShaper(), meter = context.createAnalyser();
          node.connect(meter); window.__outputMeters.push(meter);
          return node;
        };
        return context;
      },
    });
    window.Audio = new Proxy(NativeAudio, {
      construct(Target, args) {
        const media = new Target(...args);
        const play = media.play.bind(media);
        media.play = () => {
          window.__audioEvents.push({src: media.src, event: 'play', at: performance.now()});
          return play();
        };
        media.addEventListener('error', () => window.__audioEvents.push({src: media.src, event: 'error', code: media.error?.code}));
        window.__audio.push(media);
        return media;
      },
    });
  });
  await page.reload();
  console.log('Reloaded isolated desktop with media instrumentation.');
  await page.waitForSelector('[data-action="resume"]');
  assert.match(page.url(), /^tideweave:\/\/app\//);
  await page.locator('[data-action="campaign"]').click();
  await page.waitForFunction(() => window.__audio.length === 5 && window.__audio.every(media => media.readyState >= 2));
  await page.waitForFunction(() => window.__audio[0].currentTime > .5 && window.__audio[0].volume > 0);
  report.decoded = await page.evaluate(() => window.__audio.map(media => ({file: media.src.split('/').at(-1), duration: media.duration, volume: media.volume})));
  console.log('Five channels decoded; calibrated music is playing.');
  await page.waitForFunction(() => {
    const meter = window.__outputMeters[0];
    if (!meter) return false;
    const samples = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(samples);
    return samples.some(value => Math.abs(value) > .001);
  });
  report.output = await page.evaluate(() => ({contexts: window.__audioContexts.length, state: window.__audioContexts[0].state, boostDb: 20 * Math.log10(window.__outputGains[0].gain.value)}));
  assert.equal(report.output.contexts, 1);
  assert.equal(report.output.state, 'running');
  assert.ok(Math.abs(report.output.boostDb - 14) < .001);
  assert.ok(await page.evaluate(() => window.__audio[2].duration <= .15), 'click is no longer than 150 ms');
  const counts = () => page.evaluate(() => Object.fromEntries(['sfx_click.wav', 'sfx_clear.wav', 'sfx_medal.wav'].map(file => [file, window.__audioEvents.filter(event => event.event === 'play' && event.src.endsWith(file)).length])));
  assert.equal((await counts())['sfx_click.wav'], 0, 'opening chapters is quiet');
  const beforeTime = await page.evaluate(() => window.__audio[0].currentTime);
  await page.locator('[data-action="settings"]').click();
  await page.waitForSelector('dialog[open]');
  assert.equal((await counts())['sfx_click.wav'], 0, 'opening settings is quiet');
  assert.equal(await page.locator('dialog [data-setting]').count(), 6);
  assert.equal(await page.locator('[data-setting="volume"]').inputValue(), '0.8');
  assert.equal(await page.locator('[data-setting="effectsVolume"]').inputValue(), '0.5');
  assert.equal(await page.locator('[data-setting="musicVolume"]').inputValue(), '0.5');
  for (const setting of ['volume', 'effectsVolume', 'musicVolume']) assert.equal(await page.locator(`[data-setting="${setting}"]`).getAttribute('step'), '.01');
  assert.ok(await page.evaluate(time => window.__audio[0].currentTime >= time && window.__audio.length === 5, beforeTime));
  await page.locator('[data-setting="sound"]').uncheck();
  await page.waitForFunction(() => window.__audio.every(media => media.paused));
  const mutedCounts = await counts();
  await page.locator('dialog [data-action="close"]').last().click();
  await page.locator('[data-action="settings"]').click();
  assert.deepEqual(await counts(), mutedCounts, 'muted UI produces no sound');
  await page.locator('[data-setting="sound"]').check();
  await page.waitForFunction(() => !window.__audio[0].paused);
  await page.locator('[data-setting="music"]').uncheck();
  assert.ok(await page.evaluate(() => window.__audio.slice(0, 2).every(media => media.paused)));
  await page.locator('[data-setting="volume"]').evaluate(input => {input.value = '.3'; input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new Event('change', {bubbles: true}));});
  await page.locator('[data-setting="musicVolume"]').evaluate(input => {input.value = '.35'; input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new Event('change', {bubbles: true}));});
  await page.locator('[data-setting="music"]').check();
  await page.waitForFunction(() => window.__audio[0].volume > 0);
  await page.locator('[data-setting="effectsVolume"]').evaluate(input => {input.value = '0'; input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new Event('change', {bubbles: true}));});
  assert.ok(await page.evaluate(() => window.__audio.slice(2).every(media => media.volume === 0 && media.paused)));
  assert.ok(await page.evaluate(() => !window.__audio[0].paused && window.__audio[0].volume > 0));
  await page.locator('[data-setting="effectsVolume"]').evaluate(input => {input.value = '.4'; input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new Event('change', {bubbles: true}));});
  assert.ok(await page.evaluate(() => window.__audio.slice(2).every(media => Math.abs(media.volume - Math.sqrt(.3) * .4) < .0001)));
  assert.equal((await counts())['sfx_click.wav'], 0, 'settings and volume adjustments are quiet');
  await page.screenshot({path: path.join(fixture, 'settings-desktop.png')});
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(720, 620));
  await page.screenshot({path: path.join(fixture, 'settings-small.png')});
  const dialogFits = await page.locator('dialog').evaluate(dialog => {const bounds = dialog.getBoundingClientRect(); return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;});
  assert.ok(dialogFits, 'settings fit the minimum desktop window');
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1360, 860));
  await page.locator('dialog [data-action="close"]').last().click();

  console.log('Mute, volume controls, and settings layouts passed.');
  await uiClick(page, '[data-level="03-02.2"]');
  assert.equal((await counts())['sfx_click.wav'], 1, 'chapter browsing is quiet, deploying emits one click');
  const roadBefore = await counts();
  await page.locator('.station-body').first().click({force: true});
  assert.deepEqual(await counts(), roadBefore, 'noninteractive station emits no edit sound');
  // 点击音有 85 ms 防连响（src/audio.mjs 的 click()）：紧跟在“出发”后面的编辑会被当成连点吞掉。
  // 机器快时（10/21 Mac 上）道路点击落在这 85 ms 里，所以先等过这段时间再点
  await page.waitForTimeout(150);
  await page.locator('[data-edge="0"]').click();
  assert.equal((await counts())['sfx_click.wav'], roadBefore['sfx_click.wav'] + 1, 'a road edit emits exactly one click');
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(() => window.__audio[0].volume > Math.sqrt(.3) * .35 * .999);
  const musicBeforeMedal = await page.evaluate(() => {
    window.__medalMusic = [];
    window.__medalSampler = setInterval(() => {
      if (!window.__audio[4].paused) window.__medalMusic.push(window.__audio[0].volume + window.__audio[1].volume);
    }, 20);
    return window.__audio[0].volume + window.__audio[1].volume;
  });
  const medalBefore = await counts();
  await page.locator('[data-action="run"]').click();
  await page.waitForFunction(() => document.querySelector('dialog h2')?.textContent === '联运有序');
  const medalAfter = await counts();
  assert.equal(medalAfter['sfx_clear.wav'], medalBefore['sfx_clear.wav'] + 1);
  assert.equal(medalAfter['sfx_medal.wav'], medalBefore['sfx_medal.wav']);
  await page.waitForFunction(() => window.__medalMusic.length >= 15);
  const medalMusic = await page.evaluate(() => {clearInterval(window.__medalSampler); return window.__medalMusic;});
  assert.ok(medalMusic.every(gain => Math.abs(gain / musicBeforeMedal - .65) < .002), 'medal retains 65% of BGM during playback');
  await page.waitForFunction(before => window.__audio[4].paused && window.__audio[0].volume + window.__audio[1].volume >= before * .99, musicBeforeMedal);
  report.medalDucksMusic = true;
  report.medalMusicRecovers = true;
  await page.locator('dialog [data-action="close"]').last().click();
  await page.locator('[data-action="replay"]').click();
  await page.waitForFunction(() => document.querySelector('[data-action="pause"]')?.title === '播放');
  assert.equal((await counts())['sfx_clear.wav'], medalAfter['sfx_clear.wav'], 'replay does not award sound');

  await uiClick(page, '[data-level="03-03.1"]');
  await page.waitForFunction(() => window.__audio[0].volume + window.__audio[1].volume > Math.sqrt(.3) * .35 * .999);
  const musicBeforeClear = await page.evaluate(() => {
    window.__clearMusic = [];
    window.__clearSampler = setInterval(() => {
      if (!window.__audio[3].paused) window.__clearMusic.push(window.__audio[0].volume + window.__audio[1].volume);
    }, 20);
    return window.__audio[0].volume + window.__audio[1].volume;
  });
  const clearBefore = await counts();
  await page.locator('[data-action="run"]').click();
  await page.waitForFunction(() => document.querySelector('dialog h2')?.textContent === '设施恢复');
  assert.equal((await counts())['sfx_medal.wav'], clearBefore['sfx_medal.wav'] + 1);
  assert.equal((await counts())['sfx_clear.wav'], clearBefore['sfx_clear.wav']);
  await page.waitForFunction(() => window.__clearMusic.length >= 15);
  const clearMusic = await page.evaluate(() => {clearInterval(window.__clearSampler); return window.__clearMusic;});
  assert.ok(clearMusic.every(gain => Math.abs(gain / musicBeforeClear - .65) < .002), 'ordinary completion retains 65% of BGM during playback');
  await page.waitForFunction(before => window.__audio[3].paused && window.__audio[0].volume + window.__audio[1].volume >= before * .99, musicBeforeClear);
  report.clearDucksMusic = true;
  report.clearMusicRecovers = true;
  await page.locator('dialog [data-action="close"]').last().click();

  await uiClick(page, '[data-level="01-01.1"]');
  await page.locator('[data-node="0"]').click();
  const failureBefore = await counts();
  await page.locator('[data-action="run"]').click();
  await page.waitForFunction(() => document.querySelector('dialog h2')?.textContent === '还需调整');
  assert.equal((await counts())['sfx_clear.wav'], failureBefore['sfx_clear.wav']);
  assert.equal((await counts())['sfx_medal.wav'], failureBefore['sfx_medal.wav']);
  await page.locator('dialog [data-action="close"]').last().click();

  await page.evaluate(() => {window.__audio[0].currentTime = window.__audio[0].duration - 1.4;});
  await page.waitForFunction(() => window.__audio[1].currentTime > .1 && window.__audio[1].volume > 0);
  await page.waitForFunction(() => window.__audio[0].paused && !window.__audio[1].paused && window.__audio[1].currentTime > 1.6);
  report.loop = true;
  console.log('Road editing, exclusive rewards, silent failures, replay and loop passed.');
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].minimize());
  await page.waitForFunction(() => window.__audio.every(media => media.paused), null, {polling: 100});
  const pausedAt = await page.evaluate(() => window.__audio[1].currentTime);
  await app.evaluate(({BrowserWindow}) => {const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.focus();});
  await page.waitForFunction(time => window.__audio[1].currentTime > time + .1, pausedAt);
  report.minimizeResume = true;

  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-setting="sound"]').uncheck();
  // 桌面版按网页版的方式把进度存在网页存储里
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('tideweave-progress')).settings.sound === false);
  await page.reload();
  await page.waitForSelector('[data-action="resume"]');
  assert.ok(await page.evaluate(() => window.__audio.every(media => media.paused)));
  await page.locator('[data-action="settings"]').first().click();
  assert.equal(await page.locator('[data-setting="sound"]').isChecked(), false);
  assert.equal(await page.locator('[data-setting="volume"]').inputValue(), '0.3');
  assert.equal(await page.locator('[data-setting="effectsVolume"]').inputValue(), '0.4');
  assert.equal(await page.locator('[data-setting="musicVolume"]').inputValue(), '0.35');
  assert.equal(await page.locator('[data-setting="music"]').isChecked(), true);
  assert.deepEqual(await page.evaluate(() => window.__audioEvents.filter(event => event.event === 'error')), []);
  assert.deepEqual(report.errors, []);
  report.persisted = true;
  report.outputMeasurement = await measureAudioOutput(page, root, fixture);
  report.pass = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (app) {
    console.log('Window state', await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(win => ({minimized: win.isMinimized(), visible: win.isVisible(), focused: win.isFocused()}))).catch(() => null));
    console.log('Media state', await app.firstWindow().then(page => page.evaluate(() => ({hidden: document.hidden, visibility: document.visibilityState, errors: window.__audioEvents.filter(e => e.event === 'error'), channels: window.__audio.map(a => ({time: a.currentTime, paused: a.paused, volume: a.volume}))}))).catch(() => null));
  }
  console.error(error);
  report.failure = error.message;
  throw error;
} finally {
  if (app) await app.evaluate(({app}) => app.exit(0)).catch(() => {});
  await fs.writeFile(path.join(fixture, 'results.json'), JSON.stringify(report, null, 2));
}
