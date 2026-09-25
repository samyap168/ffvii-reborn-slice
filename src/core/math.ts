// Deterministic math + noise utilities shared by world generation and gameplay.

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const saturate = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => saturate((v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = saturate((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
export const fract = (v: number) => v - Math.floor(v);
export const TAU = Math.PI * 2;

/** Frame-rate independent exponential damping toward a target. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const dampAngle = (current: number, target: number, lambda: number, dt: number) => {
  let d = target - current;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return current + d * (1 - Math.exp(-lambda * dt));
};

export const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInExpo = (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10));

/** Mulberry32 seeded PRNG. */
export class RNG {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  gauss() {
    let u = 0,
      v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
}

// ---------------------------------------------------------------------------
// Simplex noise (2D/3D), seeded permutation.
// ---------------------------------------------------------------------------
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;
const grad3 = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);

export class Simplex {
  private perm = new Uint8Array(512);
  private permMod12 = new Uint8Array(512);
  constructor(seed = 1337) {
    const rng = new RNG(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  noise2(xin: number, yin: number): number {
    const perm = this.perm,
      pm = this.permMod12;
    let n0 = 0,
      n1 = 0,
      n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi = pm[ii + perm[jj]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi] * x0 + grad3[gi + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi = pm[ii + i1 + perm[jj + j1]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi] * x1 + grad3[gi + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi = pm[ii + 1 + perm[jj + 1]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi] * x2 + grad3[gi + 1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  noise3(xin: number, yin: number, zin: number): number {
    const perm = this.perm,
      pm = this.permMod12;
    let n0 = 0,
      n1 = 0,
      n2 = 0,
      n3 = 0;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
      } else if (x0 < z0) {
        i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
      } else {
        i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) {
      const gi = pm[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi] * x0 + grad3[gi + 1] * y0 + grad3[gi + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) {
      const gi = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi] * x1 + grad3[gi + 1] * y1 + grad3[gi + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) {
      const gi = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi] * x2 + grad3[gi + 1] * y2 + grad3[gi + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) {
      const gi = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n3 = t3 * t3 * (grad3[gi] * x3 + grad3[gi + 1] * y3 + grad3[gi + 2] * z3);
    }
    return 32 * (n0 + n1 + n2 + n3);
  }

  fbm2(x: number, y: number, oct = 5, lac = 2.0, gain = 0.5): number {
    let a = 1,
      f = 1,
      s = 0,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.noise2(x * f, y * f);
      n += a;
      a *= gain;
      f *= lac;
    }
    return s / n;
  }

  ridged2(x: number, y: number, oct = 5, lac = 2.0, gain = 0.5): number {
    let a = 1,
      f = 1,
      s = 0,
      n = 0,
      w = 1;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(this.noise2(x * f, y * f));
      v *= v;
      v *= w;
      w = saturate(v * 2);
      s += a * v;
      n += a;
      a *= gain;
      f *= lac;
    }
    return s / n;
  }

  fbm3(x: number, y: number, z: number, oct = 4): number {
    let a = 1,
      f = 1,
      s = 0,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.noise3(x * f, y * f, z * f);
      n += a;
      a *= 0.5;
      f *= 2;
    }
    return s / n;
  }
}

// ---------------------------------------------------------------------------
// Catmull-Rom spline in XZ with distance queries (for paths / rivers)
// ---------------------------------------------------------------------------
export interface P2 {
  x: number;
  z: number;
}

export class Spline2 {
  readonly samples: P2[] = [];
  readonly cum: number[] = [];
  length = 0;
  constructor(public pts: P2[], perSeg = 24) {
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)],
        p1 = pts[i],
        p2 = pts[i + 1],
        p3 = pts[Math.min(n - 1, i + 2)];
      for (let s = 0; s < perSeg; s++) {
        const t = s / perSeg;
        this.samples.push(catmull(p0, p1, p2, p3, t));
      }
    }
    this.samples.push({ ...pts[n - 1] });
    this.cum.push(0);
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1],
        b = this.samples[i];
      this.length += Math.hypot(b.x - a.x, b.z - a.z);
      this.cum.push(this.length);
    }
  }

  /** Returns distance to the spline and the arc parameter (0..1) of the closest point. */
  closest(x: number, z: number): { d: number; t: number; px: number; pz: number } {
    let best = Infinity,
      bt = 0,
      bx = 0,
      bz = 0;
    const s = this.samples;
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i],
        b = s[i + 1];
      const abx = b.x - a.x,
        abz = b.z - a.z;
      const l2 = abx * abx + abz * abz || 1e-6;
      let u = ((x - a.x) * abx + (z - a.z) * abz) / l2;
      u = saturate(u);
      const px = a.x + abx * u,
        pz = a.z + abz * u;
      const d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < best) {
        best = d;
        bt = (this.cum[i] + Math.sqrt(l2) * u) / this.length;
        bx = px;
        bz = pz;
      }
    }
    return { d: Math.sqrt(best), t: bt, px: bx, pz: bz };
  }

  at(t: number): P2 {
    const target = saturate(t) * this.length;
    let lo = 0,
      hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < target) lo = mid;
      else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1e-6;
    const u = (target - this.cum[lo]) / seg;
    const a = this.samples[lo],
      b = this.samples[hi];
    return { x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u) };
  }

  tangent(t: number): P2 {
    const a = this.at(Math.max(0, t - 0.002)),
      b = this.at(Math.min(1, t + 0.002));
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  }
}

function catmull(p0: P2, p1: P2, p2: P2, p3: P2, t: number): P2 {
  const t2 = t * t,
    t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) };
}
