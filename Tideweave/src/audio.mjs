import {createBrowserOutput} from './audio-output.mjs';

export const audioFiles = {
  music: 'assets/audio/bgm_grid_logic_mix.mp3',
  click: 'assets/audio/sfx_click.wav',
  clear: 'assets/audio/sfx_clear.wav',
  medal: 'assets/audio/sfx_medal.wav',
};

export const clickActions = new Set(['resume', 'deploy', 'run', 'confirm-reset', 'continue', 'ack-briefing', 'next-chapter']);

const clamp = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const crossfade = 1.6;

// Media elements survive UI renders and work through both file:// and HTTP.
export class GameAudio {
  constructor({ createAudio = src => new Audio(src), createOutput = createBrowserOutput, now = () => performance.now(), every = (callback, delay) => setInterval(callback, delay), cancel = id => clearInterval(id) } = {}) {
    this.now = now;
    this.every = every;
    this.cancel = cancel;
    this.createOutput = createOutput;
    this.output = null;
    this.settings = { sound: true, volume: 1, effectsVolume: 1, music: true, musicVolume: .5 };
    this.pending = new Set();
    this.broken = new Set();
    this.active = false;
    this.hidden = false;
    this.blocked = false;
    this.disposed = false;
    this.timer = null;
    this.primary = 0;
    this.overlap = null;
    this.envelope = 0;
    this.bedGain = 0;
    this.lastClick = -Infinity;
    this.currentEffect = null;
    const make = (src, loop = false) => {
      const media = createAudio(src);
      media.preload = 'auto';
      media.loop = loop;
      media.volume = 0;
      media.addEventListener('error', () => { this.broken.add(media); media.pause(); });
      return media;
    };
    this.music = [make(audioFiles.music, true), make(audioFiles.music, true)];
    this.effects = Object.fromEntries(Object.entries(audioFiles).filter(([name]) => name !== 'music').map(([name, src]) => [name, make(src)]));
  }

  configure(settings) {
    this.settings = {
      sound: settings.sound !== false,
      volume: clamp(settings.volume, 1),
      effectsVolume: clamp(settings.effectsVolume, 1),
      music: settings.music !== false,
      musicVolume: clamp(settings.musicVolume, .5),
    };
    for (const media of Object.values(this.effects)) media.volume = this.effectsGain;
    if (!this.effectsEnabled) this.stopEffects();
    this.limitMusic();
    this.sync();
  }

  activate() {
    this.active = true;
    this.blocked = false;
    this.sync();
    this.output?.resume();
  }

  get enabled() {
    return !this.disposed && this.active && !this.hidden && this.settings.sound && this.settings.volume > 0;
  }

  get masterGain() {
    return Math.sqrt(this.settings.volume);
  }

  get effectsGain() {
    return this.masterGain * this.settings.effectsVolume;
  }

  get effectsEnabled() {
    return this.enabled && this.settings.effectsVolume > 0;
  }

  get musicEnabled() {
    return this.enabled && this.settings.music && this.settings.musicVolume > 0 && !this.blocked;
  }

  get activeEffect() {
    const media = this.effects[this.currentEffect];
    return media && (!media.paused || this.pending.has(media)) ? this.currentEffect : null;
  }

  get musicCeiling() {
    const name = this.activeEffect;
    // Medal celebrations keep the music fader unchanged. The output bus handles peaks.
    return this.masterGain * this.settings.musicVolume * (name === 'clear' ? .3 : 1);
  }

  limitMusic() {
    const ceiling = this.musicCeiling;
    const total = this.music.reduce((sum, media) => sum + media.volume, 0);
    if (total > ceiling) for (const media of this.music) media.volume *= ceiling / total;
    this.bedGain = Math.min(this.bedGain, ceiling);
  }

  play(media) {
    if (this.broken.has(media) || this.pending.has(media) || !media.paused) return;
    this.pending.add(media);
    try {
      Promise.resolve(media.play()).catch(error => {
        if (error.name === 'NotAllowedError') this.blocked = true;
        else if (error.name !== 'AbortError') this.broken.add(media);
      }).finally(() => this.pending.delete(media));
    } catch {
      this.pending.delete(media);
      this.broken.add(media);
    }
  }

  sync() {
    if (this.enabled && !this.output) {
      this.output = this.createOutput([...this.music, ...Object.values(this.effects)]);
      this.output?.resume();
    }
    if (!this.effectsEnabled) this.stopEffects();
    if (!this.musicEnabled || this.broken.has(this.music[this.primary])) {
      for (const media of this.music) { media.pause(); media.volume = 0; }
      if (this.timer !== null) this.cancel(this.timer);
      this.timer = null;
      this.envelope = 0;
      this.bedGain = 0;
      return;
    }
    this.play(this.music[this.primary]);
    if (this.overlap !== null) this.play(this.music[1 - this.primary]);
    if (this.timer === null) {
      this.lastTick = this.now();
      this.timer = this.every(() => this.tick(), 50);
    }
  }

  tick() {
    if (!this.musicEnabled || this.broken.has(this.music[this.primary])) { this.sync(); return; }
    const now = this.now(), dt = Math.max(0, Math.min(100, now - this.lastTick));
    this.lastTick = now;
    this.envelope = Math.min(1, this.envelope + dt / 800);
    const target = this.musicCeiling;
    this.bedGain = Math.min(target, this.bedGain + (target - this.bedGain) * Math.min(1, dt / 180));
    const gain = this.bedGain * this.envelope;
    const current = this.music[this.primary], next = this.music[1 - this.primary];
    // Crossfade the quiet tail into the opening; native looping remains a fallback.
    if (this.overlap === null && Number.isFinite(current.duration) && current.duration > crossfade * 2 && current.duration - current.currentTime <= crossfade && !this.broken.has(next)) {
      next.currentTime = 0;
      next.volume = 0;
      this.overlap = true;
      this.play(next);
    }
    if (this.overlap !== null) {
      if (this.broken.has(next)) {
        next.pause();
        this.overlap = null;
      } else {
        const mix = Math.min(1, next.currentTime / crossfade);
        current.volume = gain * (1 - mix);
        next.volume = gain * mix;
        if (mix >= 1) {
          current.pause();
          current.currentTime = 0;
          this.primary = 1 - this.primary;
          this.overlap = null;
        }
        return;
      }
    }
    current.volume = gain;
    next.volume = 0;
  }

  effect(name) {
    if (!this.effectsEnabled) return;
    const media = this.effects[name];
    if (this.broken.has(media)) return;
    this.stopEffects();
    this.currentEffect = name;
    media.volume = this.effectsGain;
    this.play(media);
    this.limitMusic();
  }

  click() {
    if (!this.effectsEnabled || this.now() - this.lastClick < 85 || ['clear', 'medal'].includes(this.activeEffect)) return;
    this.lastClick = this.now();
    this.effect('click');
  }

  result(result) {
    if (!this.effectsEnabled || !result.pass) return;
    // One reward cue per result, including ordinary passes in tutorial levels.
    this.effect(result.perfect ? 'medal' : 'clear');
  }

  stopEffects() {
    for (const media of Object.values(this.effects)) { media.pause(); media.currentTime = 0; }
    this.currentEffect = null;
  }

  setHidden(hidden) {
    this.hidden = hidden;
    this.sync();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sync();
    this.output?.close();
  }
}
