// Offline JS DSP toolkit used to pre-render sound effects, instrument samples,
// ambience loop textures and reverb impulse responses into AudioBuffers.
// Everything here is context-agnostic: the result can be copied into a buffer
// created by any BaseAudioContext (realtime or offline).

export type Sig = Float32Array<ArrayBuffer>;
/** A parameter that is either constant or given per sample. */
export type P = number | Sig;
export type Rng = () => number;

export const TAU = Math.PI * 2;

export function makeRng(seed: number): Rng {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rr = (r: Rng, a: number, b: number): number => a + (b - a) * r();
export const ri = (r: Rng, a: number, b: number): number => Math.floor(a + (b - a + 1) * r());
export function pick<T>(r: Rng, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
}
export const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (d: number): number => Math.pow(10, d / 20);
export const smooth = (t: number): number => { const x = clamp(t); return x * x * (3 - 2 * x); };

export function zeros(n: number): Sig { return new Float32Array(Math.max(1, n | 0)); }
export function secs(sr: number, s: number): number { return Math.max(1, Math.round(s * sr)); }

/** Stereo render target. */
export class Out {
  readonly L: Sig;
  readonly R: Sig;
  readonly n: number;
  constructor(readonly sr: number, dur: number) {
    this.n = Math.max(1, Math.ceil(dur * sr));
    this.L = zeros(this.n);
    this.R = zeros(this.n);
  }
  get dur(): number { return this.n / this.sr; }
  /** Add a mono signal with equal-power pan (-1..1). Center = unity on both sides. */
  add(x: Sig, at = 0, gain = 1, pan = 0): this {
    const o = Math.round(at * this.sr);
    const a = (clamp(pan, -1, 1) + 1) * Math.PI / 4;
    const gl = gain * Math.cos(a) * Math.SQRT2;
    const gr = gain * Math.sin(a) * Math.SQRT2;
    const L = this.L, R = this.R;
    const start = Math.max(0, -o);
    const end = Math.min(x.length, this.n - o);
    for (let i = start; i < end; i++) { const v = x[i]; L[o + i] += v * gl; R[o + i] += v * gr; }
    return this;
  }
  /** Add a mono signal spread wide: a decorrelated copy goes to the opposite side. */
  addWide(x: Sig, at = 0, gain = 1, width = 0.7, pan = 0): this {
    const d = decorrelate(x, this.sr);
    const g = gain * 0.72;
    this.add(x, at, g, clamp(pan - width, -1, 1));
    this.add(d, at, g, clamp(pan + width, -1, 1));
    return this;
  }
  addSt(l: Sig, r: Sig, at = 0, gain = 1): this {
    const o = Math.round(at * this.sr);
    const s = Math.max(0, -o);
    const eL = Math.min(l.length, this.n - o), eR = Math.min(r.length, this.n - o);
    for (let i = s; i < eL; i++) this.L[o + i] += l[i] * gain;
    for (let i = s; i < eR; i++) this.R[o + i] += r[i] * gain;
    return this;
  }
  mix(o: Out, at = 0, gain = 1): this { return this.addSt(o.L, o.R, at, gain); }
  peak(): number {
    let p = 0;
    for (let i = 0; i < this.n; i++) { const a = Math.abs(this.L[i]), b = Math.abs(this.R[i]); if (a > p) p = a; if (b > p) p = b; }
    return p;
  }
  normalize(target = 0.95): this {
    const p = this.peak();
    if (p > 1e-9 && isFinite(p)) { const g = target / p; scale(this.L, g); scale(this.R, g); }
    return this;
  }
  gain(g: number): this { scale(this.L, g); scale(this.R, g); return this; }
  fade(inS: number, outS: number): this {
    fadeEdges(this.L, this.sr, inS, outS); fadeEdges(this.R, this.sr, inS, outS); return this;
  }
  /** Remove DC with a very low high-pass and clean up NaNs. */
  clean(): this {
    for (const ch of [this.L, this.R]) {
      let x1 = 0, y1 = 0; const c = 1 - TAU * 12 / this.sr;
      for (let i = 0; i < ch.length; i++) {
        let x = ch[i]; if (!isFinite(x)) x = 0;
        const y = x - x1 + c * y1; x1 = x; y1 = y; ch[i] = y;
      }
    }
    return this;
  }
  /** Trim trailing near-silence (keeps a short tail) */
  trim(thresh = 0.0004): Out {
    let last = this.n - 1;
    while (last > 0 && Math.abs(this.L[last]) < thresh && Math.abs(this.R[last]) < thresh) last--;
    const keep = Math.min(this.n, last + Math.round(this.sr * 0.02));
    if (keep >= this.n - 8) return this;
    const o = new Out(this.sr, keep / this.sr);
    o.L.set(this.L.subarray(0, o.n)); o.R.set(this.R.subarray(0, o.n));
    fadeEdges(o.L, o.sr, 0, 0.015); fadeEdges(o.R, o.sr, 0, 0.015);
    return o;
  }
}

export function scale(x: Sig, g: number): Sig { for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
export function fadeEdges(x: Sig, sr: number, inS: number, outS: number): Sig {
  const ni = Math.min(x.length, Math.round(inS * sr)), no = Math.min(x.length, Math.round(outS * sr));
  for (let i = 0; i < ni; i++) x[i] *= i / ni;
  for (let i = 0; i < no; i++) x[x.length - 1 - i] *= i / no;
  return x;
}
export function mul(x: Sig, m: P): Sig {
  if (typeof m === 'number') return scale(x, m);
  const n = Math.min(x.length, m.length);
  for (let i = 0; i < n; i++) x[i] *= m[i];
  for (let i = n; i < x.length; i++) x[i] = 0;
  return x;
}
export function addInto(dst: Sig, src: Sig, gain = 1, offset = 0): Sig {
  const s = Math.max(0, -offset), e = Math.min(src.length, dst.length - offset);
  for (let i = s; i < e; i++) dst[offset + i] += src[i] * gain;
  return dst;
}
export function sum(...xs: Sig[]): Sig {
  let n = 0; for (const x of xs) n = Math.max(n, x.length);
  const o = zeros(n); for (const x of xs) addInto(o, x); return o;
}
export function reverse(x: Sig): Sig { const o = zeros(x.length); for (let i = 0; i < x.length; i++) o[i] = x[x.length - 1 - i]; return o; }
export function copy(x: Sig): Sig { const o = zeros(x.length); o.set(x); return o; }
export function peakOf(x: Sig): number { let p = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; } return p; }
export function norm(x: Sig, target = 1): Sig { const p = peakOf(x); if (p > 1e-9) scale(x, target / p); return x; }
/** Pad/extend a signal to n samples (zero padded) */
export function fit(x: Sig, n: number): Sig { if (x.length === n) return x; const o = zeros(n); o.set(x.subarray(0, Math.min(n, x.length))); return o; }

// ---------------------------------------------------------------- noise
export function white(n: number, r: Rng): Sig { const o = zeros(n); for (let i = 0; i < n; i++) o[i] = r() * 2 - 1; return o; }
export function pink(n: number, r: Rng): Sig {
  const o = zeros(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    o[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  return o;
}
export function brown(n: number, r: Rng): Sig {
  const o = zeros(n); let y = 0;
  for (let i = 0; i < n; i++) { y = (y + (r() * 2 - 1) * 0.02) * 0.9985; o[i] = y * 3.2; }
  return o;
}
/** Smooth random (value noise) at a given rate, output -1..1 */
export function wander(sr: number, n: number, rate: number, r: Rng): Sig {
  const o = zeros(n);
  const step = Math.max(1, Math.round(sr / Math.max(0.01, rate)));
  let a = r() * 2 - 1, b = r() * 2 - 1;
  for (let i = 0; i < n; i++) {
    const k = i % step;
    if (k === 0 && i > 0) { a = b; b = r() * 2 - 1; }
    const u = k / step; const s = u * u * (3 - 2 * u);
    o[i] = a + (b - a) * s;
  }
  return o;
}

// ---------------------------------------------------------------- envelopes
/** Breakpoint envelope. pts = [t0, v0, t1, v1, ...]. curve > 1 bends segments (exponential-ish). */
export function env(sr: number, n: number, pts: number[], curve = 1): Sig {
  const o = zeros(n);
  const np = pts.length >> 1;
  if (np === 0) return o;
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    while (seg < np - 1 && t >= pts[(seg + 1) * 2]) seg++;
    const t0 = pts[seg * 2], v0 = pts[seg * 2 + 1];
    if (seg >= np - 1 || t < t0) { o[i] = t < pts[0] ? pts[1] : pts[(np - 1) * 2 + 1]; continue; }
    const t1 = pts[seg * 2 + 2], v1 = pts[seg * 2 + 3];
    let u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
    if (curve !== 1) u = v1 < v0 ? 1 - Math.pow(1 - u, curve) : Math.pow(u, curve);
    o[i] = v0 + (v1 - v0) * u;
  }
  return o;
}
/** Exponential interpolation between breakpoints (good for frequencies). Values must be > 0. */
export function xenv(sr: number, n: number, pts: number[]): Sig {
  const lp = pts.slice();
  for (let i = 1; i < lp.length; i += 2) lp[i] = Math.log(Math.max(1e-6, lp[i]));
  const o = env(sr, n, lp);
  for (let i = 0; i < n; i++) o[i] = Math.exp(o[i]);
  return o;
}
/** attack (linear) then exponential decay with time constant tau (seconds). */
export function ad(sr: number, n: number, attack: number, tau: number, delay = 0): Sig {
  const o = zeros(n); const a = Math.max(1, attack * sr), d0 = Math.round(delay * sr), k = Math.exp(-1 / (tau * sr));
  let v = 1;
  for (let i = d0; i < n; i++) {
    const j = i - d0;
    if (j < a) o[i] = j / a; else { v *= k; o[i] = v; }
  }
  return o;
}
/** Hann-like bell envelope peaking at `peakAt` (0..1 of length) */
export function bell(n: number, peakAt = 0.5, pow = 1): Sig {
  const o = zeros(n); const p = Math.max(1, Math.round(n * clamp(peakAt, 0.001, 0.999)));
  for (let i = 0; i < n; i++) {
    const u = i < p ? i / p : 1 - (i - p) / Math.max(1, n - p);
    const s = 0.5 - 0.5 * Math.cos(Math.PI * u);
    o[i] = pow === 1 ? s : Math.pow(s, pow);
  }
  return o;
}

// ---------------------------------------------------------------- oscillators
export type Wave = 'sin' | 'saw' | 'sqr' | 'tri' | 'pulse';
function blep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
export function osc(sr: number, n: number, f: P, wave: Wave = 'sin', phase = 0, pw = 0.5): Sig {
  const o = zeros(n);
  const fa = typeof f === 'number' ? null : f; const fc = typeof f === 'number' ? f : 0;
  let ph = phase - Math.floor(phase);
  let tri = 0;
  for (let i = 0; i < n; i++) {
    const fr = fa ? fa[Math.min(i, fa.length - 1)] : fc;
    const dt = Math.min(0.49, Math.abs(fr) / sr);
    let v: number;
    switch (wave) {
      case 'sin': v = Math.sin(TAU * ph); break;
      case 'saw': v = 2 * ph - 1 - blep(ph, dt); break;
      case 'sqr': case 'pulse': {
        const w = wave === 'sqr' ? 0.5 : pw;
        v = ph < w ? 1 : -1;
        v += blep(ph, dt);
        let p2 = ph - w; if (p2 < 0) p2 += 1;
        v -= blep(p2, dt);
        break;
      }
      case 'tri': {
        let sq = ph < 0.5 ? 1 : -1; sq += blep(ph, dt); let p2 = ph - 0.5; if (p2 < 0) p2 += 1; sq -= blep(p2, dt);
        tri = tri + sq * 4 * dt; tri *= 0.9995; v = tri; break;
      }
      default: v = 0;
    }
    o[i] = v;
    ph += fr / sr; ph -= Math.floor(ph);
  }
  return o;
}
/** Two-operator FM: carrier freq f, modulator ratio, index (P) */
export function fm(sr: number, n: number, f: P, ratio: number, index: P, fb = 0): Sig {
  const o = zeros(n);
  const fa = typeof f === 'number' ? null : f; const fc = typeof f === 'number' ? f : 0;
  const ia = typeof index === 'number' ? null : index; const ic = typeof index === 'number' ? index : 0;
  let pc = 0, pm = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const fr = fa ? fa[i] : fc; const ix = ia ? ia[i] : ic;
    const m = Math.sin(TAU * pm + fb * last);
    last = m;
    o[i] = Math.sin(TAU * pc + ix * m);
    pc += fr / sr; pm += fr * ratio / sr;
    if (pc > 1e6) { pc -= Math.floor(pc); pm -= Math.floor(pm); }
  }
  return o;
}
/** Band-limited-ish glottal/pulse source: sum of harmonics up to nyquist with rolloff, f per sample. */
export function harmonics(sr: number, n: number, f: P, amps: (k: number) => number, maxK = 40): Sig {
  const o = zeros(n);
  const fa = typeof f === 'number' ? null : f; const fc = typeof f === 'number' ? f : 0;
  let ph = 0; const ny = sr * 0.45;
  const A: number[] = []; for (let k = 1; k <= maxK; k++) A.push(amps(k));
  for (let i = 0; i < n; i++) {
    const fr = fa ? fa[i] : fc;
    let v = 0;
    const kmax = Math.min(maxK, Math.floor(ny / Math.max(1, fr)));
    for (let k = 1; k <= kmax; k++) v += A[k - 1] * Math.sin(TAU * ph * k);
    o[i] = v; ph += fr / sr; ph -= Math.floor(ph);
  }
  return o;
}

// ---------------------------------------------------------------- filters
export type FMode = 'lp' | 'hp' | 'bp' | 'bpn' | 'notch' | 'peak';
/** Topology-preserving state variable filter (Simper). Stable under fast modulation. */
export function svf(x: Sig, sr: number, fc: P, q: P = 0.707, mode: FMode = 'lp', gainDb = 0): Sig {
  const o = zeros(x.length);
  const fa = typeof fc === 'number' ? null : fc; const fcc = typeof fc === 'number' ? fc : 0;
  const qa = typeof q === 'number' ? null : q; const qc = typeof q === 'number' ? q : 0.707;
  let ic1 = 0, ic2 = 0;
  const A = Math.pow(10, gainDb / 20);
  const lim = sr * 0.49;
  let g = Math.tan(Math.PI * Math.min(lim, Math.max(5, fcc)) / sr);
  let lastF = fcc;
  for (let i = 0; i < x.length; i++) {
    if (fa) { const f = fa[Math.min(i, fa.length - 1)]; if (f !== lastF) { lastF = f; g = Math.tan(Math.PI * Math.min(lim, Math.max(5, f)) / sr); } }
    const k = 1 / Math.max(0.05, qa ? qa[i] : qc);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v0 = x[i];
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    let y: number;
    switch (mode) {
      case 'lp': y = v2; break;
      case 'hp': y = v0 - k * v1 - v2; break;
      case 'bp': y = v1; break;
      case 'bpn': y = k * v1; break;
      case 'notch': y = v0 - k * v1; break;
      case 'peak': y = v0 + (A - 1) * k * v1; break;
      default: y = v2;
    }
    o[i] = y;
  }
  return o;
}
export const lp = (x: Sig, sr: number, f: P, q: P = 0.707): Sig => svf(x, sr, f, q, 'lp');
export const hp = (x: Sig, sr: number, f: P, q: P = 0.707): Sig => svf(x, sr, f, q, 'hp');
export const bp = (x: Sig, sr: number, f: P, q: P = 1): Sig => svf(x, sr, f, q, 'bpn');
/** 24 dB/oct lowpass */
export const lp4 = (x: Sig, sr: number, f: P, q = 0.707): Sig => svf(svf(x, sr, f, 0.54), sr, f, q);
export const hp4 = (x: Sig, sr: number, f: P, q = 0.707): Sig => svf(svf(x, sr, f, 0.54, 'hp'), sr, f, q, 'hp');
export function lp1(x: Sig, sr: number, f: number): Sig {
  const o = zeros(x.length); const a = 1 - Math.exp(-TAU * f / sr); let y = 0;
  for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); o[i] = y; }
  return o;
}
export function hp1(x: Sig, sr: number, f: number): Sig {
  const l = lp1(x, sr, f); const o = zeros(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] - l[i]; return o;
}
/** Bank of parallel band-pass resonators (formants / body modes). f per formant may be per-sample. */
export function formants(x: Sig, sr: number, bank: { f: P; q: number; g: number }[]): Sig {
  const o = zeros(x.length);
  for (const b of bank) addInto(o, svf(x, sr, b.f, b.q, 'bpn'), b.g);
  return o;
}

// ---------------------------------------------------------------- nonlinear / misc
export function drive(x: Sig, amt: number, asym = 0): Sig {
  const k = Math.max(0.01, amt); const n = Math.tanh(k);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(k * (x[i] + asym)) / n - (asym ? Math.tanh(k * asym) / n : 0);
  return x;
}
export function foldback(x: Sig, amt: number): Sig { for (let i = 0; i < x.length; i++) x[i] = Math.sin(x[i] * amt); return x; }
export function bitcrushless(x: Sig): Sig { return x; }

/** Damped sinusoid modes. list entries: [freq, amp, tau(s)]; optional per-sample freq multiplier. */
export function modes(sr: number, n: number, list: [number, number, number][], fmul?: Sig, r?: Rng, attack = 0.0005): Sig {
  const o = zeros(n);
  const na = Math.max(1, Math.round(attack * sr));
  for (const [f, a, tau] of list) {
    if (f >= sr * 0.48 || a === 0) continue;
    let ph = r ? r() : 0;
    const k = Math.exp(-1 / (tau * sr));
    let e = 1;
    const len = Math.min(n, Math.ceil(tau * sr * 9));
    for (let i = 0; i < len; i++) {
      const fr = fmul ? f * fmul[i] : f;
      const at = i < na ? i / na : 1;
      o[i] += a * e * at * Math.sin(TAU * ph);
      ph += fr / sr; if (ph > 1) ph -= 1;
      e *= k;
    }
  }
  return o;
}
/** Karplus-Strong plucked string with tuned fractional delay and brightness/decay control. */
export function ks(sr: number, n: number, f: number, t60: number, bright: number, r: Rng, pluckPos = 0.18): Sig {
  const o = zeros(n);
  const period = sr / f;
  const N = Math.max(2, Math.floor(period - 0.5));
  const frac = period - N - 0.5; // averaging filter adds 0.5 sample delay
  const apC = (1 - frac) / (1 + frac);
  const buf = new Float32Array(N);
  // excitation: filtered noise, comb for pluck position
  let y = 0;
  const a = 0.2 + 0.8 * bright;
  for (let i = 0; i < N; i++) { y += a * ((r() * 2 - 1) - y); buf[i] = y; }
  const pp = Math.max(1, Math.round(N * pluckPos));
  const tmp = Float32Array.from(buf);
  for (let i = 0; i < N; i++) buf[i] = tmp[i] - 0.8 * tmp[(i + pp) % N];
  let mean = 0; for (let i = 0; i < N; i++) mean += buf[i]; mean /= N; for (let i = 0; i < N; i++) buf[i] -= mean;
  const loss = Math.pow(10, -3 / (f * t60));
  const s = 0.5 + 0.49 * bright; // lowpass blend
  let idx = 0, prev = 0, apX = 0, apY = 0;
  for (let i = 0; i < n; i++) {
    const cur = buf[idx];
    const avg = s * cur + (1 - s) * prev; prev = cur;
    // allpass fractional delay
    const ap = apC * avg + apX - apC * apY; apX = avg; apY = ap;
    const v = ap * loss;
    buf[idx] = v;
    o[i] = cur;
    idx++; if (idx >= N) idx = 0;
  }
  return o;
}
/** Random impulses (crackle / debris). rate per second may vary (P). Returns impulse train with random amp. */
export function dust(sr: number, n: number, rate: P, r: Rng, ampMin = 0.2, ampMax = 1): Sig {
  const o = zeros(n);
  const ra = typeof rate === 'number' ? null : rate; const rc = typeof rate === 'number' ? rate : 0;
  for (let i = 0; i < n; i++) {
    const p = (ra ? ra[i] : rc) / sr;
    if (r() < p) o[i] = (r() < 0.5 ? -1 : 1) * rr(r, ampMin, ampMax);
  }
  return o;
}
/** Short decaying tone grain (for bubbles, pings, sparkles). */
export function grain(sr: number, f0: number, f1: number, dur: number, tau: number, wave: Wave = 'sin'): Sig {
  const n = secs(sr, dur);
  const f = xenv(sr, n, [0, f0, dur, f1]);
  return mul(osc(sr, n, f, wave), ad(sr, n, 0.0015, tau));
}
/** Sprinkle many grains over a signal */
export function sprinkle(dst: Sig, sr: number, count: number, r: Rng, make: (i: number) => { s: Sig; at: number; g: number }): Sig {
  for (let i = 0; i < count; i++) { const g = make(i); addInto(dst, g.s, g.g, Math.round(g.at * sr)); }
  return dst;
}
/** Feedback echo (same length output). */
export function echo(x: Sig, sr: number, time: number, fb: number, damp = 4000, wet = 0.5): Sig {
  const o = copy(x); const d = Math.max(1, Math.round(time * sr));
  const line = zeros(d); let idx = 0, lpY = 0; const a = 1 - Math.exp(-TAU * damp / sr);
  for (let i = 0; i < x.length; i++) {
    const out = line[idx];
    lpY += a * (out - lpY);
    line[idx] = x[i] + lpY * fb;
    o[i] += out * wet;
    idx++; if (idx >= d) idx = 0;
  }
  return o;
}
/** Allpass-chain decorrelator (for stereo width). */
export function decorrelate(x: Sig, sr: number): Sig {
  let y = x;
  const ds = [0.0047, 0.0071, 0.0113];
  for (const dt of ds) {
    const d = Math.max(1, Math.round(dt * sr)); const g = 0.6; const buf = zeros(d); let idx = 0;
    const o = zeros(y.length);
    for (let i = 0; i < y.length; i++) {
      const bd = buf[idx]; const v = y[i] + g * bd; o[i] = bd - g * v; buf[idx] = v; idx++; if (idx >= d) idx = 0;
    }
    y = o;
  }
  return y;
}
/** Compact Schroeder/Freeverb-ish reverb, used for baking small spaces into textures. Returns stereo. */
export function smallVerb(x: Sig, sr: number, size = 0.7, damp = 0.4, wet = 0.3): { L: Sig; R: Sig } {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const scaleSr = sr / 44100;
  const run = (spread: number): Sig => {
    const o = zeros(x.length);
    for (const c of combs) {
      const d = Math.round((c + spread) * scaleSr); const buf = zeros(d); let idx = 0, f = 0;
      for (let i = 0; i < x.length; i++) {
        const y = buf[idx]; f = y * (1 - damp) + f * damp; buf[idx] = x[i] * 0.015 + f * (0.7 + 0.28 * size); o[i] += y; idx++; if (idx >= d) idx = 0;
      }
    }
    let y = o;
    for (const a of aps) {
      const d = Math.round((a + spread) * scaleSr); const buf = zeros(d); let idx = 0; const out = zeros(y.length);
      for (let i = 0; i < y.length; i++) { const b = buf[idx]; out[i] = -y[i] + b; buf[idx] = y[i] + b * 0.5; idx++; if (idx >= d) idx = 0; }
      y = out;
    }
    return y;
  };
  const L = run(0), R = run(23);
  const oL = copy(x), oR = copy(x);
  scale(oL, 1 - wet * 0.5); scale(oR, 1 - wet * 0.5);
  addInto(oL, L, wet); addInto(oR, R, wet);
  return { L: oL, R: oR };
}
/** Make an Out loop seamlessly: crossfade the tail (xf seconds) into the head. Result is shorter by xf. */
export function seamless(o: Out, xf: number): Out {
  const x = Math.round(xf * o.sr);
  const len = o.n - x;
  const res = new Out(o.sr, len / o.sr);
  for (const [src, dst] of [[o.L, res.L], [o.R, res.R]] as const) {
    for (let i = 0; i < len; i++) dst[i] = src[i];
    for (let i = 0; i < x; i++) {
      const u = i / x; const gIn = Math.sin(u * Math.PI / 2), gOut = Math.cos(u * Math.PI / 2);
      dst[i] = src[i] * gIn + src[len + i] * gOut;
    }
  }
  return res;
}
/** Convert Out to AudioBuffer on any context. */
export function toBuffer(ctx: BaseAudioContext, o: Out): AudioBuffer {
  const b = ctx.createBuffer(2, o.n, o.sr);
  b.copyToChannel(o.L, 0); b.copyToChannel(o.R, 1);
  return b;
}
export function monoBuffer(ctx: BaseAudioContext, x: Sig, sr: number): AudioBuffer {
  const b = ctx.createBuffer(1, x.length, sr); b.copyToChannel(x, 0); return b;
}
