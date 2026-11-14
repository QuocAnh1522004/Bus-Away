import roadPath from '../../assets/gen/road-path.json';
import { turtlePath } from '../../engine/roadMesh';
import type { BusDef, LevelDef, Seats, StationDef } from '../level';
import type { ColorName } from '../palette';

/**
 * Level 2: a thicker layout on its own road. 3 stations, 5 parking slots, 5 columns x 4 buses,
 * up to 5 buses on the road.
 *
 * Road: an "M" — up the left leg, over a hump, down into a centre valley (a notch cut into the loop
 * from the top), over a second hump and down the right leg. It starts and ends in the lot's curb
 * gaps, exactly where the art road does. Every bend is >= 2.1 m radius, wider than the 1.78 m snow
 * bank, so the swept mesh never folds.
 */
const ENTRY = roadPath.path[roadPath.path.length - 1] as [number, number]; // +x curb gap (screen-left)
const EXIT = roadPath.path[0] as [number, number]; //                        -x curb gap (screen-right)
const LEG_X = 6.4; // legs bow out a little above the lot
const LEG_TOP = 11;
const HUMP_R = 2.1;
const VALLEY_R = 2.2; // = LEG_X - 2 * HUMP_R: the valley is centred on x = 0
const VALLEY_CZ = 8;

function mRoad(): number[][] {
  const R0 = 3; // S-bend from the curb gap out to LEG_X
  const th = (Math.acos(1 - (LEG_X - ENTRY[0]) / (2 * R0)) * 180) / Math.PI;
  const zAfterS = ENTRY[1] + 2 * R0 * Math.sin((th * Math.PI) / 180);
  const left = turtlePath(ENTRY, 0, [
    { r: R0, deg: th },
    { r: R0, deg: -th },
    { len: LEG_TOP - zAfterS },
    { r: HUMP_R, deg: -180 }, // over the left hump, now heading down
    { len: LEG_TOP - VALLEY_CZ },
    { r: VALLEY_R, deg: 90 }, // valley bottom (x = 0), heading -x
  ]);
  // right half = mirror image, driven the other way
  const right = left.slice(0, -1).reverse().map(([x, z]) => [-x, z]);
  const all = left.concat(right);
  all[all.length - 1] = [EXIT[0], EXIT[1]];
  return all;
}

// Arc lengths of the M (see mRoad): S-bend 2.93, left leg to 10.23, hump apex 13.53, total 46.47.
const ROAD_LEN = 46.47;

// ---- buses: 5 columns x 4, front first
const b = (color: ColorName, seats: Seats): BusDef => ({ color, seats });
const COLUMNS: BusDef[][] = [
  [b('red', 6), b('blue', 4), b('green', 10), b('yellow', 6)],
  [b('blue', 6), b('purple', 4), b('red', 10), b('orange', 6)],
  [b('yellow', 10), b('green', 6), b('blue', 4), b('purple', 6)],
  [b('green', 4), b('orange', 6), b('yellow', 4), b('red', 6)],
  [b('purple', 6), b('red', 4), b('orange', 10), b('blue', 6)],
];

/**
 * Passenger queues are generated from a playable launch order (row by row across the columns):
 * each bus's passengers go to the stations in turn, so sending buses in that order always works,
 * while sending the wrong colours fills the parking (5 slots) and loses.
 */
function queues(): ColorName[][] {
  const out: ColorName[][] = [[], [], []];
  let i = 0;
  for (let row = 0; row < 4; row++) {
    for (const col of COLUMNS) {
      const bus = col[row];
      if (!bus) continue;
      out[i++ % 3].push(...Array<ColorName>(bus.seats).fill(bus.color));
    }
  }
  return out;
}
const Q = queues();

const STATIONS: StationDef[] = [
  { s: 6.0, queue: Q[0] }, //               outside the left leg
  { s: 13.53, queue: Q[1] }, //             on top of the left hump
  { s: ROAD_LEN - 6.0, queue: Q[2] }, //    outside the right leg
];

export const LEVEL2: LevelDef = {
  capacity: 5,
  moves: 34,
  time: 90,
  columns: COLUMNS.map((buses, i) => ({ x: [3.6, 1.8, 0, -1.8, -3.6][i], buses })), // a touch inside the slots: clear of the side lane
  stations: STATIONS,
  slots: [-3.7, -1.85, 0, 1.85, 3.7],
  road: mRoad(),
  counter: [0, 2.2],
  scenery: {
    trees: [
      [0, 11.6, 1.0], //                     in the valley notch, like the reference
      [-4.3, 15.4, 0.95], [-6.3, 14.6, 0.75], // over the right hump (the left one has a station)
      [3.4, 2.2, 0.8], [-3.4, 2.2, 0.8], //   inside the loop, either side of the ROAD counter
      [9.0, 1.9, 0.9], [-9.2, 2.6, 0.85], //  where the legs meet the lot
    ],
    snowman: [-8.4, 10.6, Math.PI - 0.5, 0.75],
  },
};
