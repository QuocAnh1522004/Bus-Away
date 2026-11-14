import { Color, DoubleSide, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry, Quaternion, Vector3 } from 'three';

/**
 * 3D confetti burst, modelled on the Unity "ConfettiExplosionMix" particle systems (Confetti FX):
 *  - one burst from a point, in a cone pointing up;
 *  - fast launch, then speed is clamped hard (Limit Velocity, dampen 0.08 / frame) to a slow drift;
 *  - weak gravity (x0.1), bounce 0.2 off the ground;
 *  - each piece tumbles on all 3 axes (1.6..7.3 rad/s), size pops in over the first 12% of its life
 *    and shrinks out over the last 15%;
 *  - green / cyan / yellow / magenta / orange / white (the prefab's materials).
 * Lifetimes are capped so a burst is over in ~2 s. All bursts share one pooled InstancedMesh
 * (a single draw call); the per-piece tint follows its tilt, so pieces flicker as they tumble.
 */
const MAX = 270;
const PER_BURST = 90;
const COLORS = [0x00ff00, 0x00dfff, 0xffff00, 0xff00ff, 0xff7400, 0xffffff].map((c) => new Color(c));
const CONE = (40 * Math.PI) / 180; // prefab: 15 deg; wider reads better from the top-down camera
const SPEED: [number, number] = [6, 13]; // m/s at launch
const LIMIT = 0.9; // drift speed after the clamp
const DAMPEN = 0.08; // fraction of the excess speed removed per 60 Hz frame
const GRAVITY = 0.98; // 0.1 g
const LIFE: [number, number] = [1.3, 2.0];
const SIZE: [number, number] = [0.32, 0.48]; // piece length (m); prefab 0.2-0.3 at x2 scale
const SPIN: [number, number] = [1.57, 7.33]; // rad/s per axis

const rnd = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);

type Piece = {
  pos: Vector3;
  vel: Vector3;
  rot: Quaternion;
  spin: Vector3;
  size: number;
  age: number;
  life: number;
  color: Color;
};

const tmpObj = new Object3D();
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpC = new Color();
const NORMAL = new Vector3(0, 0, 1);

export class Confetti {
  readonly mesh: InstancedMesh;
  private readonly pieces: (Piece | null)[] = Array(MAX).fill(null);
  private next = 0;
  private live = 0;

  constructor(parent: Object3D) {
    const geo = new PlaneGeometry(1, 0.55);
    const mat = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false });
    this.mesh = new InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false; // pieces fly around; bounds would go stale
    tmpObj.scale.setScalar(0);
    tmpObj.updateMatrix();
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, tmpObj.matrix);
      this.mesh.setColorAt(i, COLORS[0]);
    }
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  burst(at: Vector3, count = PER_BURST) {
    for (let n = 0; n < count; n++) {
      // direction inside an upward cone (uniform over the cap)
      const a = Math.random() * Math.PI * 2;
      const cosT = 1 - Math.random() * (1 - Math.cos(CONE));
      const sinT = Math.sqrt(1 - cosT * cosT);
      const dir = new Vector3(Math.cos(a) * sinT, cosT, Math.sin(a) * sinT);
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      if (!this.pieces[i]) this.live++;
      const sign = () => (Math.random() < 0.5 ? -1 : 1);
      this.pieces[i] = {
        pos: at.clone(),
        vel: dir.multiplyScalar(rnd(SPEED)),
        rot: new Quaternion().setFromAxisAngle(new Vector3().randomDirection(), Math.random() * Math.PI * 2),
        spin: new Vector3(rnd(SPIN) * sign(), rnd(SPIN) * sign(), rnd(SPIN) * sign()),
        size: rnd(SIZE),
        age: 0,
        life: rnd(LIFE),
        color: COLORS[(Math.random() * COLORS.length) | 0],
      };
    }
    this.mesh.visible = true;
  }

  update(dt: number) {
    if (!this.live) return;
    const keep = Math.pow(1 - DAMPEN, dt * 60);
    for (let i = 0; i < MAX; i++) {
      const p = this.pieces[i];
      if (!p) continue;
      p.age += dt;
      if (p.age >= p.life) {
        this.pieces[i] = null;
        this.live--;
        tmpObj.scale.setScalar(0);
        tmpObj.updateMatrix();
        this.mesh.setMatrixAt(i, tmpObj.matrix);
        continue;
      }
      // gravity, then Limit Velocity: bleed off the speed above LIMIT
      p.vel.y -= GRAVITY * dt;
      const sp = p.vel.length();
      if (sp > LIMIT) p.vel.multiplyScalar((LIMIT + (sp - LIMIT) * keep) / sp);
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.03) {
        p.pos.y = 0.03;
        p.vel.y = Math.abs(p.vel.y) * 0.2;
        p.vel.x *= 0.8;
        p.vel.z *= 0.8;
      }
      // tumble
      tmpQ.setFromAxisAngle(tmpV.copy(p.spin).normalize(), p.spin.length() * dt);
      p.rot.premultiply(tmpQ);
      // size over lifetime: 0 -> 1 (12%) ... 1 -> 0 (last 15%)
      const t = p.age / p.life;
      const k = t < 0.12 ? t / 0.12 : t > 0.85 ? (1 - t) / 0.15 : 1;
      tmpObj.position.copy(p.pos);
      tmpObj.quaternion.copy(p.rot);
      tmpObj.scale.setScalar(p.size * k);
      tmpObj.updateMatrix();
      this.mesh.setMatrixAt(i, tmpObj.matrix);
      // cheap "lit" look: brighter when the piece faces up
      const facing = Math.abs(tmpV.copy(NORMAL).applyQuaternion(p.rot).y);
      this.mesh.setColorAt(i, tmpC.copy(p.color).multiplyScalar(0.55 + 0.45 * facing));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (!this.live) this.mesh.visible = false;
  }
}
