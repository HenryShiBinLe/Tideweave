import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio, audioFiles, clickActions } from '../src/audio.mjs';
import { fresh, normalize } from '../src/progress.mjs';
import {createOutputGraph, outputBoostDb} from '../src/audio-output.mjs';

test('the output bus provides expanded maximum gain with peak protection', () => {
  const node = () => ({gain: {}, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connections: [], connect(target) {this.connections.push(target);}});
  const destination = {}, context = {destination, createGain: node, createDynamicsCompressor: node, createWaveShaper: node};
  const {input, compressor, ceiling} = createOutputGraph(context);
  assert.equal(outputBoostDb, 14);
  assert.equal(input.gain.value, 10 ** (14 / 20));
  assert.equal(input.connections[0], compressor);
  assert.equal(ceiling.connections[0], destination);
  assert.equal(ceiling.oversample, '4x');
  assert.ok(ceiling.curve.every(value => Number.isFinite(value) && Math.abs(value) < .78));
});

function rig(t, rejected = false) {
  let time = 0, tick;
  const tracks = [];
  const audio = new GameAudio({
    createAudio(src) {
      const media = {
        src, paused: true, currentTime: 0, duration: src === audioFiles.music ? 176 : src === audioFiles.click ? .12 : 2,
        volume: 0, plays: 0, addEventListener() {},
        play() {
          this.plays++;
          if (rejected) return Promise.reject(Object.assign(new Error('Gesture required'), { name: 'NotAllowedError' }));
          this.paused = false;
          return Promise.resolve();
        },
        pause() { this.paused = true; },
      };
      tracks.push(media);
      return media;
    },
    now: () => time,
    every: callback => { tick = callback; return 1; },
    cancel: () => { tick = null; },
  });
  audio.configure(fresh().settings);
  t.after(() => audio.dispose());
  return {
    audio, tracks,
    allow: () => { rejected = false; },
    advance(ms) {
      for (let elapsed = 0; elapsed < ms; elapsed += 50) {
        time += 50;
        for (const media of tracks) if (!media.paused) {
          media.currentTime += .05;
          if (media.currentTime >= media.duration) {
            if (media.loop) media.currentTime %= media.duration;
            else media.paused = true;
          }
        }
        tick?.();
      }
    },
  };
}
const settled = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('old saves retain mute and volume while gaining local music defaults', () => {
  const old = { ...fresh(), settings: { sound: false, volume: 0, motion: false, speed: 2 } };
  const loaded = normalize(old);
  assert.deepEqual(loaded.settings, { sound: false, volume: 0, effectsVolume: 1, music: true, musicVolume: .5, motion: false, speed: 2 });
  assert.deepEqual(normalize(loaded), loaded);
  const changed = normalize({ ...fresh(), settings: { music: false, musicVolume: 5, volume: -4, speed: 4 } });
  assert.equal(changed.settings.music, false);
  assert.equal(changed.settings.musicVolume, 1);
  assert.equal(changed.settings.volume, 0);
  assert.equal(changed.settings.speed, 3);
  assert.equal(normalize({ ...fresh(), settings: { musicVolume: NaN } }).settings.musicVolume, .5);
  assert.equal(fresh().settings.volume, 1);
  assert.equal(fresh().settings.musicVolume, .5);
  assert.equal(normalize({...fresh(), settings: {musicVolume: .8}}).settings.musicVolume, .8);
  for (const [value, expected] of [[.35, .35], [0, 0], [-1, 0], [4, 1], [NaN, 1], ['0.2', 1]]) {
    const save = normalize({...fresh(), settings: {effectsVolume: value}});
    assert.equal(save.settings.effectsVolume, expected);
    assert.deepEqual(normalize(save), save);
  }
});

test('effects and music have independent faders under the existing master volume', async t => {
  const {audio, advance} = rig(t);
  const settings = {...fresh().settings, volume: .36, effectsVolume: .4, musicVolume: .7};
  audio.configure(settings); audio.activate(); await settled(); advance(2500);
  audio.click(); await settled();
  assert.ok(Math.abs(audio.effects.click.volume - .24) < .0001);
  const bed = audio.music[0].volume;
  assert.ok(Math.abs(bed - .42) < .0001);
  audio.configure({...settings, effectsVolume: .8});
  assert.ok(Math.abs(audio.effects.click.volume - .48) < .0001);
  assert.equal(audio.music[0].volume, bed);
  audio.configure({...settings, effectsVolume: .8, musicVolume: 0});
  assert.ok(audio.music.every(media => media.paused));
  audio.result({pass: true, perfect: true}); await settled();
  assert.ok(!audio.effects.medal.paused);
  assert.ok(Math.abs(audio.effects.medal.volume - .48) < .0001);
  audio.configure({...settings, volume: .09});
  assert.ok(Math.abs(audio.effects.medal.volume - .12) < .0001);
  advance(2500);
  assert.ok(Math.abs(audio.music[0].volume - .21) < .0001);
});

test('muting effects stops a reward, restores music and does not queue later cues', async t => {
  const {audio, advance} = rig(t);
  audio.activate(); await settled(); advance(2500);
  audio.result({pass: true, perfect: false}); await settled(); advance(100);
  assert.ok(audio.music[0].volume < .2);
  audio.configure({...fresh().settings, effectsVolume: 0});
  assert.ok(Object.values(audio.effects).every(media => media.paused));
  assert.equal(audio.activeEffect, null);
  const plays = Object.values(audio.effects).map(media => media.plays);
  audio.click(); audio.result({pass: true}); audio.result({pass: true, perfect: true});
  advance(2500);
  assert.ok(audio.music[0].volume > .499);
  assert.deepEqual(Object.values(audio.effects).map(media => media.plays), plays);
  audio.configure(fresh().settings); await settled();
  assert.deepEqual(Object.values(audio.effects).map(media => media.plays), plays);
  audio.click(); await settled();
  assert.equal(audio.effects.click.plays, 1);
});

test('master mute and zero volume silence all channels; music can be disabled independently', async t => {
  const { audio, tracks, advance } = rig(t);
  audio.configure({ ...fresh().settings, sound: false });
  audio.activate(); audio.click(); audio.result({ pass: true, perfect: true });
  assert.ok(tracks.every(media => media.plays === 0));
  audio.configure({ ...fresh().settings, music: false });
  audio.click(); await settled();
  assert.equal(audio.effects.click.plays, 1);
  assert.ok(audio.music.every(media => media.paused));
  audio.configure(fresh().settings); advance(1000); await settled();
  assert.ok(audio.music[0].volume > 0);
  audio.configure({ ...fresh().settings, volume: 0 });
  assert.ok(tracks.every(media => media.paused));
  audio.click(); audio.result({ pass: true });
  assert.equal(audio.effects.clear.plays, 0);
});

test('failures stay quiet and a perfect pass plays only the medal cue', async t => {
  const { audio, advance } = rig(t);
  audio.activate(); advance(1200); await settled();
  const bed = audio.music[0].volume;
  audio.result({ pass: false });
  assert.equal(audio.effects.clear.plays + audio.effects.medal.plays, 0);
  audio.result({ pass: true, perfect: false }); await settled();
  assert.equal(audio.effects.clear.plays, 1);
  advance(500);
  assert.ok(audio.music[0].volume < bed * .4, 'ordinary clear still ducks the music');
  advance(2500);
  audio.result({ pass: true, perfect: true }); await settled();
  assert.equal(audio.effects.medal.plays, 1);
  assert.ok(audio.effects.clear.paused);
  advance(500);
  assert.ok(audio.music[0].volume >= bed * .99, 'medal does not duck the music');
  advance(2500);
  assert.ok(audio.music[0].volume > bed * .95, 'music recovers after the cue');
});

test('click bursts reuse one channel and media retain their calibrated levels before output gain', async t => {
  const { audio, advance } = rig(t);
  audio.activate(); await settled();
  audio.click(); await settled(); audio.click();
  assert.equal(audio.effects.click.plays, 1);
  advance(100); audio.click(); await settled();
  assert.equal(audio.effects.click.plays, 2);
  assert.equal(audio.effects.click.currentTime, 0);
  const peakDb = { click: -6.1, clear: -3, medal: -4.93 };
  for (const [name, peak] of Object.entries(peakDb)) {
    const renderedPeak = peak + 20 * Math.log10(audio.effects[name].volume);
    assert.ok(renderedPeak <= -3 && renderedPeak >= -6.2, `${name} plays at its calibrated level`);
  }
});

test('page changes and repeated settings application keep music position and a single bed', async t => {
  const { audio, advance } = rig(t);
  audio.activate(); await settled(); advance(8000);
  const before = audio.music[0].currentTime;
  for (let i = 0; i < 40; i++) audio.configure(fresh().settings);
  assert.equal(audio.music[0].currentTime, before);
  assert.equal(audio.music[0].plays, 1);
  assert.ok(audio.music[1].paused);
  audio.setHidden(true); advance(4000);
  assert.equal(audio.music[0].currentTime, before);
  audio.setHidden(false); await settled(); advance(300);
  assert.ok(audio.music[0].currentTime > before);
  assert.ok(audio.music[0].volume > 0 && audio.music[0].volume < 1);
});

test('medal keeps the music fader unchanged, including during settings refresh and crossfade', async t => {
  const { audio, advance } = rig(t);
  audio.configure({ ...fresh().settings, volume: 1, musicVolume: 1 });
  audio.activate(); await settled(); advance(2000);
  const before = audio.music[0].volume;
  audio.result({pass: true, perfect: true}); await settled();
  assert.equal(audio.music[0].volume, before);
  audio.configure({...fresh().settings, musicVolume: 1});
  advance(400);
  assert.ok(audio.music[0].volume >= before);
  audio.music[0].currentTime = 174.5;
  advance(100); await settled(); advance(300);
  assert.ok(audio.music.every(media => !media.paused));
  assert.ok(audio.music.reduce((sum, media) => sum + media.volume, 0) >= before);
  const clicks = audio.effects.click.plays;
  advance(100); audio.click();
  assert.equal(audio.effects.click.plays, clicks, 'clicks do not pile on a reward');
});

test('one output bus serves all media and is reused on gestures and settings changes', async t => {
  let creations = 0, resumes = 0, closes = 0;
  const audio = new GameAudio({
    createAudio: () => ({paused: true, currentTime: 0, volume: 0, addEventListener() {}, play() {this.paused = false;return Promise.resolve();}, pause() {this.paused = true;}}),
    createOutput: media => {creations++; assert.equal(media.length, 5); return {resume() {resumes++;}, close() {closes++;}};},
    every: () => 1, cancel: () => {},
  });
  t.after(() => audio.dispose());
  audio.activate(); await settled();
  for (let i = 0; i < 5; i++) {audio.activate(); audio.configure(fresh().settings);}
  assert.equal(creations, 1);
  assert.ok(resumes > 1);
  audio.dispose();
  assert.equal(closes, 1);
});

test('only confirmation and deployment buttons use a click; browsing and preferences stay quiet', () => {
  for (const name of ['resume', 'deploy', 'run', 'confirm-reset', 'continue', 'ack-briefing']) assert.ok(clickActions.has(name));
  for (const name of ['settings', 'sound', 'quit', 'close', 'campaign', 'journal', 'undo', 'redo', 'pause', 'next-frame', 'net', 'solid', 'more', 'less']) assert.ok(!clickActions.has(name));
});

test('music crossfades at the end and survives muting during the overlap', async t => {
  const { audio, advance } = rig(t);
  audio.activate(); await settled(); advance(1500);
  audio.music[0].currentTime = 174.5;
  advance(100); await settled(); advance(400);
  assert.ok(audio.music.every(media => !media.paused && media.volume > 0));
  audio.configure({ ...fresh().settings, sound: false });
  const positions = audio.music.map(media => media.currentTime);
  advance(3000);
  assert.deepEqual(audio.music.map(media => media.currentTime), positions);
  audio.configure(fresh().settings); await settled(); advance(1500);
  assert.ok(audio.music[0].paused);
  assert.ok(!audio.music[1].paused);
  assert.equal(audio.music[0].currentTime, 0);
});

test('autoplay rejection is silent and the next gesture retries without queued effects', async t => {
  const { audio, allow, advance } = rig(t, true);
  audio.activate(); await settled(); advance(1000);
  assert.ok(audio.music.every(media => media.paused));
  assert.equal(audio.music[0].plays, 1, 'no retry loop without a gesture');
  allow(); audio.activate(); await settled(); advance(1000);
  assert.ok(!audio.music[0].paused);
  assert.ok(Object.values(audio.effects).every(media => media.plays === 0));
});
