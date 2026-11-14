/**
 * Procedural sound effects with WebAudio: zero bytes of audio assets.
 * Every cue is a couple of oscillators with short envelopes. The context is created on the first
 * user gesture (autoplay policy) and suspended when the ad is hidden.
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
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
  }

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
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.35, delay: i * 0.11 }));
  }
  lose() {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.25, { type: 'sawtooth', vol: 0.12, delay: i * 0.14 }));
  }
}

export const sfx = new Sfx();
