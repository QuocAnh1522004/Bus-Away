import { Group, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Assets } from '../engine/assets';
import { Path } from '../engine/path';
import { sfx } from '../engine/sfx';
import type { Stage } from '../engine/stage';
import { ease, lerpAngle, Tweens } from '../engine/tween';
import { notifyGameEnd } from '../playable/sdk';
import roadPathData from '../assets/gen/road-path.json';
import { Bus } from './Bus';
import { Confetti } from './Confetti';
import { RoadCounter } from './RoadCounter';
import type { Hud } from './Hud';
import { LEVEL, LOT, type BusDef } from './level';
import { Models } from './models';
import { COLORS } from './palette';
import { SEAT_SCALE, STAND_SCALE, type Passenger } from './Passenger';
import { Station } from './Station';
import { World } from './World';

const GAP = 0.55; // bumper-to-bumper distance in traffic
const BOARD_SPEED = 0.1; // buses crawl at 10% speed while passengers hop on
const BOARD_FROM = 2.0; // m before a station: start slowing down AND boarding
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
  /** Level limits: moves = taps that send a bus out; the timer runs from the first move. */
  private movesLeft = LEVEL.moves;
  private timeLeft = LEVEL.time;
  private timerOn = false;
  private endReason = '';
  private idle = 0;
  private hintBus: Bus | null = null;
  private readonly entry: Vector3;
  private readonly exit: Vector3;
  private readonly raycaster = new Raycaster();
  /** Exiting buses that still hold the gate arm up. */
  private readonly atGate = new Set<Bus>();
  private lotSeq = 0;
  private readonly confetti: Confetti;
  /** ROAD counter: a flat sign on the snow inside the loop (3D, so buses cover it). */
  private readonly roadCounter: RoadCounter;

  constructor(
    private readonly stage: Stage,
    assets: Assets,
    private readonly hud: Hud,
  ) {
    stage.scene.add(this.root);
    this.models = new Models(assets);
    // a level's own road, or the art loop's baked centre line (runs left->right: reverse = clockwise)
    this.road = LEVEL.road ? Path.fromXZ(LEVEL.road) : Path.fromXZ(roadPathData.path.slice().reverse());
    this.world = new World(this.root, this.models, assets, this.road, this.tweens);
    this.confetti = new Confetti(this.root);
    this.roadCounter = new RoadCounter(new Vector3(LEVEL.counter[0], 0, LEVEL.counter[1]), 4.2, LEVEL.capacity);
    this.root.add(this.roadCounter.mesh);
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
    if (import.meta.env.DEV) {
      // ?moves=5&time=20 — try other limits without editing level.ts
      const q = new URLSearchParams(location.search);
      if (q.has('moves')) this.movesLeft = Number(q.get('moves'));
      if (q.has('time')) this.timeLeft = Number(q.get('time'));
    }
    hud.setMoves(this.movesLeft, false);
    hud.setTime(this.timeLeft, false);
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
      endReason: this.endReason,
      movesLeft: this.movesLeft,
      onRoad: this.onRoad,
      heads: this.stations.map((s) => s.head()),
      remaining: this.stations.map((s) => s.remaining),
      tappable: [...this.columns.map((c) => c[0]).filter(Boolean), ...this.slots.filter(Boolean)] as Bus[],
      slotsFree: this.slots.filter((s) => s === null).length,
      buses: this.buses.map((b) => `${b.color}${b.seats}:${b.state}:${b.reserved}` + (b.path ? `[s=${b.s.toFixed(2)}/${b.path.length.toFixed(2)} v=${b.v.toFixed(2)} slow=${b.speedScale}]` : '')),
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
      sfx.roadFull();
      this.hud.warnCapacity();
      this.roadCounter.punch();
      this.hud.toast('No more space on road');
      return;
    }
    if (this.movesLeft <= 0) {
      bus.shake();
      sfx.denied();
      this.hud.toast('No moves left!');
      return;
    }
    // a move = a tap that actually sends a bus (refused taps above are free)
    this.movesLeft--;
    this.hud.setMoves(this.movesLeft, this.movesLeft <= 3);
    this.timerOn = true;
    sfx.tap();
    bus.bounce(0.8);
    bus.flash();
    this.onRoadBuses.push(bus);
    this.syncRoadHud(); // the ROAD counter punches on the change

    const from = bus.root.position.clone();
    let path: Path;
    bus.viaSide = bus.state === 'queued';
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
    bus.afterRoad = false; // may be re-sent while still pulling into its slot
    bus.lotSeq = ++this.lotSeq;
    bus.follow(path, { vmax: LOT_SPEED, through: true, onEnd: () => this.joinRoad(bus) });
    this.updateHint(false);
  }

  // ------------------------------------------------------------------ lifecycle

  private joinRoad(bus: Bus) {
    bus.state = 'road';
    bus.visited.clear();
    bus.boardingAt = null;
    bus.speedScale = 1;
    bus.follow(this.road, { keepSpeed: true, through: true, vmax: ROAD_SPEED, onEnd: () => this.roadEnd(bus) });
  }

  private roadEnd(bus: Bus) {
    this.onRoadBuses.splice(this.onRoadBuses.indexOf(bus), 1);
    this.syncRoadHud();
    bus.lotSeq = ++this.lotSeq;
    bus.afterRoad = true; // the first leg (gate / parking lane) still leads the road queue
    if (bus.full) return this.leaveThroughGate(bus);
    const slot = this.slots.findIndex((s) => s === null);
    if (slot < 0) return this.lose('No free parking slot!', bus);
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
    this.roadCounter?.set(this.onRoad); // punches on every change (it's created after the first sync)
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
    // last passenger of this stop is in: back up to speed right away (the lid closes on the move)
    bus.boarding = false;
    bus.boardingAt = null;
    bus.speedScale = 1;
    this.refreshHint();
    if (bus.full) {
      await bus.closeLid();
      sfx.lid();
      bus.bounce(1);
      this.confetti.burst(bus.root.position.clone().setY(1.0));
    }
  }

  private async jumpIntoSeat(p: Passenger, bus: Bus, seat: number) {
    const from = p.root.position.clone();
    const local = bus.seatLocal(seat);
    // the bus keeps crawling while boarding: aim at where the seat is *now*, every frame
    const to = new Vector3();
    const seatNow = () => {
      bus.body.updateWorldMatrix(true, false);
      return bus.body.localToWorld(to.copy(local));
    };
    seatNow();
    const h0 = p.root.rotation.y;
    p.play('Walk', 0.05);
    this.tweens.kill(p);
    p.moveId++;
    // Ballistic hop: steady horizontal travel + parabolic height, apex well above both ends so the
    // arc still reads from the tilted top-down camera. Shrinks to seat size only while dropping in.
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const apex = Math.max(from.y, to.y) + 1.5 + dist * 0.35;
    await this.tweens.to(
      0.42,
      (k) => {
        seatNow();
        p.root.position.lerpVectors(from, to, k);
        const base = from.y + (to.y - from.y) * k;
        p.root.position.y = base + 4 * k * (1 - k) * (apex - (from.y + to.y) / 2);
        p.root.rotation.y = lerpAngle(h0, bus.root.rotation.y, Math.min(1, k * 2.5));
        p.root.scale.setScalar(STAND_SCALE + (SEAT_SCALE - STAND_SCALE) * k * k);
      },
      { ease: ease.linear },
    );
    bus.body.add(p.root);
    p.root.position.copy(local);
    p.root.rotation.set(0, 0, 0);
    p.root.scale.setScalar(SEAT_SCALE);
    p.play('Sit', 0.05);
    bus.passengers.push(p);
    bus.punch();
    void this.tweens.wait(0.2).then(() => {
      p.update(0.2);
      p.frozen = true;
    });
  }

  // ------------------------------------------------------------------ frame

  update(dt: number) {
    this.tweens.update(dt);
    this.confetti.update(dt);
    this.roadCounter.update(dt);
    this.updateLimits(dt);
    this.planLot();
    this.updateTraffic(dt);
    for (const b of this.buses) {
      // (toRoad / road buses move in updateTraffic)
      if (b.path && (b.state === 'queued' || b.state === 'toSlot' || b.state === 'exiting')) b.move(dt, this.lotLimit(b));
      b.updateJuice(dt);
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
      const limit = b.state === 'road' ? Math.min(limitU, this.exitHold(b)) : Math.min(limitU + b.path!.length, this.lotLimit(b), this.exitZoneLimit(b));

      if (b.state === 'road') {
        // Station decisions a little before arrival (enough to brake smoothly). No full stop: the
        // bus eases down to a crawl and passengers start hopping on right away, on the move.
        this.stations.forEach((st, i) => {
          if (b.visited.has(i)) return;
          const d = st.s - b.s;
          if (d < BOARD_FROM) {
            b.visited.add(i);
            if (d > -0.2 && this.canBoard(b, st)) {
              b.boardingAt = st;
              b.speedScale = BOARD_SPEED;
            }
          }
        });
      }
      b.move(dt, limit);
      const st = b.boardingAt;
      // start as soon as it slows; a second bus queued behind one still boarding here waits its turn
      if (b.state === 'road' && st && !b.boarding && !this.buses.some((o) => o !== b && o.boarding && o.boardingAt === st)) {
        if (this.canBoard(b, st)) void this.board(b, st);
        else {
          b.boardingAt = null; // the queue head changed colour meanwhile: drive on
          b.speedScale = 1;
        }
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

  /**
   * Exit zone: where the side lane (column buses heading up to the top lane) passes the road exit.
   * Buses leaving the road and side-lane buses take turns through it:
   *  - a side-lane bus doesn't enter while a bus is about to leave the road or is still in the zone;
   *  - a bus about to leave the road holds at the exit while a side-lane bus is in the zone.
   */
  private inExitZone(f: Footprint) {
    const cx = this.exit.x + 0.9, cz = -0.2;
    return f.some(([x, z]) => Math.hypot(x - cx, z - cz) < EXIT_ZONE_R);
  }

  private exitBusy() {
    return this.buses.some(
      (o) => (o.state === 'road' && o.s > this.road.length - EXIT_WARN) || (o.afterRoad && !!o.path && this.inExitZone(this.lotPlan.get(o)?.cur ?? [])),
    );
  }

  /** Side-lane (toRoad) bus: stop short of the exit zone while the exit is busy. */
  private exitZoneLimit(b: Bus) {
    const me = this.lotPlan.get(b);
    if (!me || !b.viaSide || this.inExitZone(me.cur) || !this.exitBusy()) return Infinity; // already in: drive on through
    for (const [s, f] of me.near) if (this.inExitZone(f)) return Math.max(b.s, s - 0.3);
    return Infinity;
  }

  /** Road bus about to leave the road: hold at the exit while a side-lane bus is in the zone. */
  private exitHold(b: Bus) {
    if (b.s < this.road.length - EXIT_WARN) return Infinity;
    for (const [o, p] of this.lotPlan) if (o.state === 'toRoad' && o.viaSide && this.inExitZone(p.cur)) return this.road.length - 0.3;
    return Infinity;
  }

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
   *  (1) any lot bus where it is now: never drive into someone. If two buses nose into each other
   *      (a merge), the one further into it (more free road ahead of it) goes, the other waits;
   *      a tie goes to the higher priority;
   *  (2) where a higher-priority bus (lower lotSeq: started moving earlier) is about to drive, unless
   *      `b` is already in that bus's way (then it keeps going to get out of it).
   */
  private lotLimit(b: Bus) {
    const me = this.lotPlan.get(b);
    if (!me) return Infinity;
    let limit = Infinity;
    /** Distance `x` can drive (along its braking stretch) before touching body `body`. */
    const free = (x: Bus, near: [number, Footprint][], body: Footprint) => {
      for (const [s, f] of near) if (clearance(f, body) < LOT_CLEAR) return s - x.s;
      return Infinity;
    };
    for (const [o, them] of this.lotPlan) {
      if (o === b || clearance(me.cur, them.cur) < LOT_OVERLAP) continue; // already overlapping: let it clear
      const first = o.lotSeq > b.lotSeq;
      // give way only to a bus that is actually moving (a waiting one can't take its turn: that only
      // builds wait cycles); buses leaving the road don't give way to side-lane buses (exit zone)
      const yieldTo = !first && o.v > 0.3 && !(b.afterRoad && o.viaSide) && !them.ahead.some((f) => clearance(me.cur, f) < LOT_CLEAR);
      const dMe = free(b, me.near, them.cur);
      const dThem = free(o, them.near, me.cur);
      // nosing into each other: off-the-road beats side lane (as in the exit zone), else the one
      // further in goes, a tie goes to the earlier bus
      const iGo = b.afterRoad && o.viaSide ? true : o.afterRoad && b.viaSide ? false : dThem < dMe || (dThem === dMe && first);
      const hard = dMe < Infinity && !(dThem < Infinity && iGo);
      for (const [s, f] of me.near) {
        if (s - 0.9 >= limit) break;
        if ((hard && s - b.s >= dMe) || (yieldTo && them.ahead.some((g) => clearance(f, g) < LOT_CLEAR))) {
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

  private lose(reason: string, bus?: Bus) {
    if (this.ended) return;
    this.ended = true;
    if (bus) {
      bus.state = 'gone';
      bus.path = null;
      bus.shake();
    }
    this.endReason = reason;
    this.updateHint(false);
    sfx.lose();
    this.hud.toast(reason, 3);
    notifyGameEnd();
    setTimeout(() => this.hud.showEnd(false), 900);
  }

  /**
   * Timer and moves. Time's up -> lost at once. Out of moves -> the last moves still play out (they
   * may finish the level); once nothing is driving any more and the level isn't won, it's lost.
   */
  private updateLimits(dt: number) {
    if (this.ended) return;
    if (this.timerOn) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      this.hud.setTime(this.timeLeft, this.timeLeft <= 10);
      if (this.timeLeft <= 0) return this.lose("Time's up!");
    }
    if (this.movesLeft <= 0) {
      const settled = this.buses.every((b) => b.state === 'gone' || b.state === 'parked' || (b.state === 'queued' && !b.path));
      if (settled && this.buses.some((b) => b.state !== 'gone')) this.lose('Out of moves!');
    }
  }

  // ------------------------------------------------------------------ hints

  /** Board state changed: if the hand is showing, retarget it. */
  private refreshHint() {
    if (this.hintBus) this.updateHint(true);
  }

  /** Hand pointer on a sensible next move (front bus whose colour is wanted at a station). */
  private updateHint(show: boolean) {
    if (!show || this.ended || this.onRoad >= LEVEL.capacity || this.movesLeft <= 0) {
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
const EXIT_WARN = 6; // m before the road end: a bus this close "owns" the exit zone
const EXIT_ZONE_R = 1.9;
const LOT_OVERLAP = 0.85; // closer than this the bodies already overlap: don't freeze, let them separate
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
