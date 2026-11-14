import { Group, Vector3, type Object3D } from 'three';
import type { Path } from '../engine/path';
import { ease, lerpAngle, type Tweens } from '../engine/tween';
import type { StationDef } from './level';
import type { Models } from './models';
import type { ColorName } from './palette';
import { Passenger, STAND_SCALE } from './Passenger';

const VISIBLE = 8; // stickmen standing in line; the rest wait "inside" the station (sign counter)
const SPACING = 0.72;
const SIDE_OFFSET = 1.72; // from road centre to the queue line (outside of the loop)

/**
 * A bus stop: spawns passengers and keeps them in a single-file queue along the roadside.
 * Only the head of the queue can board.
 */
export class Station {
  readonly group = new Group();
  readonly s: number;
  readonly sign: Object3D;
  /** World point the counter label floats above. */
  readonly labelAnchor = new Vector3();
  queue: Passenger[] = [];
  private pending: ColorName[];
  onCountChange: () => void = () => {};

  constructor(
    def: StationDef,
    private readonly road: Path,
    private readonly models: Models,
    private readonly tweens: Tweens,
  ) {
    this.s = def.s;
    this.pending = def.queue.slice();
    this.sign = models.prop('Tunnel__1_');
    const signPos = this.spot(-1.15);
    this.sign.position.copy(signPos);
    this.sign.rotation.y = this.headingAt(this.s) + Math.PI;
    this.group.add(this.sign);
    this.labelAnchor.copy(signPos).setY(2.25);
    while (this.queue.length < VISIBLE && this.pending.length) this.spawn(true);
  }

  get remaining() {
    return this.queue.length + this.pending.length;
  }

  head(): ColorName | null {
    return this.queue[0]?.color ?? null;
  }

  /** Remove the head passenger (the caller animates it onto the bus). */
  takeHead(): Passenger | undefined {
    const p = this.queue.shift();
    if (!p) return undefined;
    if (this.pending.length) this.spawn(false);
    this.advance();
    this.onCountChange();
    return p;
  }

  update(dt: number) {
    for (const p of this.queue) p.update(dt);
  }

  /** Queue slot i (0 = head) position: back along the road, offset to the outside. */
  spot(i: number, out = new Vector3()) {
    const s = this.s - 0.15 - i * SPACING;
    const p = this.road.pointAt(s, out);
    const t = this.road.tangentAt(s);
    // left of travel direction = outside of the clockwise loop
    return p.set(p.x + t.z * SIDE_OFFSET, 0, p.z - t.x * SIDE_OFFSET);
  }

  private headingAt(s: number) {
    const t = this.road.tangentAt(s);
    return Math.atan2(t.x, t.z);
  }

  private spawn(instant: boolean) {
    const color = this.pending.shift()!;
    const p = new Passenger(this.models, color);
    const i = this.queue.length;
    this.spot(i, p.root.position);
    p.root.rotation.y = this.headingAt(this.s - i * SPACING);
    this.queue.push(p);
    this.group.add(p.root);
    if (!instant) {
      // pop in at the tail
      p.root.scale.setScalar(0.01);
      void this.tweens.to(0.3, (k) => p.root.scale.setScalar(STAND_SCALE * Math.max(0.01, k)), { ease: ease.outBack, delay: 0.15 });
    }
  }

  /** Everyone shuffles one spot forward (walk anim while moving). */
  private advance() {
    this.queue.forEach((p, i) => {
      const from = p.root.position.clone();
      const to = this.spot(i);
      const h0 = p.root.rotation.y;
      const h1 = this.headingAt(this.s - i * SPACING);
      p.play('Walk', 0.08);
      this.tweens.kill(p);
      const id = ++p.moveId;
      void this.tweens
        .to(
          0.22,
          (k) => {
            p.root.position.lerpVectors(from, to, k);
            p.root.rotation.y = lerpAngle(h0, h1, k);
          },
          { ease: ease.linear, delay: i * 0.012, owner: p },
        )
        .then(() => {
          if (p.moveId === id && this.queue.includes(p)) p.play('Idle', 0.15);
        });
    });
  }
}
