import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Optional authoring tool. Players only need the generated audio files.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const directory = path.join(root, 'assets/audio');
const render = (input, output, filter, codec) => execFileSync(ffmpeg, [
  '-v', 'error', '-y', '-i', path.join(directory, input), '-af', filter,
  '-ar', '48000', ...codec, path.join(directory, output),
], {stdio: 'inherit'});

render('sfx_click.mp3', 'sfx_click.wav', 'atrim=start=0.175:end=0.295,asetpts=PTS-STARTPTS,pan=stereo|c0=c1|c1=c1,afade=t=in:d=0.001,afade=t=out:st=0.008:d=0.112:curve=exp,volume=11.15dB', ['-c:a', 'pcm_s24le']);
render('sfx_clear.mp3', 'sfx_clear.wav', 'loudnorm=I=-18:TP=-3:LRA=5', ['-c:a', 'pcm_s24le']);
render('sfx_medal.mp3', 'sfx_medal.wav', 'loudnorm=I=-16:TP=-3:LRA=5', ['-c:a', 'pcm_s24le']);
render('bgm_grid_logic.mp3', 'bgm_grid_logic_mix.mp3', 'loudnorm=I=-20.7:TP=-6:LRA=5', ['-c:a', 'libmp3lame', '-b:a', '192k']);
console.log('Rendered playback assets; remeasure loudness/true peaks before accepting replacement sources.');
