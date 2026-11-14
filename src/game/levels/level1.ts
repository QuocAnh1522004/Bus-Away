import type { ColorName } from '../palette';
import type { LevelDef } from '../level';

const run = (color: ColorName, n: number): ColorName[] => Array(n).fill(color);

/** Level 1: the art's road loop (SplineMesh), 2 stations, 4 slots, 10 buses. */
export const LEVEL1: LevelDef = {
  capacity: 3,
  moves: 20,
  time: 60,
  columns: [
    { x: 3.3, buses: [{ color: 'red', seats: 6 }, { color: 'blue', seats: 4 }, { color: 'green', seats: 10 }] },
    { x: 1.1, buses: [{ color: 'blue', seats: 6 }, { color: 'yellow', seats: 4 }, { color: 'red', seats: 4 }] },
    { x: -1.1, buses: [{ color: 'yellow', seats: 10 }, { color: 'green', seats: 6 }] },
    { x: -3.3, buses: [{ color: 'green', seats: 4 }, { color: 'red', seats: 6 }] },
  ],
  stations: [
    { s: 6.6, queue: [...run('red', 6), ...run('blue', 6), ...run('yellow', 4), ...run('green', 4), ...run('red', 4), ...run('green', 6)] },
    { s: 23.0, queue: [...run('yellow', 10), ...run('green', 10), ...run('blue', 4), ...run('red', 6)] },
  ],
  slots: [-3.3, -1.1, 1.1, 3.3],
  counter: [0, 1.6],
  scenery: {
    trees: [
      // inside the loop
      [1.3, 3.9, 1.0], [3.0, 7.9, 1.15], [0.3, 11.1, 0.9], [-0.5, 5.9, 0.75], [2.6, 11.9, 0.7],
      // hugging the road's outside: top-left bend, and where each road leg meets the lot
      [4.9, 14.3, 1.0], [8.1, 2.4, 0.9], [-7.4, 4.4, 0.95], [-8.7, 2.2, 0.8],
    ],
    snowman: [1.05, 7.5, Math.PI + 0.4, 0.75],
  },
};
