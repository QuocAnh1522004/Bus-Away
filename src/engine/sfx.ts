/**
 * Procedural sound effects + background music with WebAudio: zero bytes of audio assets.
 * Every cue is a couple of oscillators with short envelopes. The context is created on the first
 * user gesture (autoplay policy) and suspended when the ad is hidden.
 */

// ---- Background music: an original, bright 8-bar marimba-pop loop (116 BPM, C major, I-vi-IV-V).
const BPM = 116;
const EIGHTH = 60 / BPM / 2;
const _ = 0; // rest
/** Lead melody, one MIDI note per eighth (8 per bar). */
const MELODY = [
  76, _, 79, _, 81, 79, 76, _,   72, _, 76, _, 74, 72, 69, _,
  69, 72, 77, _, 76, _, 72, _,   74, _, 67, _, 71, 74, _, _,
  76, 79, 84, _, 83, 79, 76, _,  81, _, 79, 76, _, 72, 76, _,
  77, _, 76, _, 74, _, 72, 69,   71, _, 74, _, 79, _, _, _,
];
const ROOTS = [48, 45, 41, 43]; // C, Am, F, G (bass octave)
const CHORDS = [[60, 64, 67], [57, 60, 64], [57, 60, 65], [59, 62, 67]];
const BASS = [1, 0, 0, 1, 2, 0, 1, 0]; // per eighth: 1 = root, 2 = fifth
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private musicTimer = 0;
  private musicStep = 0;
  private musicNext = 0;
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
    const n = (this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.25, this.ctx.sampleRate));
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.startMusic();
  }

  // ------------------------------------------------------------------ music

  /** Start (or restart) the loop from bar 1. Called on unlock and again after a retry. */
  startMusic() {
    const ctx = this.ctx;
    if (!ctx || !this.music || this.musicTimer) return;
    this.music.gain.cancelScheduledValues(ctx.currentTime);
    this.music.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.music.gain.exponentialRampToValueAtTime(0.55, ctx.currentTime + 0.4);
    this.musicStep = 0;
    this.musicNext = ctx.currentTime + 0.05;
    // Look-ahead scheduler: timers are jittery, AudioContext time is not. While the context is
    // suspended its clock stops, so nothing piles up when the ad is hidden.
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 50);
    this.scheduleMusic();
  }

  /** Fade the loop out (end card), so the win / lose jingle plays on its own. */
  stopMusic(fade = 0.5) {
    const ctx = this.ctx;
    window.clearInterval(this.musicTimer);
    this.musicTimer = 0;
    if (!ctx || !this.music) return;
    const g = this.music.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(Math.max(0.0001, g.value), ctx.currentTime);
    g.exponentialRampToValueAtTime(0.0001, ctx.currentTime + fade);
  }

  private scheduleMusic() {
    const ctx = this.ctx!;
    while (this.musicNext < ctx.currentTime + 0.25) {
      if (!this.muted) this.musicStep8(this.musicStep, this.musicNext);
      this.musicStep = (this.musicStep + 1) % MELODY.length;
      this.musicNext += EIGHTH;
    }
  }

  /** Everything that sounds on one eighth note. */
  private musicStep8(step: number, t: number) {
    const bar = (step >> 3) % 4;
    const e = step & 7;
    const out = this.music!;
    // lead: marimba = sine + a fast-decaying 4th harmonic
    const m = MELODY[step];
    if (m) {
      this.voice(midi(m), t, 0.38, 0.2, 'sine', out);
      this.voice(midi(m) * 4, t, 0.05, 0.04, 'sine', out);
    }
    // bass: bouncy root / fifth
    if (BASS[e]) this.voice(midi(ROOTS[bar] + (BASS[e] === 2 ? 7 : 0)), t, 0.22, 0.3, 'triangle', out);
    // off-beat chord plucks
    if (e & 1) for (const c of CHORDS[bar]) this.voice(midi(c), t, 0.1, 0.045, 'triangle', out);
    // drums: kick on 1 & 3, snare on 2 & 4, hats on the off-beats
    if (e === 0 || e === 4) this.voice(110, t, 0.16, 0.45, 'sine', out, 0.35);
    if (e === 2 || e === 6) this.hit(t, 0.12, 0.09, 'bandpass', 1800);
    if (e & 1) this.hit(t, 0.04, 0.05, 'highpass', 7000);
  }

  private voice(freq: number, t: number, dur: number, vol: number, type: OscillatorType, out: AudioNode, slide = 0) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hit(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.music!);
    src.start(t);
    src.stop(t + dur + 0.02);
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
