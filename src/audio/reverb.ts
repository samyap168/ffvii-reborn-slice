// Procedural impulse responses for the shared convolution reverbs.
import { Out, makeRng, white, addInto, zeros, lp1, toBuffer, rr, type Sig } from './dsp';

export type Space = 'valley' | 'cathedral';

interface Band { lo: number; hi: number; t60: number; g: number }

/** Diffuse exponentially decaying noise with 4 frequency bands (split by an SVF cascade), single pass. */
function diffuseTail(sr: number, n: number, seed: number, bands: Band[], predelay: number, bloom: number): Sig {
  const r = makeRng(seed);
  const out = zeros(n);
  const pd = Math.round(predelay * sr);
  const bl = Math.max(1, Math.round(bloom * sr));
  const coef = (f: number): [number, number, number, number] => {
    const g = Math.tan(Math.PI * Math.min(f, sr * 0.45) / sr), k = 1.4;
    const a1 = 1 / (1 + g * (g + k)); return [a1, g * a1, g * g * a1, k];
  };
  const c1 = coef(bands[0].hi), c2 = coef(bands[1].hi), c3 = coef(bands[2].hi);
  const ks = bands.map((b) => Math.exp(-6.907755 / (b.t60 * sr)));
  const es = bands.map((b) => b.g);
  let s1a = 0, s1b = 0, s2a = 0, s2b = 0, s3a = 0, s3b = 0;
  const [a11, a12, a13, k1] = c1, [a21, a22, a23, k2] = c2, [a31, a32, a33, k3] = c3;
  let e0 = es[0], e1 = es[1], e2 = es[2], e3 = es[3];
  const k0d = ks[0], k1d = ks[1], k2d = ks[2], k3d = ks[3];
  for (let i = 0; i < n; i++) {
    const x = r() * 2 - 1;
    // band 1 split
    let v3 = x - s1b; let v1 = a11 * s1a + a12 * v3; let v2 = s1b + a12 * s1a + a13 * v3;
    s1a = 2 * v1 - s1a; s1b = 2 * v2 - s1b;
    const lo = v2, h1 = x - k1 * v1 - v2;
    v3 = h1 - s2b; v1 = a21 * s2a + a22 * v3; v2 = s2b + a22 * s2a + a23 * v3;
    s2a = 2 * v1 - s2a; s2b = 2 * v2 - s2b;
    const mid = v2, h2 = h1 - k2 * v1 - v2;
    v3 = h2 - s3b; v1 = a31 * s3a + a32 * v3; v2 = s3b + a32 * s3a + a33 * v3;
    s3a = 2 * v1 - s3a; s3b = 2 * v2 - s3b;
    const hi = v2, air = h2 - k3 * v1 - v2;
    if (i < pd) continue;
    const j = i - pd;
    const build = j < bl ? Math.pow(j / bl, 1.5) : 1;
    out[i] = (lo * e0 + mid * e1 + hi * e2 + air * e3) * build;
    e0 *= k0d; e1 *= k1d; e2 *= k2d; e3 *= k3d;
  }
  return out;
}

export function makeImpulse(ctx: BaseAudioContext, space: Space): AudioBuffer {
  const sr = ctx.sampleRate;
  if (space === 'valley') {
    const dur = 3.6;
    const o = new Out(sr, dur);
    const bands: Band[] = [
      { lo: 0, hi: 280, t60: 2.3, g: 0.8 },
      { lo: 280, hi: 2600, t60: 2.9, g: 1.0 },
      { lo: 2600, hi: 7000, t60: 1.5, g: 0.55 },
      { lo: 7000, hi: sr / 2, t60: 0.6, g: 0.25 },
    ];
    const L = diffuseTail(sr, o.n, 11, bands, 0.018, 0.09);
    const R = diffuseTail(sr, o.n, 23, bands, 0.021, 0.1);
    o.addSt(L, R, 0, 0.55);
    // early reflections (nearby ground/trees)
    const r = makeRng(5);
    for (let i = 0; i < 14; i++) {
      const t = rr(r, 0.006, 0.07); const g = rr(r, 0.15, 0.5) * (1 - t * 8);
      const idx = Math.round(t * sr); if (idx < o.n) { if (r() < 0.5) o.L[idx] += g; else o.R[idx] += g; }
    }
    // distant mountain slap echoes: short diffuse, darkened bursts
    const echoes: [number, number, number][] = [[0.23, 0.22, -1], [0.39, 0.16, 1], [0.61, 0.11, -0.6], [0.88, 0.07, 0.8], [1.2, 0.04, -0.3]];
    for (const [t, g, pan] of echoes) {
      const n = Math.round(0.05 * sr);
      let burst = white(n, r);
      for (let i = 0; i < n; i++) burst[i] *= Math.exp(-i / (0.012 * sr));
      burst = lp1(lp1(burst, sr, 1800), sr, 2400);
      const gl = g * (pan < 0 ? 1 : 1 - pan * 0.7), gr = g * (pan > 0 ? 1 : 1 + pan * 0.7);
      o.addSt(burst, burst, t, 1);
      addInto(o.L, burst, gl - 1, Math.round(t * sr)); addInto(o.R, burst, gr - 1, Math.round(t * sr));
    }
    energyNormalize(o);
    return toBuffer(ctx, o);
  }
  // cosmic cathedral: long, blooming, dark-to-shimmering
  const dur = 7;
  const o = new Out(sr, dur);
  const bands: Band[] = [
    { lo: 0, hi: 200, t60: 7.5, g: 0.9 },
    { lo: 200, hi: 1800, t60: 6.4, g: 1.0 },
    { lo: 1800, hi: 6000, t60: 4.2, g: 0.6 },
    { lo: 6000, hi: sr / 2, t60: 2.2, g: 0.28 },
  ];
  const L = diffuseTail(sr, o.n, 101, bands, 0.045, 0.35);
  const R = diffuseTail(sr, o.n, 202, bands, 0.052, 0.38);
  o.addSt(L, R, 0, 0.5);
  const r = makeRng(77);
  for (let i = 0; i < 24; i++) {
    const t = rr(r, 0.03, 0.22); const g = rr(r, 0.08, 0.3);
    const idx = Math.round(t * sr); if (r() < 0.5) o.L[idx] += g; else o.R[idx] += g;
  }
  energyNormalize(o);
  return toBuffer(ctx, o);
}

function energyNormalize(o: Out): void {
  let e = 0;
  for (let i = 0; i < o.n; i++) e += o.L[i] * o.L[i] + o.R[i] * o.R[i];
  const g = 1 / Math.sqrt(Math.max(1e-9, e / 2));
  o.gain(g * 0.9);
}
