import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

// Render the production bus in Chromium; the optional FFmpeg check measures true peaks.
export async function measureAudioOutput(page, root, fixture) {
  await fs.copyFile(path.join(root, 'src/audio-output.mjs'), path.join(fixture, 'dist/check-audio-output.mjs'));
  const encoded = {};
  for (const [name, file] of Object.entries({music: 'bgm_grid_logic_mix.mp3', click: 'sfx_click.wav', clear: 'sfx_clear.wav', medal: 'sfx_medal.wav'})) {
    encoded[name] = (await fs.readFile(path.join(root, 'assets/audio', file))).toString('base64');
  }
  await page.evaluate(async encoded => {
    const context = new OfflineAudioContext(2, 1, 48000);
    window.__decodedAudio = {};
    for (const [name, base64] of Object.entries(encoded)) {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      window.__decodedAudio[name] = await context.decodeAudioData(bytes.buffer);
    }
  }, encoded);
  const result = {};
  for (const mode of ['previous', 'boosted']) {
    result[mode] = await page.evaluate(async mode => {
      const {createOutputGraph} = await import('./check-audio-output.mjs');
      const decoded = window.__decodedAudio, rate = 48000;
      const context = new OfflineAudioContext(2, Math.ceil(decoded.music.duration * rate), rate);
      const output = createOutputGraph(context).input;
      if (mode === 'previous') output.gain.value = 10 ** (6 / 20);
      const music = context.createBufferSource(), musicGain = context.createGain();
      music.buffer = decoded.music; music.connect(musicGain); musicGain.connect(output); music.start();
      const cues = [[10, 'click'], [20, 'click'], [30, 'click'], [45, 'clear'], [60, 'click'], [90, 'medal'], [110, 'click'], [140, 'click']];
      for (const [time, name] of cues) {
        const source = context.createBufferSource(); source.buffer = decoded[name]; source.connect(output); source.start(time);
        const gain = name === 'clear' ? .3 : 1;
        musicGain.gain.setValueAtTime(gain, time);
        musicGain.gain.setTargetAtTime(1, time + decoded[name].duration, .18);
      }
      const rendered = await context.startRendering();
      const bytes = new Uint8Array(44 + rendered.length * 4), view = new DataView(bytes.buffer);
      const tag = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
      tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
      view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
      tag(36, 'data'); view.setUint32(40, bytes.length - 44, true);
      let peak = 0;
      for (let channel = 0; channel < 2; channel++) {
        const samples = rendered.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) {
          peak = Math.max(peak, Math.abs(samples[i]));
          view.setInt16(44 + i * 4 + channel * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
        }
      }
      window.__mixWav = bytes;
      return {duration: rendered.duration, bytes: bytes.length, samplePeakDb: 20 * Math.log10(peak)};
    }, mode);
    const file = path.join(fixture, `mix-${mode}.wav`), handle = await fs.open(file, 'w');
    try {
      for (let offset = 0; offset < result[mode].bytes; offset += 1024 * 1024) {
        const chunk = await page.evaluate(offset => {
          const bytes = window.__mixWav.subarray(offset, offset + 1024 * 1024);
          let text = '';
          for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
          return btoa(text);
        }, offset);
        await handle.write(Buffer.from(chunk, 'base64'));
      }
    } finally {await handle.close();}
    if (process.env.FFMPEG_PATH) {
      const measured = spawnSync(process.env.FFMPEG_PATH, ['-hide_banner', '-i', file, '-af', 'loudnorm=I=-16:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], {encoding: 'utf8'});
      assert.equal(measured.status, 0, measured.stderr || measured.error?.message);
      const start = measured.stderr.lastIndexOf('{');
      const stats = JSON.parse(measured.stderr.slice(start, measured.stderr.indexOf('}', start) + 1));
      Object.assign(result[mode], {integratedLUFS: Number(stats.input_i), truePeakDBTP: Number(stats.input_tp)});
    }
  }
  await fs.writeFile(path.join(fixture, 'mix-measurement.json'), JSON.stringify(result, null, 2));
  assert.ok(result.boosted.samplePeakDb <= -1, 'production bus retains sample headroom');
  if (process.env.FFMPEG_PATH) {
    result.loudnessIncreaseLU = result.boosted.integratedLUFS - result.previous.integratedLUFS;
    assert.ok(result.loudnessIncreaseLU >= 4, 'maximum mix is at least 4 LU louder than the previous +6 dB bus');
    assert.ok(result.boosted.truePeakDBTP <= -1, 'measured mix stays below -1 dBTP');
  }
  await page.evaluate(() => {delete window.__mixWav; delete window.__decodedAudio;});
  return result;
}
