import { Group, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Assets } from '../engine/assets';
import { Path } from '../engine/path';
import { sfx } from '../engine/sfx';
import type { Stage } from '../engine/stage';
import { ease, lerpAngle, Tweens } from '../engine/tween';
import { notifyGameEnd } from '../playable/sdk';
import roadPathData from '../assets/gen/road-path.json';
import { Bus } from './Bus';
import type { Hud } from './Hud';
import { LEVEL, LOT, type BusDef } from './level';
import { Models } from './models';
import { COLORS } from './palette';
import { SEAT_SCALE, STAND_SCALE, type Passenger } from './Passenger';
import { Station } from './Station';
import { World } from './World';

const GAP = 0.55; // bumper-to-bumper distance in traffic
const ROAD_SPEED = 7;
const LOT_SPEED = 6.5;
const HINT_DELAY = 3.2;

type Waypoint = [Vector3, Vector3]; // position, heading

/**
 * Game rules (from the brief):
 * - Columns of buses; only the FRONT bus of a column (or a parked bus) can be tapped onto the road.
 * - At most CAPACITY buses on the road; when full, taps are refused.
 * - Buses drive the loop clockwise and stop at a station only if (1) not full and (2) the head of
 *   the queue has the bus colour. Passengers board one by one while that stays true.
 * - Full bus: close lid -> through the gate -> leaves (frees a road slot).
 * - Not full at the end of the loop: parks in the first free slot (frees a road slot).
 *   No free slot -> LOSE. All buses gone -> WIN.
 */
export class Game {
  readonly root = new Group();
  readonly tweens = new Tweens();
  private readonly models: Models;
  private readonly world: World;
  private readonly road: Path;
  private readonly stations: Station[] = [];
  private readonly columns: Bus[][] = [];
  private readonly slots: (Bus | null)[] = LEVEL.slots.map(() => null);
  private readonly buses: Bus[] = [];
  /** Buses heading to or driving on the road, in entry order (CAPACITY counts these). */
  private readonly onRoadBuses: Bus[] = [];
  private get onRoad() {
    return this.onRoadBuses.length;
  }
  private ended = false;
  private idle = 0;
  private hintBus: Bus | null = null;
  private readonly entry: Vector3;
  private readonly exit: Vector3;
  private readonly raycaster = new Raycaster();
  /** Exiting buses that still hold the gate arm up. */
  private readonly atGate = new Set<Bus>();
  private lotSeq = 0;

  constructor(
    private readonly stage: Stage,
    assets: Assets,
    private readonly hud: Hud,
  ) {
    stage.scene.add(this.root);
    this.models = new Models(assets);
    // Baked centerline runs left->right on the authoring axis; reverse it = clockwise on screen.
    this.road = Path.fromXZ(roadPathData.path.slice().reverse());
    this.world = new World(this.root, this.models, assets, this.road, this.tweens);
    this.entry = this.road.pointAt(0).clone();
    this.exit = this.road.pointAt(this.road.length).clone();

    for (const def of LEVEL.stations) {
      const st = new Station(def, this.road, this.models, this.tweens, this.world.propMaterial);
      this.root.add(st.group);
      this.stations.push(st);
      if (import.meta.env.DEV) {
        // level-design guard: queue + tunnel must stay off the road (centre -> bank edge ~1.45 m)
        for (const p of st.spots()) {
          let d = Infinity;
          for (const q of this.road.points) d = Math.min(d, Math.hypot(p.x - q.x, p.z - q.z));
          if (d < 1.8) console.warn(`station at s=${def.s}: (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is ${d.toFixed(2)} m from the road centre`);
        }
      }
    }

    LEVEL.columns.forEach((col, c) => {
      const list: Bus[] = [];
      col.buses.forEach((def: BusDef) => {
        const bus = new Bus(def, this.models, this.tweens);
        bus.column = c;
        list.push(bus);
        this.buses.push(bus);
        this.root.add(bus.root);
      });
      this.columns.push(list);
      this.layoutColumn(c, true);
    });

    // Frame the gameplay: road loop (incl. snow banks), station queues + signs, gate, bus columns.
    // On 9:16 this is width-bound by the road itself; on squarer screens it becomes height-bound and
    // the same points still all fit.
    const pts: Vector3[] = [];
    for (let s = 0; s <= this.road.length; s += 0.5) {
      const p = this.road.pointAt(s);
      pts.push(p.clone().setX(p.x - 1.45), p.clone().setX(p.x + 1.45), p.clone().setZ(p.z + 1.45));
    }
    for (const st of this.stations) {
      for (const p of st.spots()) pts.push(p.clone().setX(p.x - 0.35).setY(1.2), p.clone().setX(p.x + 0.35).setY(1.2));
      pts.push(st.signTop.clone().setX(st.signTop.x - 0.8), st.signTop.clone().setX(st.signTop.x + 0.8));
    }
    pts.push(LOT.gate.clone().setX(LOT.gate.x - 0.4));
    // Only the FRONT bus of a column is tappable, so frame the front row plus a peek of the next one;
    // deeper rows may run off the bottom edge (they drive up into view as the columns advance).
    for (const col of this.columns) {
      const front = col[0];
      if (!front) continue;
      const p = front.root.position;
      const z = p.z - front.halfLen - 1.4;
      pts.push(new Vector3(p.x - 1, 0, z), new Vector3(p.x + 1, 0, z));
    }
    // Symmetric about the road/lot centre line (x = 0): the playfield sits in the middle of the
    // screen even though the two stations reach out by different amounts.
    for (const p of [...pts]) pts.push(p.clone().setX(-p.x));
    stage.frame(pts);
    if (import.meta.env.DEV) {
      const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
      (window as unknown as { __fitPts: Vector3[] }).__fitPts = pts;
      (window as unknown as { __fit: string }).__fit = `x ${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)} z ${Math.min(...zs).toFixed(2)}..${Math.max(...zs).toFixed(2)}`;
    }

    this.syncRoadHud();
    hud.showTip('Tap a bus to pick up its colour!');
    this.updateHint(true);
  }

  // ------------------------------------------------------------------ input

  /** Tap at client coords. */
  tap(x: number, y: number) {
    if (this.ended) return;
    sfx.unlock();
    this.idle = 0;
    this.hud.showTip(null);
    const bus = this.pick(x, y);
    if (!bus) return;
    this.tryLaunch(bus);
  }

  private pick(x: number, y: number): Bus | null {
    const ndc = new Vector2((x / this.stage.width) * 2 - 1, -(y / this.stage.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    let best: Bus | null = null;
    let bestD = Infinity;
    // Intersect two horizontal planes (roof height and ground) -> forgiving hit test on footprints.
    for (const h of [0.9, 0.3]) {
      const hit = new Vector3();
      if (!this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -h), hit)) continue;
      for (const b of this.buses) {
        if (b.state !== 'queued' && b.state !== 'parked') continue;
        const local = b.root.worldToLocal(hit.clone());
        if (Math.abs(local.x) < 1.15 && Math.abs(local.z) < b.halfLen + 0.4) {
          const d = local.lengthSq();
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
      }
      if (best) break;
    }
    return best;
  }

  /** Snapshot for tooling (DEV bot / tests). */
  debugState() {
    return {
      ended: this.ended,
      won: this.ended && this.buses.every((b) => b.state === 'gone'),
      onRoad: this.onRoad,
      heads: this.stations.map((s) => s.head()),
      remaining: this.stations.map((s) => s.remaining),
      tappable: [...this.columns.map((c) => c[0]).filter(Boolean), ...this.slots.filter(Boolean)] as Bus[],
      slotsFree: this.slots.filter((s) => s === null).length,
      buses: this.buses.map((b) => `${b.color}${b.seats}:${b.state}:${b.reserved}` + (b.path ? `[s=${b.s.toFixed(2)}/${b.path.length.toFixed(2)} v=${b.v.toFixed(2)} stop=${b.stopAt}]` : '')),
    };
  }

  launch(bus: Bus) {
    this.tryLaunch(bus);
  }

  private tryLaunch(bus: Bus) {
    if (bus.state === 'queued' && this.columns[bus.column][0] !== bus) {
      bus.shake();
      sfx.denied();
      this.hud.toast('Only the front bus can go!');
      return;
    }
    if (this.onRoad >= LEVEL.capacity) {
      bus.shake();
      sfx.denied();
      this.hud.warnCapacity();
      this.hud.toast('The road is full!');
      return;
    }
    sfx.tap();
    bus.bounce(0.8);
    bus.flash();
    this.onRoadBuses.push(bus);
    this.syncRoadHud();

    const from = bus.root.position.clone();
    let path: Path;
    if (bus.state === 'queued') {
      const col = this.columns[bus.column];
      col.shift();
      this.layoutColumn(bus.column, false);
      path = this.pathFromColumn(from);
    } else {
      this.slots[bus.slot] = null;
      bus.slot = -1;
      path = this.pathFromSlot(from);
    }
    bus.state = 'toRoad';
    bus.lotSeq = ++this.lotSeq;
    bus.follow(path, { vmax: LOT_SPEED, through: true, onEnd: () => this.joinRoad(bus) });
    this.updateHint(false);
  }

  // ------------------------------------------------------------------ lifecycle

  private joinRoad(bus: Bus) {
    bus.state = 'road';
    bus.visited.clear();
    bus.follow(this.road, { keepSpeed: true, through: true, vmax: ROAD_SPEED, onEnd: () => this.roadEnd(bus) });
  }

  private roadEnd(bus: Bus) {
    this.onRoadBuses.splice(this.onRoadBuses.indexOf(bus), 1);
    this.syncRoadHud();
    bus.lotSeq = ++this.lotSeq;
    bus.afterRoad = true; // the first leg (gate / parking lane) still leads the road queue
    if (bus.full) return this.leaveThroughGate(bus);
    const slot = this.slots.findIndex((s) => s === null);
    if (slot < 0) return this.lose(bus);
    this.slots[slot] = bus;
    bus.slot = slot;
    bus.state = 'toSlot';
    this.world.pulseSlot(slot);
    const sx = LEVEL.slots[slot];
    const turnAt = new Vector3(sx + 1.9, 0, LOT.laneTop);
    const fwd = this.smoothPath([
      [this.exit, new Vector3(0, 0, -1)],
      [new Vector3(this.exit.x + 1.0, 0, LOT.laneTop), new Vector3(1, 0, 0)],
      [turnAt, new Vector3(1, 0, 0)],
    ]);
    const back = this.smoothPath([
      [turnAt, new Vector3(-1, 0, 0)],
      [new Vector3(sx, 0, LOT.slotZ), new Vector3(0, 0, -1)],
    ]);
    bus.follow(fwd, {
      keepSpeed: true,
      vmax: LOT_SPEED,
      onEnd: () => {
        bus.afterRoad = false;
        bus.follow(back, {
          reverse: true,
          vmax: 4,
          onEnd: () => {
            bus.state = 'parked';
            bus.path = null;
            bus.bounce(0.6);
            sfx.park();
            this.refreshHint();
          },
        });
      },
    });
  }

  private leaveThroughGate(bus: Bus) {
    bus.state = 'exiting';
    this.world.openGate();
    sfx.exit();
    const path = this.smoothPath([
      [this.exit, new Vector3(0, 0, -1)],
      [new Vector3(this.exit.x - 1.2, 0, LOT.laneTop), new Vector3(-1, 0, 0)],
      [LOT.exitFar.clone(), new Vector3(-1, 0, 0)],
    ]);
    this.atGate.add(bus);
    bus.follow(path, {
      keepSpeed: true,
      vmax: 9,
      onEnd: () => {
        bus.state = 'gone';
        bus.afterRoad = false;
        bus.path = null;
        bus.root.visible = false;
        this.checkWin();
      },
    });
  }

  /** ROAD pill: one slot per CAPACITY, filled with the colour of the bus using it. */
  private syncRoadHud() {
    this.hud.setRoad(this.onRoadBuses.map((b) => COLORS[b.color]));
  }

  private canBoard(bus: Bus, st: Station) {
    return !bus.full && !bus.lidClosed && st.head() === bus.color;
  }

  private async board(bus: Bus, st: Station) {
    bus.boarding = true;
    const jumps: Promise<void>[] = [];
    while (this.canBoard(bus, st) && !this.ended) {
      const p = st.takeHead()!;
      const seat = bus.reserved++;
      jumps.push(this.jumpIntoSeat(p, bus, seat));
      sfx.board(bus.fill);
      await this.tweens.wait(0.085);
    }
    await Promise.all(jumps);
    if (bus.full) {
      await bus.closeLid();
      sfx.lid();
      bus.bounce(1);
      await this.tweens.wait(0.08);
    }
    bus.boarding = false;
    bus.stopAt = null;
    this.refreshHint();
  }

  private async jumpIntoSeat(p: Passenger, bus: Bus, seat: number) {
    const from = p.root.position.clone();
    const local = bus.seatLocal(seat);
    bus.body.updateWorldMatrix(true, false);
    const to = bus.body.localToWorld(local.clone());
    const h0 = p.root.rotation.y;
    const h1 = bus.root.rotation.y;
    p.play('Walk', 0.05);
    this.tweens.kill(p);
    p.moveId++;
    await this.tweens.to(
      0.3,
      (k) => {
        p.root.position.lerpVectors(from, to, k);
        p.root.position.y += Math.sin(k * Math.PI) * 1.1;
        p.root.rotation.y = lerpAngle(h0, h1, k);
        p.root.scale.setScalar(STAND_SCALE + (SEAT_SCALE - STAND_SCALE) * k);
      },
      { ease: ease.linear },
    );
    bus.body.add(p.root);
    p.root.position.copy(local);
    p.root.rotation.set(0, 0, 0);
    p.root.scale.setScalar(SEAT_SCALE);
    p.play('Sit', 0.05);
    bus.passengers.push(p);
    bus.bounce(0.25);
    void this.tweens.wait(0.2).then(() => {
      p.update(0.2);
      p.frozen = true;
    });
  }

  // ------------------------------------------------------------------ frame

  update(dt: number) {
    this.tweens.update(dt);
    this.planLot();
    this.updateTraffic(dt);
    for (const b of this.buses) {
      // (toRoad / road buses move in updateTraffic)
      if (b.path && (b.state === 'queued' || b.state === 'toSlot' || b.state === 'exiting')) b.move(dt, this.lotLimit(b));
      for (const p of b.passengers) p.update(dt);
    }
    for (const st of this.stations) st.update(dt, this.stage.camera);
    for (const b of this.atGate) {
      // lower the arm once the bus is clear of it
      if (b.root.position.x < LOT.gate.x - b.halfLen - 0.8) {
        this.atGate.delete(b);
        this.world.closeGate();
      }
    }

    if (!this.ended) {
      this.idle += dt;
      if (this.idle > HINT_DELAY && !this.hintBus) this.updateHint(true);
    }
    this.hud.update(dt, this.stage.camera, this.stage.width, this.stage.height);
  }

  /**
   * Single-lane traffic: everything heading to or on the road is ordered on one virtual axis
   * (u < 0 = still in the lot, distance to the road entry). Each bus may not get closer than
   * GAP to the one in front.
   */
  private updateTraffic(dt: number) {
    const inQueue = (b: Bus) => b.state === 'toRoad' || b.state === 'road' || (b.afterRoad && !!b.path);
    const movers = this.buses.filter(inQueue);
    const u = (b: Bus) => (b.state === 'road' ? b.s : b.afterRoad ? this.road.length + b.s : b.s - b.path!.length);
    movers.sort((a, b) => u(b) - u(a));
    let prev: Bus | null = null;
    let prevRoad: Bus | null = null; // nearest leader already on (or just off) the loop
    for (const b of movers) {
      // Lot buses take their spacing from each other via lot right-of-way (their routes merge in
      // the lot, not on this axis); the axis only queues them behind traffic already on the road.
      const lead = b.state === 'toRoad' ? prevRoad : prev;
      let limitU = Infinity;
      // (a leader that just left the road this frame no longer constrains anyone)
      if (lead && inQueue(lead)) limitU = u(lead) - (lead.halfLen + b.halfLen + GAP);
      prev = b;
      if (b.state !== 'toRoad') prevRoad = b;
      if (b.afterRoad) continue; // moved in update() with lot right-of-way; here it only leads the queue
      const limit = b.state === 'road' ? limitU : Math.min(limitU + b.path!.length, this.lotLimit(b));

      if (b.state === 'road') {
        // Station decisions a little before arrival (enough to brake smoothly).
        this.stations.forEach((st, i) => {
          if (b.visited.has(i)) return;
          const d = st.s - b.s;
          if (d < 2.6) {
            b.visited.add(i);
            if (d > -0.2 && this.canBoard(b, st)) b.stopAt = st.s;
          }
        });
      }
      b.move(dt, limit);
      if (b.state === 'road' && b.stopAt !== null && !b.boarding && Math.abs(b.s - b.stopAt) < 1e-3) {
        const st = this.stations.find((s) => Math.abs(s.s - b.stopAt!) < 1e-3)!;
        if (this.canBoard(b, st)) void this.board(b, st);
        else b.stopAt = null;
      }
    }
  }

  /**
   * Lot right-of-way, recomputed every frame for every bus moving in the lot (not on the road loop):
   *  - `cur`:   where it is now;
   *  - `near`:  the stretch it needs to brake (stop distance + margin);
   *  - `ahead`: where it will be over the next ~half second (what others must keep clear of).
   */
  private lotPlan = new Map<Bus, { cur: Footprint; near: [number, Footprint][]; ahead: Footprint[] }>();

  private planLot() {
    this.lotPlan.clear();
    for (const b of this.buses) {
      const path = b.path;
      if (!path || !(b.state === 'queued' || b.state === 'toRoad' || b.state === 'toSlot' || b.state === 'exiting')) continue;
      const sweep = (len: number) => {
        const out: [number, Footprint][] = [];
        for (let d = 0.3; d <= len; d += 0.3) {
          const s = b.s + d;
          if (s > path.length) break;
          const t = path.tangentAt(s, TMP_T);
          out.push([s, footprint(path.pointAt(s, TMP_P), Math.atan2(t.x, t.z), b.halfLen)]);
        }
        return out;
      };
      const stop = b.stopDistance();
      this.lotPlan.set(b, {
        cur: footprint(b.root.position, b.root.rotation.y, b.halfLen),
        near: sweep(stop + 1.2),
        ahead: sweep(stop + b.v * 0.5 + 1.5).map(([, f]) => f),
      });
    }
  }

  /**
   * How far along its path `b` may drive in the lot. It brakes (to stop ~0.9 m short) when its
   * braking stretch would touch
   *  (1) any lot bus where it is now (never drive into someone; if two buses nose into each other,
   *      the higher-priority one goes), or
   *  (2) where a higher-priority bus (lower lotSeq: started moving earlier) is about to drive, unless
   *      `b` is already in that bus's way (then it keeps going to get out of it).
   * Priorities are a strict order, so two buses never wait on each other.
   */
  private lotLimit(b: Bus) {
    const me = this.lotPlan.get(b);
    if (!me) return Infinity;
    let limit = Infinity;
    for (const [o, them] of this.lotPlan) {
      if (o === b || clearance(me.cur, them.cur) < LOT_CLEAR) continue; // already touching: let it clear
      const first = o.lotSeq > b.lotSeq;
      const yieldTo = !first && !them.ahead.some((f) => clearance(me.cur, f) < LOT_CLEAR);
      // two buses nosing into each other (merge): only the later one waits
      const hard = !(first && them.near.some(([, g]) => clearance(me.cur, g) < LOT_CLEAR));
      for (const [s, f] of me.near) {
        if (s - 0.9 >= limit) break;
        if ((hard && clearance(f, them.cur) < LOT_CLEAR) || (yieldTo && them.ahead.some((g) => clearance(f, g) < LOT_CLEAR))) {
          limit = Math.max(b.s, s - 0.9);
          break;
        }
      }
    }
    return limit;
  }

  // ------------------------------------------------------------------ end states

  private checkWin() {
    if (this.ended || this.buses.some((b) => b.state !== 'gone')) return;
    this.ended = true;
    sfx.win();
    notifyGameEnd();
    setTimeout(() => this.hud.showEnd(true), 500);
  }

  private lose(bus: Bus) {
    if (this.ended) return;
    this.ended = true;
    bus.state = 'gone';
    bus.path = null;
    bus.shake();
    sfx.lose();
    this.hud.toast('No free parking slot!', 3);
    notifyGameEnd();
    setTimeout(() => this.hud.showEnd(false), 900);
  }

  // ------------------------------------------------------------------ hints

  /** Board state changed: if the hand is showing, retarget it. */
  private refreshHint() {
    if (this.hintBus) this.updateHint(true);
  }

  /** Hand pointer on a sensible next move (front bus whose colour is wanted at a station). */
  private updateHint(show: boolean) {
    if (!show || this.ended || this.onRoad >= LEVEL.capacity) {
      this.hintBus = null;
      this.hud.showHand(null);
      return;
    }
    const heads = new Set(this.stations.map((s) => s.head()).filter(Boolean));
    const candidates = [...this.columns.map((c) => c[0]).filter(Boolean), ...this.slots.filter(Boolean)] as Bus[];
    const pick = candidates.find((b) => heads.has(b.color));
    this.hintBus = pick ?? null;
    this.hud.showHand(pick ? pick.root.position.clone().setY(1.0) : null);
  }

  // ------------------------------------------------------------------ layout / paths

  private columnSlotZ(c: number) {
    const zs: number[] = [];
    let edge = LOT.columnFront;
    for (const b of this.columns[c]) {
      zs.push(edge - b.halfLen);
      edge -= b.halfLen * 2 + LOT.columnGap;
    }
    return zs;
  }

  /** Place (or drive) column buses to their queue spots. */
  private layoutColumn(c: number, instant: boolean) {
    const x = LEVEL.columns[c].x;
    const zs = this.columnSlotZ(c);
    this.columns[c].forEach((b, i) => {
      const target = new Vector3(x, 0, zs[i]);
      if (instant) {
        b.root.position.copy(target);
        b.root.rotation.y = 0;
        return;
      }
      const from = b.root.position.clone();
      if (from.distanceTo(target) < 1e-3) return;
      // staggered "shuffle forward", in game time
      void this.tweens.wait(0.06 + i * 0.07).then(() => {
        if (b.state !== 'queued') return;
        b.lotSeq = ++this.lotSeq; // yields to the bus that just pulled out of the column
        b.follow(new Path([b.root.position.clone(), target]), { vmax: 5, onEnd: () => (b.path = null) });
      });
    });
  }

  /**
   * Column -> road entry, around the parking: along the lower lane to screen-right, up the side lane
   * between the slots and the road exit, then along the upper lane to screen-left and into the road.
   */
  private pathFromColumn(from: Vector3) {
    const e = this.entry;
    const side = LOT.sideLane;
    const R = 0.95; // corner radius
    const pts: Waypoint[] = [[from, Z]];
    if (from.x - side < 2.2) {
      // nearest column: one S-curve into the side lane
      pts.push([new Vector3(side, 0, LOT.laneMid + 0.6), Z]);
    } else {
      pts.push([new Vector3(from.x - R, 0, LOT.laneMid), NX]);
      if (from.x - R - (side + R) > 0.3) pts.push([new Vector3(side + R, 0, LOT.laneMid), NX]);
      pts.push([new Vector3(side, 0, LOT.laneMid + R), Z]);
    }
    pts.push([new Vector3(side, 0, LOT.laneTop - R), Z]);
    pts.push([new Vector3(side + R, 0, LOT.laneTop), X]);
    pts.push([new Vector3(e.x - 1.0, 0, LOT.laneTop), X]);
    pts.push([e.clone(), Z]);
    return this.smoothPath(pts);
  }

  private pathFromSlot(from: Vector3) {
    const e = this.entry;
    if (e.x - from.x < 2.2) return this.smoothPath([[from, Z], [e.clone(), Z]]);
    return this.smoothPath([
      [from, Z],
      [new Vector3(from.x + 0.95, 0, LOT.laneTop), X],
      [new Vector3(e.x - 1.0, 0, LOT.laneTop), X],
      [e.clone(), Z],
    ]);
  }

  /** Hermite-style chain of cubic beziers through waypoints with given headings. */
  private smoothPath(wps: Waypoint[]) {
    const parts: Path[] = [];
    for (let i = 0; i < wps.length - 1; i++) {
      const [p0, d0] = wps[i];
      const [p3, d3] = wps[i + 1];
      const len = p0.distanceTo(p3) * 0.45;
      parts.push(Path.bezier(p0, p0.clone().addScaledVector(d0, len), p3.clone().addScaledVector(d3, -len), p3, 20));
    }
    return Path.join(...parts);
  }

  dispose() {
    this.ended = true;
    this.stage.scene.remove(this.root);
    this.hud.showHand(null);
  }
}

const LOT_CLEAR = 1.15; // min distance between two bus centre-lines in the lot (body width + margin)
const TMP_P = new Vector3();
const TMP_T = new Vector3();

type Footprint = (readonly [number, number])[];
/** A bus as 5 points along its centre-line (ends inset by half the body width). */
function footprint(p: Vector3, yaw: number, halfLen: number): Footprint {
  const dx = Math.sin(yaw), dz = Math.cos(yaw), L = halfLen - 0.5;
  return [-1, -0.5, 0, 0.5, 1].map((k) => [p.x + dx * L * k, p.z + dz * L * k] as const);
}
function clearance(a: Footprint, b: Footprint) {
  let m = Infinity;
  for (const p of a) for (const q of b) m = Math.min(m, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return m;
}

const X = new Vector3(1, 0, 0);
const NX = new Vector3(-1, 0, 0);
const Z = new Vector3(0, 0, 1);
