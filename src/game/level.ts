import { Vector3 } from 'three';
import type { ColorName } from './palette';
import roadPath from '../assets/gen/road-path.json';
import { LEVEL1 } from './levels/level1';
import { LEVEL2 } from './levels/level2';

/**
 * Level data + shared lot geometry. All coordinates are world space (metres). Authoring axis note: the camera looks from -Z
 * toward +Z, so SCREEN-RIGHT == WORLD -X. The road loop is the art's spline mesh; its centerline is
 * baked by tools/build-assets.mjs and driven in reverse (= clockwise on screen).
 */
export type Seats = 4 | 6 | 10;
export type BusDef = { color: ColorName; seats: Seats };

export type StationDef = {
  /** Arc length along the clockwise road path where the bus stops. */
  s: number;
  /** Passenger colours, head of the queue first. */
  queue: ColorName[];
  /** Override which way the line curls (-1 back along the road, +1 forward). Default: toward the camera. */
  bend?: number;
};

/** Everything that makes a level (see levels/level1.ts, levels/level2.ts). */
export type LevelDef = {
  /** Max buses on the road at the same time. */
  capacity: number;
  /** Taps that send a bus out. At 0 the level is lost once the road clears without a win. */
  moves: number;
  /** Seconds, counting down from the first tap. At 0 the level is lost. */
  time: number;
  /** Columns of buses, front first. x = world x of the column. */
  columns: { x: number; buses: BusDef[] }[];
  stations: StationDef[];
  /** Parking slots (world x), in "first free slot" order (nearest to the road exit first). */
  slots: number[];
  /**
   * Road centre line [x, z], clockwise on screen: from the entry (+x curb gap) to the exit (-x curb
   * gap). Omitted = the art's SplineMesh loop and its baked centre line.
   */
  road?: number[][];
  /** ROAD counter anchor [x, z] (inside the loop). */
  counter: [number, number];
  scenery: {
    /** [x, z, scale] */
    trees: [number, number, number][];
    /** [x, z, rotationY, scale] */
    snowman?: [number, number, number, number];
  };
};

declare const __LEVEL__: number; // set per build mode in vite.config.ts
/** Dev server: ?level=2 overrides the build's level. */
const LEVEL_NO = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('level') ?? __LEVEL__) : __LEVEL__;
export const LEVEL: LevelDef = LEVEL_NO === 2 ? LEVEL2 : LEVEL1;

/** Lot geometry (see level art: Ground_01 spans x[-7.5,7.5] z[-17.5,1]). */
/** Front edge (z) of the lot slab (Ground_01), measured by tools/build-assets.mjs. */
export const LOT_EDGE_Z = 1.011;

/** Horizontal playfield stretch baked by tools/build-assets.mjs (road + lot meshes and the path). */
export const STRETCH: number = roadPath.stretch;

/**
 * The road's ends sit in the lot's curb gaps at x = ±4.40 * STRETCH (entry +x = screen-left, exit -x =
 * screen-right), so the lot is symmetric: slots and columns between the two lanes.
 */
export const LOT = {
  slotZ: -2.9,
  /** Upper lane between road ends and parking (bus centre z), clear of the front curb. */
  laneTop: -0.3,
  /** Lower lane between parking and the bus columns. */
  laneMid: -5.2,
  /** Side lane (bus centre x) that column buses take up to the upper lane: midway between the
   *  screen-rightmost parked bus's edge and the road exit (x = -4.4 * STRETCH). */
  sideLane: (Math.min(...LEVEL.slots) - 0.65 - 4.4 * STRETCH) / 2,
  /** Front edge of the bus columns. */
  columnFront: -6.1,
  columnGap: 0.45,
  /** Gate barrier post (world) and exit lane end. */
  gate: new Vector3(-4.4 * STRETCH - 1.7, 0, -1.65),
  exitFar: new Vector3(-15, 0, -0.3),
};

/** Body length per model (m) — from the FBX bounds. */
export const BUS_LEN: Record<Seats, number> = { 4: 2.1, 6: 2.25, 10: 3.05 };

/**
 * Seat anchors (bus-local x,z) measured from the open-top interiors (2 x N grids).
 * y is the seat cushion height.
 */
const grid = (rows: number[], halfX: number) => rows.flatMap((z) => [new Vector3(halfX, 0, z), new Vector3(-halfX, 0, z)]);
export const SEATS: Record<Seats, Vector3[]> = {
  4: grid([0.15, -0.21], 0.155),
  6: grid([0.36, -0.1, -0.56], 0.175),
  10: grid([0.82, 0.38, -0.05, -0.48, -0.91], 0.205),
};
export const SEAT_Y = 0.52;
