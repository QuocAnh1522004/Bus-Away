import { Vector3 } from 'three';

/**
 * Arc-length parameterised polyline on the XZ plane. Used for the road loop and for every
 * scripted manoeuvre (leave column, back into a parking slot, exit through the gate).
 */
export class Path {
  readonly points: Vector3[];
  readonly lengths: number[]; // cumulative
  readonly length: number;

  constructor(points: Vector3[]) {
    this.points = points;
    this.lengths = [0];
    for (let i = 1; i < points.length; i++) {
      this.lengths.push(this.lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    }
    this.length = this.lengths[this.lengths.length - 1];
  }

  private seg(s: number) {
    s = Math.min(Math.max(s, 0), this.length);
    let lo = 0;
    let hi = this.lengths.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.lengths[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = this.lengths[hi] - this.lengths[lo] || 1;
    return { i: lo, t: (s - this.lengths[lo]) / span };
  }

  pointAt(s: number, out = new Vector3()) {
    const { i, t } = this.seg(s);
    return out.lerpVectors(this.points[i], this.points[Math.min(i + 1, this.points.length - 1)], t);
  }

  /** Smoothed tangent (averaged over a short window so headings don't snap at polyline corners). */
  tangentAt(s: number, out = new Vector3()) {
    const w = 0.35;
    const a = this.pointAt(Math.max(0, s - w), tmpA);
    const b = this.pointAt(Math.min(this.length, s + w), tmpB);
    return out.subVectors(b, a).setY(0).normalize();
  }

  /** Arc length of the closest point to `p` (coarse; fine for placing props). */
  closestS(p: Vector3) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.points.length; i++) {
      const d = this.points[i].distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = this.lengths[i];
      }
    }
    return best;
  }

  static fromXZ(pts: number[][], y = 0) {
    return new Path(pts.map(([x, z]) => new Vector3(x, y, z)));
  }

  /** Cubic bezier p0 -> p3 sampled to a Path. */
  static bezier(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, samples = 24) {
    const pts: Vector3[] = [];
    for (let k = 0; k <= samples; k++) {
      const t = k / samples;
      const it = 1 - t;
      pts.push(
        new Vector3()
          .addScaledVector(p0, it * it * it)
          .addScaledVector(p1, 3 * it * it * t)
          .addScaledVector(p2, 3 * it * t * t)
          .addScaledVector(p3, t * t * t),
      );
    }
    return new Path(pts);
  }

  /** Concatenate paths (drops the duplicated joint point). */
  static join(...paths: Path[]) {
    const pts: Vector3[] = [];
    for (const p of paths) {
      const start = pts.length && pts[pts.length - 1].distanceTo(p.points[0]) < 1e-3 ? 1 : 0;
      pts.push(...p.points.slice(start));
    }
    return new Path(pts);
  }
}

const tmpA = new Vector3();
const tmpB = new Vector3();
