import { Vector3 } from 'three';
import type { ColorName } from './palette';

/**
 * Level 1. All coordinates are world space (metres). Authoring axis note: the camera looks from -Z
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

const run = (color: ColorName, n: number): ColorName[] => Array(n).fill(color);

export const LEVEL = {
  /** Max buses on the road at the same time. */
  capacity: 3,
  /** Columns of buses, front first. x = world x of the column. */
  columns: [
    { x: 2.775, buses: [{ color: 'red', seats: 6 }, { color: 'blue', seats: 4 }, { color: 'green', seats: 10 }] },
    { x: 0.925, buses: [{ color: 'blue', seats: 6 }, { color: 'yellow', seats: 4 }, { color: 'red', seats: 4 }] },
    { x: -0.925, buses: [{ color: 'yellow', seats: 10 }, { color: 'green', seats: 6 }] },
    { x: -2.775, buses: [{ color: 'green', seats: 4 }, { color: 'red', seats: 6 }] },
  ] as { x: number; buses: BusDef[] }[],
  stations: [
    { s: 6.6, queue: [...run('red', 6), ...run('blue', 6), ...run('yellow', 4), ...run('green', 4), ...run('red', 4), ...run('green', 6)] },
    { s: 24.6, queue: [...run('yellow', 10), ...run('green', 10), ...run('blue', 4), ...run('red', 6)] },
  ] as StationDef[],
  /** Parking slots, in "first free slot" order (nearest to the road exit first). */
  slots: [-2.775, -0.925, 0.925, 2.775],
};

/** Lot geometry (see level art: Ground_01 spans x[-7.5,7.5] z[-17.5,1]). */
/**
 * The road's ends sit in the lot's curb gaps at x = ±4.40 (entry +x = screen-left, exit -x =
 * screen-right), so the lot is symmetric: slots and columns between the two lanes.
 */
export const LOT = {
  slotZ: -2.9,
  /** Upper lane between road ends and parking (bus centre z), clear of the front curb. */
  laneTop: -0.3,
  /** Lower lane between parking and the bus columns. */
  laneMid: -5.2,
  /** Front edge of the bus columns. */
  columnFront: -6.1,
  columnGap: 0.45,
  /** Gate barrier post (world) and exit lane end. */
  gate: new Vector3(-6.3, 0, -1.65),
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
