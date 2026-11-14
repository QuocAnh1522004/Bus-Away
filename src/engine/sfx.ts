import bgmUrl from '../assets/gen/bgm.mp3?url';
import woodBreakUrl from '../assets/gen/wood_break.mp3?url';

/**
 * Procedural sound effects with WebAudio (zero bytes) + an MP3 background-music loop.
 * Every cue is a couple of oscillators with short envelopes. The context is created on the first
 * user gesture (autoplay policy) and suspended when the ad is hidden.
 */

// Background music: art-src/audio/bgm.mp3, trimmed + re-encoded to src/assets/gen/bgm.mp3 (see README).
// Fetched at boot (a data URI in the build) so the bytes are ready by the first tap.
const bgmBytes: Promise<ArrayBuffer | null> = fetch(bgmUrl)
  .then((r) => r.arrayBuffer())
  .catch(() => null);
const BGM_VOLUME = 0.6; // relative to the SFX master

// Sampled one-shots (art-src/audio/*.wav, trimmed -> src/assets/gen/*.mp3), fetched at boot too.
const fetchBytes = (url: string): Promise<ArrayBuffer | null> =>
  fetch(url)
    .then((r) => r.arrayBuffer())
    .catch(() => null);
const SAMPLES = { woodBreak: fetchBytes(woodBreakUrl) };

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private bgm: Promise<AudioBuffer | null> | null = null;
  private bgmSrc: AudioBufferSourceNode | null = null;
  private musicOn = false;
  private samples: Partial<Record<keyof typeof SAMPLES, Promise<AudioBuffer | null>>> = {};
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    this.music = this.ctx.createGain();
    this.music.connect(this.master);
    this.music.gain.value = 0.0001;
    const ctx = this.ctx;
    // callback form: older Safari has no promise-returning decodeAudioData
    const decode = (bytes: ArrayBuffer | null) =>
      bytes ? new Promise<AudioBuffer | null>((res) => ctx.decodeAudioData(bytes, res, () => res(null))) : null;
    this.bgm = bgmBytes.then(decode);
    for (const k of Object.keys(SAMPLES) as (keyof typeof SAMPLES)[]) this.samples[k] = SAMPLES[k].then(decode);
    this.startMusic();
  }

  // ------------------------------------------------------------------ music

  /** Start (or restart) the loop from the top. Called on unlock. */
  startMusic() {
    if (!this.bgm || this.musicOn) return;
    this.musicOn = true;
    void this.bgm.then((buf) => {
      const ctx = this.ctx;
      if (!buf || !ctx || !this.music || !this.musicOn || this.bgmSrc) return;
      const src = (this.bgmSrc = ctx.createBufferSource());
      src.buffer = buf;
      src.loop = true;
      // MP3 decoders pad a few ms of silence at both ends; loop only the audible part.
      const [from, to] = audibleRange(buf);
      src.loopStart = from;
      src.loopEnd = to;
      src.connect(this.music);
      const t = ctx.currentTime;
      const g = this.music.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.0001, t);
      g.exponentialRampToValueAtTime(BGM_VOLUME, t + 0.4);
      src.start(t, from);
    });
  }

  /** Fade the loop out (end card), so the win / lose jingle plays on its own. */
  stopMusic(fade = 0.5) {
    this.musicOn = false;
    const ctx = this.ctx;
    const src = this.bgmSrc;
    this.bgmSrc = null;
    if (!ctx || !this.music || !src) return;
    const g = this.music.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.exponentialRampToValueAtTime(0.0001, t + fade);
    src.stop(t + fade + 0.05);
  }

  // ------------------------------------------------------------------ sfx

  setPaused(paused: boolean) {
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; slide?: number; delay?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.5, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  tap() {
    this.tone(520, 0.09, { type: 'triangle', slide: 1.6, vol: 0.45 });
  }
  /** Play a sampled one-shot. */
  private sample(name: keyof typeof SAMPLES, vol = 1) {
    const ctx = this.ctx;
    const p = this.samples[name];
    if (!ctx || !this.master || !p || this.muted) return;
    void p.then((buf) => {
      if (!buf || !this.master) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(this.master);
      src.start();
    });
  }

  /** Bus refused because the road is full. */
  roadFull() {
    this.sample('woodBreak', 1.4);
  }

  denied() {
    this.tone(180, 0.12, { type: 'square', vol: 0.18 });
    this.tone(140, 0.14, { type: 'square', vol: 0.18, delay: 0.09 });
  }
  /** Rising pitch as the bus fills up. */
  board(fill: number) {
    this.tone(600 + fill * 500, 0.07, { type: 'sine', slide: 1.25, vol: 0.32 });
  }
  lid() {
    this.tone(260, 0.12, { type: 'triangle', slide: 0.6, vol: 0.5 });
    this.tone(880, 0.12, { type: 'sine', vol: 0.2, delay: 0.08 });
  }
  park() {
    this.tone(330, 0.1, { type: 'triangle', slide: 0.8, vol: 0.3 });
  }
  exit() {
    this.tone(660, 0.1, { type: 'triangle', vol: 0.3 });
    this.tone(990, 0.16, { type: 'triangle', vol: 0.3, delay: 0.08 });
  }
  win() {
    this.stopMusic();
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.35, delay: i * 0.11 }));
  }
  lose() {
    this.stopMusic();
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.25, { type: 'sawtooth', vol: 0.12, delay: i * 0.14 }));
  }
}

export const sfx = new Sfx();

/** [start, end] seconds of the buffer, skipping near-silent padding at both ends. */
function audibleRange(buf: AudioBuffer): [number, number] {
  const d = buf.getChannelData(0);
  const th = 0.002;
  let a = 0;
  let b = d.length - 1;
  while (a < b && Math.abs(d[a]) < th) a++;
  while (b > a && Math.abs(d[b]) < th) b--;
  return [a / buf.sampleRate, (b + 1) / buf.sampleRate];
}
