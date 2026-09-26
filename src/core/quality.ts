export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  level: QualityLevel;
  pixelRatio: number;
  terrainN: number;
  terrainRings: number;
  grassDensity: number; // blades per m² near camera
  grassRadius: number;
  treeCount: number;
  shadowMapSize: number;
  shadowCascades: number;
  shadowFar: number;
  bloom: boolean;
  dof: boolean;
  motionBlur: boolean;
  ao: boolean;
  shafts: boolean;
  msaa: number;
  particleBudget: number;
  featherShells: number;
  /** Scale render resolution to hold the frame rate. */
  adaptive: boolean;
}

const PRESETS: Record<QualityLevel, Omit<QualitySettings, 'adaptive'>> = {
  low: {
    level: 'low',
    pixelRatio: 0.75,
    terrainN: 32,
    terrainRings: 7,
    grassDensity: 10,
    grassRadius: 38,
    treeCount: 1400,
    shadowMapSize: 1024,
    shadowCascades: 2,
    shadowFar: 140,
    bloom: true,
    dof: false,
    motionBlur: false,
    ao: false,
    shafts: false,
    msaa: 0,
    particleBudget: 4000,
    featherShells: 6,
  },
  medium: {
    level: 'medium',
    pixelRatio: 1,
    terrainN: 48,
    terrainRings: 7,
    grassDensity: 20,
    grassRadius: 52,
    treeCount: 2400,
    shadowMapSize: 2048,
    shadowCascades: 3,
    shadowFar: 220,
    bloom: true,
    dof: true,
    motionBlur: false,
    ao: false,
    shafts: true,
    msaa: 0,
    particleBudget: 8000,
    featherShells: 10,
  },
  high: {
    level: 'high',
    pixelRatio: 1,
    terrainN: 64,
    terrainRings: 7,
    grassDensity: 26,
    grassRadius: 60,
    treeCount: 3600,
    shadowMapSize: 2048,
    shadowCascades: 3,
    shadowFar: 300,
    bloom: true,
    dof: true,
    motionBlur: false,
    ao: false,
    shafts: true,
    msaa: 0,
    particleBudget: 14000,
    featherShells: 14,
  },
  ultra: {
    level: 'ultra',
    pixelRatio: 1.25,
    terrainN: 80,
    terrainRings: 7,
    grassDensity: 48,
    grassRadius: 80,
    treeCount: 5000,
    shadowMapSize: 4096,
    shadowCascades: 4,
    shadowFar: 400,
    bloom: true,
    dof: true,
    motionBlur: false,
    ao: true,
    shafts: true,
    msaa: 4,
    particleBudget: 20000,
    featherShells: 18,
  },
};

export function getQuality(): QualitySettings {
  const params = new URLSearchParams(location.search);
  let level = (params.get('q') as QualityLevel) || (localStorageGet('ffvii.quality') as QualityLevel) || 'high';
  if (!PRESETS[level]) level = 'high';
  const q = { ...PRESETS[level], adaptive: true } as QualitySettings;
  // Render at CSS resolution (FXAA smooths edges); only Ultra supersamples on HiDPI screens.
  if (level === 'ultra') q.pixelRatio = Math.min(q.pixelRatio * window.devicePixelRatio, 2);
  if (params.has('pr')) q.pixelRatio = parseFloat(params.get('pr')!);
  if (params.has('pr') || params.has('noadapt')) q.adaptive = false;
  // Motion blur is opt-in: ?mb=1
  if (params.get('mb') === '1') q.motionBlur = true;
  return q;
}

export function localStorageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
export function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
