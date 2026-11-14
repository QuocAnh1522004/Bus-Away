/** Minimal promise-based tween runner (game-time driven, so it pauses with the game). */
export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  outElastic: (t: number) =>
    t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
};

type Job = {
  elapsed: number;
  delay: number;
  duration: number;
  ease: Ease;
  update: (k: number) => void;
  resolve: () => void;
  owner?: object;
};

export class Tweens {
  private jobs: Job[] = [];

  /** Animate k: 0 -> 1 over `duration` seconds. */
  to(duration: number, update: (k: number) => void, opts: { ease?: Ease; delay?: number; owner?: object } = {}) {
    return new Promise<void>((resolve) => {
      this.jobs.push({ elapsed: 0, delay: opts.delay ?? 0, duration: Math.max(1e-4, duration), ease: opts.ease ?? ease.outQuad, update, resolve, owner: opts.owner });
    });
  }

  wait(seconds: number) {
    return this.to(seconds, () => {}, { ease: ease.linear });
  }

  /** Cancel all tweens of `owner` (they resolve immediately without a final update). */
  kill(owner: object) {
    this.jobs = this.jobs.filter((j) => {
      if (j.owner !== owner) return true;
      j.resolve();
      return false;
    });
  }

  update(dt: number) {
    const jobs = this.jobs;
    for (let i = jobs.length - 1; i >= 0; i--) {
      const j = jobs[i];
      if (j.delay > 0) {
        j.delay -= dt;
        if (j.delay > 0) continue;
        dt = -j.delay;
        j.delay = 0;
      }
      j.elapsed += dt;
      const t = Math.min(1, j.elapsed / j.duration);
      j.update(j.ease(t));
      if (t >= 1) {
        jobs.splice(i, 1);
        j.resolve();
      }
    }
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Interpolate angles (radians) along the shortest arc. */
export const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
