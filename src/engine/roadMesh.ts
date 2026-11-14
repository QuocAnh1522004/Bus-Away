import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import type { Path } from './path';

/**
 * Procedural roads for levels that don't use the art's SplineMesh.
 *
 * `turtlePath` lays out a centre line from straights and circular arcs (exact radii, so the snow
 * banks never fold); `buildRoadGeometry` sweeps the art road's own cross-section along any centre
 * line, with the same road-mask UVs, so it shades exactly like the original mesh.
 */

/** A path command: straight `len` metres, or an arc of radius `r` turning `deg` (+ = toward +x when heading +z). */
export type RoadCmd = { len: number } | { r: number; deg: number };

/**
 * Centre line from `start` with heading `a0` (radians in the xz plane, dir = (sin a, cos a): 0 = +z).
 * Returns [x, z] points every ~0.1 m.
 */
export function turtlePath(start: [number, number], a0: number, cmds: RoadCmd[]): number[][] {
  let [x, z] = start;
  let a = a0;
  const pts: number[][] = [[x, z]];
  for (const c of cmds) {
    if ('len' in c) {
      const n = Math.max(1, Math.ceil(c.len / 0.1));
      for (let i = 0; i < n; i++) {
        x += (Math.sin(a) * c.len) / n;
        z += (Math.cos(a) * c.len) / n;
        pts.push([x, z]);
      }
    } else {
      const n = Math.max(2, Math.ceil(Math.abs(c.deg) / 2));
      const da = (c.deg * Math.PI) / 180 / n;
      const chord = 2 * c.r * Math.sin(Math.abs(da) / 2);
      for (let i = 0; i < n; i++) {
        const am = a + da / 2;
        x += Math.sin(am) * chord;
        z += Math.cos(am) * chord;
        a += da;
        pts.push([x, z]);
      }
    }
  }
  return pts;
}

/**
 * The art road's cross-section (measured from SplineMesh): [lateral offset, height, u, v] per
 * profile vertex, outer bank -> curb, for ONE side (mirrored for the other). Strips are consecutive
 * pairs. Road mask: u 0.266 = bank/curb gradient, (0.743, 0.023) = asphalt, u 0.958 = curb shadow.
 */
const SIDE: [number, number, number, number][] = [
  [1.78, 0.318, 0.266, 0.007], // bank top, outer edge
  [1.37, 0.318, 0.266, 0.074], // bank top, inner edge
  [1.33, 0.305, 0.266, 0.084], // bevel
  [1.32, 0.273, 0.266, 0.356], // curb face top
  [1.32, 0.001, 0.266, 0.968], // curb face bottom
];
const SHADOW: [number, number, number, number][] = [
  [1.41, 0.01, 0.958, 0.969], // under the curb
  [1.16, 0.01, 0.958, 0.013], // fades out on the asphalt
];
const ASPHALT_HALF = 1.31;

/** Sweep the road cross-section along `path` (sampled every `step` m; ends extended by `extend`). */
export function buildRoadGeometry(path: Path, step = 0.2, extend = 0.1): BufferGeometry {
  // slices: centre + horizontal normal (left of travel)
  const slices: { c: Vector3; n: Vector3 }[] = [];
  const count = Math.max(2, Math.ceil(path.length / step));
  for (let i = 0; i <= count; i++) {
    const s = (path.length * i) / count;
    const c = path.pointAt(s);
    const t = path.tangentAt(s);
    if (i === 0) c.addScaledVector(t, -extend);
    if (i === count) c.addScaledVector(t, extend);
    slices.push({ c, n: new Vector3(t.z, 0, -t.x).normalize() });
  }

  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const up = new Vector3(0, 1, 0);
  const tmp = new Vector3();

  /** One strip between profile points A and B, facing roughly `face(slice)`. */
  const strip = (A: [number, number, number, number], B: [number, number, number, number], side: number, face: (n: Vector3) => Vector3) => {
    const base = pos.length / 3;
    for (const { c, n } of slices) {
      for (const P of [A, B]) {
        tmp.copy(c).addScaledVector(n, P[0] * side);
        pos.push(tmp.x, P[1], tmp.z);
        uv.push(P[2], P[3]);
      }
    }
    for (let i = 0; i < slices.length - 1; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      // wind so the triangle faces `face` (materials are front-side only)
      const pa = new Vector3().fromArray(pos, a * 3), pb = new Vector3().fromArray(pos, b * 3), pc = new Vector3().fromArray(pos, c * 3);
      const nrm = pb.clone().sub(pa).cross(pc.clone().sub(pa));
      if (nrm.dot(face(slices[i].n)) >= 0) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  };

  for (const side of [1, -1]) {
    // banks + curb face: up, and toward the asphalt
    const face = (n: Vector3) => n.clone().multiplyScalar(-side * 0.6).add(up);
    for (let k = 0; k < SIDE.length - 1; k++) strip(SIDE[k], SIDE[k + 1], side, face);
    strip(SHADOW[0], SHADOW[1], side, () => up);
  }
  strip([ASPHALT_HALF, 0, 0.743, 0.023], [ASPHALT_HALF, 0, 0.743, 0.023].map((v, i) => (i === 0 ? -v : v)) as [number, number, number, number], 1, () => up);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
