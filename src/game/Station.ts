import { Group, Mesh, Vector3, type Camera, type Material, type Object3D } from 'three';
import { Path } from '../engine/path';
import { SIGN_BOARD, signBoardGeometry, signPoleGeometry } from '../engine/procedural';
import { ease, lerpAngle, type Tweens } from '../engine/tween';
import { Counter } from './Counter';
import type { StationDef } from './level';
import type { Models } from './models';
import type { ColorName } from './palette';
import { Passenger, STAND_SCALE } from './Passenger';

const VISIBLE = 7; // stickmen standing in line; the rest wait "inside" the station (sign counter)
const SPACING = 0.6;
const HEAD_OFFSET = 2.2; // road centre -> head of the queue (clear of the snow bank)
const SIGN_OFFSET = 1.85; // road centre -> counter signpost (between the head and the road)

/**
 * A bus stop: spawns passengers and keeps them in a single-file line that leaves the road
 * outward (away from the loop) and then curls along it, like the original game.
 * A sign between the head and the road shows how many passengers are left; passengers walk out of
 * a tunnel at the tail. Only the head boards.
 */
export class Station {
  readonly group = new Group();
  readonly s: number;
  /** Spawn tunnel at the tail of the line (asset `Tunnel__1_`). */
  readonly tunnel: Object3D;
  /** Top of the signpost (camera framing). */
  readonly signTop = new Vector3();
  /** Sign board (frame + screen + counter); turned toward the camera every frame. */
  private readonly board = new Group();
  /** Passengers-left counter, drawn in 3D on the sign's screen. */
  private readonly counter = new Counter(SIGN_BOARD.w - 0.14, SIGN_BOARD.h - 0.14);
  queue: Passenger[] = [];
  private pending: ColorName[];
  /** Centre line of the queue, from the head outward. */
  private readonly line: Path;

  constructor(
    def: StationDef,
    road: Path,
    private readonly models: Models,
    private readonly tweens: Tweens,
    propMaterial: Material,
  ) {
    this.s = def.s;
    this.pending = def.queue.slice();

    // Local frame at the stop: t = travel direction, n = outside of the loop (left of travel).
    const c = road.pointAt(def.s);
    const t = road.tangentAt(def.s);
    const n = new Vector3(t.z, 0, -t.x);
    // Curl the line toward the camera (lower z) and keep the sign on the far side of the head, so the
    // sign never hides the head passenger: -1 = back along the road, +1 = forward along it.
    const bend = def.bend ?? (t.z >= 0 ? -1 : 1);
    const at = (out: number, along: number) => c.clone().addScaledVector(n, out).addScaledVector(t, along);
    this.line = Path.bezier(at(HEAD_OFFSET, 0), at(HEAD_OFFSET + 0.9, 0), at(HEAD_OFFSET + 1.4, 0.7 * bend), at(HEAD_OFFSET + 1.5, 2.6 * bend), 24);

    // Counter signpost between the head of the line and the road.
    const sign = new Mesh(signPoleGeometry(), propMaterial);
    sign.position.copy(at(SIGN_OFFSET, -0.8 * bend));
    this.group.add(sign);
    this.board.add(new Mesh(signBoardGeometry(), propMaterial));
    this.counter.mesh.position.z = 0.08; // just in front of the screen face
    this.board.add(this.counter.mesh);
    this.board.position.copy(sign.position).setY(SIGN_BOARD.y);
    this.group.add(this.board);
    this.signTop.copy(sign.position).setY(SIGN_BOARD.y + SIGN_BOARD.h / 2);

    // Tunnel at the tail: passengers walk out of it into the line.
    this.tunnel = models.prop('Tunnel__1_');
    this.tunnel.position.copy(this.spot(VISIBLE + 0.6));
    this.tunnel.scale.setScalar(0.85);
    this.group.add(this.tunnel);

    while (this.queue.length < VISIBLE && this.pending.length) this.spawn(true);
    this.counter.set(this.remaining);
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
    this.counter.set(this.remaining);
    return p;
  }

  update(dt: number, camera: Camera) {
    for (const p of this.queue) p.update(dt);
    this.counter.update(dt);
    // Billboard the board (yaw + pitch) so the number reads head-on; the pole stays upright.
    this.board.lookAt(camera.position);
    // The tunnel only yaws: its opening (local -Z) turns toward the camera.
    const t = this.tunnel.position;
    this.tunnel.rotation.y = Math.atan2(camera.position.x - t.x, camera.position.z - t.z) + Math.PI;
  }

  /** Every spot the line can occupy, plus the tunnel (for camera framing). */
  spots() {
    return [...Array.from({ length: VISIBLE }, (_, i) => this.spot(i)), this.tunnel.position.clone()];
  }

  /** Queue slot i (0 = head) along the line; extrapolated straight past its end. */
  spot(i: number, out = new Vector3()) {
    const d = i * SPACING;
    const len = this.line.length;
    if (d <= len) return this.line.pointAt(d, out);
    return this.line.pointAt(len, out).addScaledVector(this.line.tangentAt(len), d - len);
  }

  /** Everyone faces the person in front of them; the head faces the road. */
  private headingAt(i: number) {
    const t = this.line.tangentAt(Math.min(i * SPACING, this.line.length));
    return Math.atan2(-t.x, -t.z);
  }

  private spawn(instant: boolean) {
    const color = this.pending.shift()!;
    const p = new Passenger(this.models, color);
    const i = this.queue.length;
    p.root.rotation.y = this.headingAt(i);
    this.queue.push(p);
    this.group.add(p.root);
    if (instant) {
      this.spot(i, p.root.position);
    } else {
      // walk out of the tunnel; advance() (called right after) moves everyone to their spot
      p.root.position.copy(this.tunnel.position);
      p.root.scale.setScalar(STAND_SCALE * 0.6);
      void this.tweens.to(0.25, (k) => p.root.scale.setScalar(STAND_SCALE * (0.6 + 0.4 * k)), { ease: ease.outBack });
    }
  }

  /** Everyone shuffles one spot forward (walk anim while moving). */
  private advance() {
    this.queue.forEach((p, i) => {
      const from = p.root.position.clone();
      const to = this.spot(i);
      const h0 = p.root.rotation.y;
      const h1 = this.headingAt(i);
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
