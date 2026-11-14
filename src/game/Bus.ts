import { Group, Vector3, type Object3D, type ShaderMaterial } from 'three';
import type { Path } from '../engine/path';
import { ease, type Tweens } from '../engine/tween';
import { BUS_LEN, SEATS, SEAT_Y, type BusDef, type Seats } from './level';
import type { Models } from './models';
import { COLORS, type ColorName } from './palette';
import { SEAT_SCALE, type Passenger } from './Passenger';
import type { Station } from './Station';

/** Global bus speed multiplier (every path: lot, road, parking, gate). */
export const SPEED = 2;
// Same motion curve played SPEED x faster: velocity x SPEED, accel / brake x SPEED^2
// (so braking distances, and therefore station stops, are unchanged).
const BRAKE = 16 * SPEED * SPEED;
const ACCEL = 11 * SPEED * SPEED;

export type BusState =
  | 'queued' // waiting in a column
  | 'parked' // in a parking slot
  | 'toRoad' // driving from the lot to the road entry
  | 'road' // on the loop
  | 'toSlot' // backing into a parking slot
  | 'exiting' // through the gate and away
  | 'gone';

const WHEEL_R = 0.218;

export class Bus {
  readonly root = new Group(); // world transform (path follower)
  readonly body = new Group(); // juice: bob / squash / tilt
  readonly color: ColorName;
  readonly seats: Seats;
  readonly halfLen: number;
  readonly material: ShaderMaterial;
  private readonly lid: Object3D;
  private readonly wheels: Object3D[] = [];

  state: BusState = 'queued';
  column = -1;
  slot = -1;

  // ---- motion
  path: Path | null = null;
  s = 0;
  v = 0;
  vmax = 7;
  reverse = false;
  /** Stop target along `path` (null = drive to path end). */
  stopAt: number | null = null;
  /** Station this bus is slowing down for / boarding at (on the road). */
  boardingAt: Station | null = null;
  /** Speed multiplier (eased to with the normal brake / accel), e.g. 0.1 while boarding on the move. */
  speedScale = 1;
  onPathEnd: (() => void) | null = null;
  /** Drive through the path end at speed (the next path continues it) instead of braking to a stop. */
  private through = false;
  /** Lot right-of-way: buses that started their current lot manoeuvre earlier have priority. */
  lotSeq = 0;
  /** On a path that continues the road (road exit -> parking lane / gate): queues behind road traffic. */
  afterRoad = false;
  /** Distance overshot past the end of a `through` path, handed to the next path. */
  private carry = 0;
  private prevV = 0;

  // ---- passengers
  readonly passengers: Passenger[] = [];
  /** Seats promised to passengers already jumping in. */
  reserved = 0;
  /** Stations already handled this lap. */
  readonly visited = new Set<number>();
  boarding = false;
  lidClosed = false;

  constructor(def: BusDef, models: Models, private readonly tweens: Tweens) {
    this.color = def.color;
    this.seats = def.seats;
    this.halfLen = BUS_LEN[def.seats] / 2;
    const model = models.vehicle(def.seats, COLORS[def.color]);
    this.material = model.userData.material as ShaderMaterial;
    const id = model.name;
    this.lid = model.getObjectByName(`${id}__Lid`)!;
    this.lid.visible = false; // open top: passengers visible on their seats
    for (const w of ['Wheel_1', 'Wheel_2']) {
      const o = model.getObjectByName(`${id}__${w}`);
      if (o) this.wheels.push(o);
    }
    this.body.add(model);
    this.root.add(this.body);
  }

  get full() {
    return this.reserved >= this.seats;
  }

  get fill() {
    return this.reserved / this.seats;
  }

  /** Local position of the next free seat. */
  seatLocal(index: number, out = new Vector3()) {
    return out.copy(SEATS[this.seats][index]).setY(SEAT_Y);
  }

  follow(path: Path, opts: { reverse?: boolean; vmax?: number; onEnd?: () => void; keepSpeed?: boolean; through?: boolean } = {}) {
    this.path = path;
    this.s = opts.keepSpeed ? Math.min(this.carry, path.length) : 0;
    this.carry = 0;
    this.through = opts.through ?? false;
    if (!opts.keepSpeed) this.v = 0;
    this.reverse = opts.reverse ?? false;
    this.vmax = opts.vmax ?? 7;
    this.stopAt = null;
    this.onPathEnd = opts.onEnd ?? null;
  }

  /** Distance needed to brake to a stop from the current speed. */
  stopDistance() {
    return (this.v * this.v) / (2 * BRAKE);
  }

  /**
   * Integrate along the path towards min(stopAt, limit, path end) with accel/brake curves.
   * `limit` comes from traffic (bus ahead).
   */
  move(dt: number, limit = Infinity) {
    const path = this.path;
    if (!path) return;
    const end = path.length;
    // Brake toward the stop / car ahead, and toward the path end unless it continues into another path.
    const brakeTo = Math.min(this.stopAt ?? (this.through ? Infinity : end), limit);
    const dist = Math.max(0, brakeTo - this.s);
    const vStop = Math.sqrt(2 * BRAKE * dist);
    const vCap = this.vmax * SPEED * this.speedScale;
    this.prevV = this.v;
    // accelerate toward the cap, ease down to a lowered cap at brake rate, never past the stop curve
    this.v = Math.min(this.v + ACCEL * dt, Math.max(vCap, this.v - BRAKE * dt), vStop);
    const next = Math.min(this.s + this.v * dt, brakeTo);
    this.s = Math.max(this.s, Math.min(next, end)); // never roll backwards
    this.carry = this.through ? Math.max(0, next - end) : 0;
    if (dist < 1e-3) this.v = 0;
    this.place();
    // wheels + body juice
    const spin = ((this.v * dt) / WHEEL_R) * (this.reverse ? -1 : 1);
    for (const w of this.wheels) w.rotation.x += spin;
    const a = (this.v - this.prevV) / Math.max(dt, 1e-4);
    this.body.rotation.x += ((-a * (0.006 / (SPEED * SPEED)) * (this.reverse ? -1 : 1)) - this.body.rotation.x) * Math.min(1, dt * 10);
    if (this.s >= end - 1e-4 && this.onPathEnd) {
      const cb = this.onPathEnd;
      this.onPathEnd = null;
      cb();
      if (this.path && this.path !== path) this.place(); // continued: no one-frame stall at the seam
    }
  }

  place() {
    const path = this.path!;
    path.pointAt(this.s, this.root.position);
    const t = path.tangentAt(this.s, tmp);
    const sign = this.reverse ? -1 : 1;
    this.root.rotation.y = Math.atan2(t.x * sign, t.z * sign);
  }

  /** Little hop + squash used on tap / parking. */
  bounce(amount = 1) {
    void this.tweens.to(
      0.32,
      (k) => {
        const s = Math.sin(k * Math.PI);
        this.body.position.y = s * 0.18 * amount;
        this.body.scale.set(1 + s * 0.06 * amount, 1 - s * 0.08 * amount, 1 + s * 0.06 * amount);
      },
      { ease: ease.linear, owner: this.body },
    );
  }

  /**
   * Elastic punch scale when a passenger lands in a seat. A damped spring rather than a tween, so
   * back-to-back landings (every ~0.09 s) stack into one lively wobble instead of restarting it.
   */
  punch(amount = 1) {
    this.punchV += 4.2 * amount; // ~+12% peak for one kick
  }
  private punchX = 0;
  private punchV = 0;

  /** Per-frame juice that isn't a tween (the punch spring). */
  updateJuice(dt: number) {
    if (this.punchX === 0 && this.punchV === 0) return;
    const w = 36; // rad/s: ~0.17 s per wobble
    const zeta = 0.28;
    for (let i = 0, h = dt / 2; i < 2; i++) {
      this.punchV += (-w * w * this.punchX - 2 * zeta * w * this.punchV) * h;
      this.punchX += this.punchV * h;
    }
    if (Math.abs(this.punchX) < 1e-4 && Math.abs(this.punchV) < 1e-3) {
      this.punchX = this.punchV = 0;
      this.body.scale.set(1, 1, 1);
      return;
    }
    const f = Math.max(-0.25, Math.min(0.3, this.punchX));
    this.body.scale.set(1 + f, 1 + f * 1.25, 1 + f);
  }

  /** Side-to-side shake for an invalid tap. */
  shake() {
    void this.tweens.to(
      0.35,
      (k) => {
        this.body.rotation.z = Math.sin(k * Math.PI * 6) * 0.08 * (1 - k);
      },
      { ease: ease.linear },
    );
  }

  /** White flash (vehicle shader `flash` uniform is per material = per colour, so tween briefly). */
  flash() {
    const u = this.material.uniforms.flash;
    void this.tweens.to(0.25, (k) => (u.value = (1 - k) * 0.55), { ease: ease.outQuad });
  }

  /** "Đóng hòm": drop the lid on with a bounce. */
  async closeLid() {
    this.lidClosed = true;
    // passengers duck into their seats, then the lid drops on
    const seated = this.passengers.map((p) => p.root);
    await this.tweens.to(0.12, (k) => seated.forEach((r) => r.scale.setScalar(SEAT_SCALE * (1 - 0.999 * k))), { ease: ease.inQuad });
    for (const r of seated) r.visible = false; // fewer draw calls for the rest of the ride
    const lid = this.lid;
    lid.visible = true;
    const y0 = lid.position.y;
    await this.tweens.to(
      0.38,
      (k) => {
        lid.position.y = y0 + (1 - k) * 1.4;
        lid.scale.setScalar(1 + (1 - k) * 0.25);
      },
      { ease: ease.outBounce },
    );
    lid.position.y = y0;
  }
}

const tmp = new Vector3();
