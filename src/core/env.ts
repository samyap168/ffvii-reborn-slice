// Global atmosphere/lighting state shared by every shader as TSL uniforms.
// Gameplay & cinematics animate the plain JS values; `Env.sync()` pushes them to the GPU.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const U = {
  time: uniform(0),
  sunDir: uniform(new THREE.Vector3(0.4, 0.55, 0.3).normalize()),
  sunColor: uniform(new THREE.Color(1.0, 0.92, 0.78)),
  sunIntensity: uniform(1),
  zenith: uniform(new THREE.Color(0.16, 0.34, 0.72)),
  horizon: uniform(new THREE.Color(0.62, 0.74, 0.88)),
  ground: uniform(new THREE.Color(0.28, 0.27, 0.24)),
  fogColor: uniform(new THREE.Color(0.66, 0.74, 0.84)),
  fogDensity: uniform(0.0011),
  fogHeight: uniform(0.012),
  cloudCover: uniform(0.45),
  cloudSpeed: uniform(1),
  windDir: uniform(new THREE.Vector2(0.8, 0.6).normalize()),
  windStrength: uniform(0.55),
  storm: uniform(0), // 0 clear .. 1 storm (boss phase 2)
  cosmic: uniform(0), // Knights of Round sky takeover
  enrage: uniform(0),
  flash: uniform(0), // lightning / impact flash additive
  flashColor: uniform(new THREE.Color(0.8, 0.85, 1.0)),
  // Interaction: up to 4 "benders" (player, chocobo, monster...) that push grass.
  bend0: uniform(new THREE.Vector4(0, -999, 0, 0)),
  bend1: uniform(new THREE.Vector4(0, -999, 0, 0)),
  bend2: uniform(new THREE.Vector4(0, -999, 0, 0)),
  bend3: uniform(new THREE.Vector4(0, -999, 0, 0)),
  // Dynamic point light for spells lighting nearby grass/terrain (cheap custom term).
  spellPos: uniform(new THREE.Vector3(0, -999, 0)),
  spellColor: uniform(new THREE.Color(0, 0, 0)),
  spellRadius: uniform(20),
  playerPos: uniform(new THREE.Vector3()),
  scorchCenter: uniform(new THREE.Vector4(0, 0, 0, 0)), // xz, radius, amount
};

export type Uniforms = typeof U;

/** Palette presets the director blends between. */
export interface SkyPreset {
  sunElev: number;
  sunAzim: number;
  sunColor: [number, number, number];
  sunIntensity: number;
  zenith: [number, number, number];
  horizon: [number, number, number];
  fog: [number, number, number];
  fogDensity: number;
  cloudCover: number;
  exposure: number;
  ambient: number;
}

export const PRESET_DAY: SkyPreset = {
  sunElev: 0.36,
  sunAzim: -0.55,
  sunColor: [1.0, 0.84, 0.64],
  sunIntensity: 3.6,
  zenith: [0.1, 0.25, 0.62],
  horizon: [0.62, 0.7, 0.82],
  fog: [0.56, 0.62, 0.72],
  fogDensity: 0.00052,
  cloudCover: 0.42,
  exposure: 1.0,
  ambient: 1.0,
};

export const PRESET_STORM: SkyPreset = {
  sunElev: 0.3,
  sunAzim: 2.35,
  sunColor: [0.85, 0.42, 0.34],
  sunIntensity: 1.0,
  zenith: [0.07, 0.07, 0.1],
  horizon: [0.3, 0.2, 0.22],
  fog: [0.2, 0.16, 0.18],
  fogDensity: 0.0024,
  cloudCover: 0.95,
  exposure: 1.15,
  ambient: 0.55,
};

export const PRESET_COSMIC: SkyPreset = {
  sunElev: 0.9,
  sunAzim: 2.35,
  sunColor: [1.0, 0.82, 0.55],
  sunIntensity: 1.7,
  zenith: [0.02, 0.01, 0.05],
  horizon: [0.35, 0.18, 0.08],
  fog: [0.2, 0.12, 0.08],
  fogDensity: 0.0012,
  cloudCover: 0.0,
  exposure: 1.1,
  ambient: 0.7,
};

export const PRESET_AFTERMATH: SkyPreset = {
  sunElev: 0.2,
  sunAzim: 2.1,
  sunColor: [1.0, 0.68, 0.42],
  sunIntensity: 2.8,
  zenith: [0.16, 0.24, 0.5],
  horizon: [0.9, 0.62, 0.42],
  fog: [0.72, 0.56, 0.44],
  fogDensity: 0.0012,
  cloudCover: 0.5,
  exposure: 1.05,
  ambient: 0.9,
};

export function lerpPreset(a: SkyPreset, b: SkyPreset, t: number): SkyPreset {
  const l = (x: number, y: number) => x + (y - x) * t;
  const l3 = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [l(x[0], y[0]), l(x[1], y[1]), l(x[2], y[2])];
  return {
    sunElev: l(a.sunElev, b.sunElev),
    sunAzim: l(a.sunAzim, b.sunAzim),
    sunColor: l3(a.sunColor, b.sunColor),
    sunIntensity: l(a.sunIntensity, b.sunIntensity),
    zenith: l3(a.zenith, b.zenith),
    horizon: l3(a.horizon, b.horizon),
    fog: l3(a.fog, b.fog),
    fogDensity: l(a.fogDensity, b.fogDensity),
    cloudCover: l(a.cloudCover, b.cloudCover),
    exposure: l(a.exposure, b.exposure),
    ambient: l(a.ambient, b.ambient),
  };
}
