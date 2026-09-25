// Hand-authored world layout: where the lake, rivers, paths and ruins live.
// Everything else is generated procedurally around these anchors.
import { Spline2, type P2 } from '../core/math';

export const WORLD_SIZE = 2048; // meters, square centered on origin
export const HALF = WORLD_SIZE / 2;
export const HF_RES = 1025; // heightfield samples per side (2m spacing)
export const HF_CELL = WORLD_SIZE / (HF_RES - 1);

export const LAKE = { x: 10, z: -270, radius: 175, level: 20 };
export const ARENA = { x: 168, z: -118, radius: 46, height: 23.2 };
export const WATERFALL = { x: 36, z: -476, top: 78, bottom: LAKE.level, baseZ: -449 };
export const MONSTER_MEADOW = { x: -40, z: 150 };
export const PLAYER_START = { x: -590, z: 360, heading: 1.25 };
export const BRIDGE = { x: -408, z: 392 };

/** Main dirt road from the west plains, over the ancient bridge, to the ruins gate. */
export const ROAD = new Spline2(
  [
    { x: -760, z: 330 },
    { x: -620, z: 365 },
    { x: -500, z: 385 },
    { x: -408, z: 392 },
    { x: -330, z: 368 },
    { x: -240, z: 300 },
    { x: -150, z: 240 },
    { x: -60, z: 190 },
    { x: 20, z: 110 },
    { x: 80, z: 30 },
    { x: 130, z: -40 },
    { x: 160, z: -78 },
  ],
  28,
);

/** Secondary trail around the lake's west shore up toward the waterfall overlook. */
export const TRAIL = new Spline2(
  [
    { x: -60, z: 190 },
    { x: -170, z: 100 },
    { x: -285, z: -70 },
    { x: -250, z: -230 },
    { x: -170, z: -360 },
    { x: -90, z: -440 },
    { x: -30, z: -470 },
  ],
  28,
);

/** Mountain river that feeds the waterfall (flows toward +t). */
export const UPPER_RIVER = new Spline2(
  [
    { x: 150, z: -1000 },
    { x: 110, z: -860 },
    { x: 60, z: -720 },
    { x: 20, z: -600 },
    { x: 40, z: -520 },
    { x: WATERFALL.x, z: WATERFALL.z - 12 },
  ],
  24,
);

/** Lake outflow stream winding south-west (flows toward +t). */
export const STREAM = new Spline2(
  [
    { x: -150, z: -170 },
    { x: -210, z: -60 },
    { x: -260, z: 60 },
    { x: -330, z: 190 },
    { x: -385, z: 300 },
    { x: -408, z: 392 },
    { x: -450, z: 500 },
    { x: -540, z: 640 },
    { x: -640, z: 780 },
    { x: -760, z: 1010 },
  ],
  24,
);

export const STREAM_BED_START = 18.6;
export const STREAM_BED_END = 2.0;
export const UPPER_BED_START = 150;
export const UPPER_BED_END = WATERFALL.top - 2.2;

export function streamBedAt(t: number) {
  return STREAM_BED_START + (STREAM_BED_END - STREAM_BED_START) * Math.pow(t, 0.85);
}
export function upperBedAt(t: number) {
  return UPPER_BED_START + (UPPER_BED_END - UPPER_BED_START) * Math.pow(t, 0.7);
}

/** Ruins scattered through the world besides the main arena. */
export const RUIN_SITES: { x: number; z: number; kind: 'arch' | 'pillars' | 'tower' | 'wall' | 'shrine'; rot: number }[] = [
  { x: -300, z: 250, kind: 'pillars', rot: 0.4 },
  { x: -120, z: 60, kind: 'arch', rot: 1.1 },
  { x: 60, z: 250, kind: 'wall', rot: -0.3 },
  { x: -470, z: 240, kind: 'tower', rot: 0.9 },
  { x: -230, z: -300, kind: 'shrine', rot: 2.2 },
  { x: 300, z: 60, kind: 'tower', rot: -1.4 },
  { x: 250, z: -300, kind: 'pillars', rot: 0.2 },
  { x: -40, z: -470, kind: 'shrine', rot: 3.0 },
];

export function lakeRadiusAt(angle: number, noise: (a: number) => number) {
  return LAKE.radius + 26 * noise(angle);
}

export type { P2 };
