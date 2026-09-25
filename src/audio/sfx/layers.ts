// Reusable synthesis layers for sound-effect recipes (pure JS DSP).
import {
  type Sig, type Rng, type P, zeros, secs, white, pink, brown, env, xenv, ad, bell, osc, svf, bp, lp, hp,
  mul, addInto, scale, drive, modes, dust, grain, wander, rr, ri, clamp, norm, TAU, lp1, formants,
} from '../dsp';

export type Surface = 'grass' | 'dirt' | 'stone' | 'water' | 'sand';

/** Air whoosh: band-passed noise with a moving center and a bell envelope. */
export function whoosh(sr: number, r: Rng, o: {
  dur: number; f0: number; f1: number; fMid?: number; q?: number; peakAt?: number; low?: number; tone?: number; pow?: number; bright?: number;
}): Sig {
  const n = secs(sr, o.dur);
  const pk = o.peakAt ?? 0.45;
  const fm = o.fMid ?? Math.sqrt(o.f0 * o.f1) * 1.6;
  const fc = xenv(sr, n, [0, o.f0, o.dur * pk, fm, o.dur, o.f1]);
  const q = o.q ?? 1.2;
  const src = pink(n, r);
  const a = svf(src, sr, fc, q, 'bpn');
  const air = svf(white(n, r), sr, fc.map((v) => Math.min(sr * 0.45, v * 2.4)) as Sig, 0.7, 'bpn');
  addInto(a, air, 0.35 * (o.bright ?? 1));
  const e = bell(n, pk, o.pow ?? 1.6);
  // subtle turbulence flutter
  const w = wander(sr, n, 38, r);
  for (let i = 0; i < n; i++) a[i] *= e[i] * (1 + 0.25 * w[i]);
  if (o.low) {
    const body = lp(brown(n, r), sr, xenv(sr, n, [0, 90, o.dur * pk, 220, o.dur, 70]), 0.9);
    const eb = bell(n, pk * 0.9, 2);
    for (let i = 0; i < n; i++) a[i] += body[i] * eb[i] * o.low * 2.2;
  }
  if (o.tone) {
    // blade "hum": a faint pitched component swept with doppler
    const f = xenv(sr, n, [0, 170, o.dur * pk, 260, o.dur, 150]);
    const t = osc(sr, n, f, 'tri');
    const et = bell(n, pk, 3);
    for (let i = 0; i < n; i++) a[i] += t[i] * et[i] * o.tone * 0.3;
  }
  return a;
}

/** Pitched body thump (kick-drum like). */
export function thump(sr: number, f0: number, f1: number, dur: number, tau: number, click = 0.3, r?: Rng): Sig {
  const n = secs(sr, dur);
  const f = xenv(sr, n, [0, f0, Math.min(dur, tau * 1.5), f1, dur, f1 * 0.9]);
  const s = mul(osc(sr, n, f, 'sin'), ad(sr, n, 0.0012, tau));
  if (click > 0 && r) {
    const c = svf(white(secs(sr, 0.012), r), sr, 1800, 0.8, 'lp');
    const ce = ad(sr, c.length, 0.0003, 0.0025);
    mul(c, ce); addInto(s, c, click);
  }
  return s;
}

/** Sub boom sweep */
export function subBoom(sr: number, f0: number, f1: number, dur: number, tau: number): Sig {
  const n = secs(sr, dur);
  const f = xenv(sr, n, [0, f0, dur * 0.6, f1, dur, f1 * 0.85]);
  const s = osc(sr, n, f, 'sin');
  const s2 = osc(sr, n, f.map((v) => v * 2) as Sig, 'sin');
  addInto(s, s2, 0.18);
  return mul(s, ad(sr, n, 0.004, tau));
}

/** Noise burst through a band. */
export function burst(sr: number, r: Rng, dur: number, fc: P, q: number, attack: number, tau: number, kind: 'white' | 'pink' | 'brown' = 'white'): Sig {
  const n = secs(sr, dur);
  const src = kind === 'white' ? white(n, r) : kind === 'pink' ? pink(n, r) : brown(n, r);
  return mul(svf(src, sr, fc, q, 'bpn'), ad(sr, n, attack, tau));
}

/** Foliage/grass rustle made of irregular friction grains. */
export function rustle(sr: number, r: Rng, dur: number, bright = 1, density = 1): Sig {
  const n = secs(sr, dur);
  const src = white(n, r);
  const a = svf(src, sr, 3200 * bright, 0.7, 'bpn');
  addInto(a, svf(src, sr, 7000 * Math.min(1.2, bright), 1.2, 'bpn'), 0.5);
  // grain envelope: sum of short random blips
  const g = zeros(n);
  const count = Math.round(dur * 70 * density);
  for (let i = 0; i < count; i++) {
    const at = Math.round(Math.pow(r(), 1.4) * n * 0.9); const len = Math.round(rr(r, 0.004, 0.025) * sr); const amp = rr(r, 0.3, 1);
    for (let j = 0; j < len && at + j < n; j++) g[at + j] += amp * Math.sin(Math.PI * j / len);
  }
  const e = env(sr, n, [0, 0, 0.006, 1, dur * 0.35, 0.6, dur, 0], 1.5);
  for (let i = 0; i < n; i++) a[i] *= Math.min(1.4, g[i]) * e[i];
  return a;
}

/** Granular crunch (dirt, gravel, sand). */
export function crunch(sr: number, r: Rng, dur: number, fc: number, rate: number, soft = 0): Sig {
  const n = secs(sr, dur);
  const d = dust(sr, n, env(sr, n, [0, rate, dur * 0.4, rate * 0.6, dur, 0]), r, 0.2, 1);
  const a = zeros(n);
  addInto(a, svf(d, sr, fc, 1.6, 'bpn'), 3);
  addInto(a, svf(d, sr, fc * 2.1, 2.2, 'bpn'), 1.8);
  const nb = mul(svf(white(n, r), sr, fc * 0.8, 0.8, 'bpn'), ad(sr, n, 0.002, dur * (0.15 + soft * 0.35)));
  addInto(a, nb, 0.5 + soft);
  const e = env(sr, n, [0, 1, dur * 0.7, 0.5, dur, 0]);
  return mul(a, e);
}

/** Hard, resonant surface clack (stone). */
export function clack(sr: number, r: Rng, f: number, dur = 0.12): Sig {
  const n = secs(sr, dur);
  const m = modes(sr, n, [[f, 1, 0.018], [f * 1.63, 0.7, 0.012], [f * 2.41, 0.5, 0.009], [f * 3.3, 0.35, 0.006]], undefined, r);
  const c = mul(svf(white(n, r), sr, f * 2, 1, 'bpn'), ad(sr, n, 0.0003, 0.004));
  addInto(m, c, 0.8);
  return m;
}

/** Water splash with bubbles; size 0..3 (small footstep .. huge). */
export function splash(sr: number, r: Rng, size: number, dur?: number): Sig {
  const D = dur ?? 0.25 + size * 0.7;
  const n = secs(sr, D);
  const a = zeros(n);
  // main body: descending band noise
  const fc = xenv(sr, n, [0, 3200 - size * 500, D * 0.3, 1400 - size * 250, D, 700 - size * 120]);
  const body = mul(svf(white(n, r), sr, fc, 0.9, 'bpn'), env(sr, n, [0, 0, 0.004 + size * 0.01, 1, D * 0.25, 0.45, D, 0], 2.2));
  addInto(a, body, 1);
  // wash (pink, lower)
  if (size > 0.4) {
    const w = mul(lp(pink(n, r), sr, 900 + size * 300, 0.7), env(sr, n, [0, 0, 0.02, 1, D * 0.5, 0.5, D, 0], 2));
    addInto(a, w, 0.5 * size);
  }
  // bubbles & droplets
  const nb = Math.round(6 + size * 30);
  for (let i = 0; i < nb; i++) {
    const at = Math.pow(r(), 1.3) * D * 0.85;
    const f0 = rr(r, 500, 1400) * (1 - size * 0.12); const f1 = f0 * rr(r, 1.3, 2.4);
    const g = grain(sr, f0, f1, rr(r, 0.02, 0.06), rr(r, 0.008, 0.02));
    addInto(a, g, rr(r, 0.15, 0.5) * (1 - at / D * 0.6), Math.round(at * sr));
  }
  // plop
  const pl = thump(sr, 260 - size * 50, 90 - size * 20, 0.12 + size * 0.1, 0.03 + size * 0.03);
  addInto(a, pl, 0.35 + size * 0.2);
  return a;
}

/** Metallic inharmonic ring (swords, armor, clang). */
export function metal(sr: number, r: Rng, f0: number, dur: number, tau: number, bright = 1, count = 9): Sig {
  const n = secs(sr, dur);
  const ratios = [1, 1.47, 2.09, 2.56, 3.18, 3.92, 4.61, 5.4, 6.3, 7.1, 8.3];
  const list: [number, number, number][] = [];
  for (let i = 0; i < Math.min(count, ratios.length); i++) {
    const f = f0 * ratios[i] * rr(r, 0.985, 1.015);
    list.push([f, (1 / (1 + i * 0.5)) * (i > 3 ? bright : 1) * rr(r, 0.6, 1), tau * rr(r, 0.6, 1.2) / (1 + i * 0.18)]);
    // beating pair
    list.push([f * rr(r, 1.002, 1.006), list[list.length - 1][1] * 0.5, list[list.length - 1][2]]);
  }
  return modes(sr, n, list, undefined, r, 0.0004);
}

/** Rock/stone crack: short broadband with resonances. */
export function rockCrack(sr: number, r: Rng, dur: number, fc = 1400): Sig {
  const n = secs(sr, dur);
  const d = dust(sr, n, env(sr, n, [0, 6000, 0.01, 2000, dur, 0]), r, 0.3, 1);
  const a = svf(d, sr, fc, 1.2, 'bpn'); scale(a, 3);
  addInto(a, svf(d, sr, fc * 2.3, 1.5, 'bpn'), 2);
  const nb = mul(svf(white(n, r), sr, fc * 1.2, 0.8, 'bpn'), ad(sr, n, 0.0005, dur * 0.12));
  addInto(a, nb, 1.2);
  return a;
}

/** Low rumble with rolling amplitude bumps. */
export function rumble(sr: number, r: Rng, dur: number, cutoff: number, rollRate = 2, attack = 0.05, tail = 0.5): Sig {
  const n = secs(sr, dur);
  const a = lp4(brown(n, r), sr, cutoff);
  const w = wander(sr, n, rollRate, r);
  const e = env(sr, n, [0, 0, attack, 1, dur * tail, 0.55, dur, 0], 1.8);
  for (let i = 0; i < n; i++) a[i] *= e[i] * (0.6 + 0.4 * w[i]);
  return a;
}
function lp4(x: Sig, sr: number, f: number): Sig { return svf(svf(x, sr, f, 0.54), sr, f, 0.707); }

/** Falling debris: many small rock clicks with resonances + low rumble. */
export function debris(sr: number, r: Rng, dur: number, density: number, low = 0.5, bright = 1): Sig {
  const n = secs(sr, dur);
  const a = zeros(n);
  const count = Math.round(dur * density);
  for (let i = 0; i < count; i++) {
    const at = Math.pow(r(), 0.8) * dur * 0.92;
    const f = rr(r, 500, 3800) * bright;
    const big = r() < 0.2;
    const c = clack(sr, r, f * (big ? 0.5 : 1), big ? 0.12 : 0.05);
    addInto(a, c, rr(r, 0.1, 0.6) * (big ? 1.4 : 1) * (1 - 0.6 * at / dur), Math.round(at * sr));
    if (big && r() < 0.5) addInto(a, thump(sr, 140, 60, 0.12, 0.03), 0.3, Math.round(at * sr));
  }
  if (low > 0) addInto(a, rumble(sr, r, dur, 120, 3, 0.05, 0.35), low);
  // fine gravel hiss
  const g = mul(svf(dust(sr, n, env(sr, n, [0, 1200, dur, 100]), r, 0.05, 0.4), sr, 3500 * bright, 0.8, 'bpn'), env(sr, n, [0, 1, dur, 0]));
  addInto(a, g, 1.2);
  return a;
}

/** Crackle (embers, fire, electricity). */
export function crackle(sr: number, r: Rng, dur: number, rate: P, fc = 3000, q = 0.8): Sig {
  const n = secs(sr, dur);
  const d = dust(sr, n, rate, r, 0.05, 1);
  // each impulse slightly smeared
  const s = svf(d, sr, fc, q, 'bpn');
  addInto(s, svf(d, sr, fc * 2.5, 1.2, 'bpn'), 0.6);
  return scale(s, 2.2);
}

/** Fire roar body: turbulent low-mid noise. */
export function fireRoar(sr: number, r: Rng, dur: number, cutoff = 1400, turbulence = 0.6): Sig {
  const n = secs(sr, dur);
  const a = svf(pink(n, r), sr, cutoff, 0.6, 'lp');
  addInto(a, svf(brown(n, r), sr, 300, 0.7, 'lp'), 0.9);
  const w1 = wander(sr, n, 9, r), w2 = wander(sr, n, 23, r);
  for (let i = 0; i < n; i++) a[i] *= 1 + turbulence * (0.6 * w1[i] + 0.4 * w2[i]);
  return a;
}

/** Sparkles: many short bright sine pings. */
export function sparkle(sr: number, r: Rng, dur: number, count: number, fLo: number, fHi: number, rise = 1.0): Sig {
  const n = secs(sr, dur);
  const a = zeros(n);
  for (let i = 0; i < count; i++) {
    const at = r() * dur * 0.9;
    const u = at / dur;
    const f = rr(r, fLo, fHi) * (1 + (rise - 1) * u);
    const g = grain(sr, f, f * rr(r, 0.998, 1.02), rr(r, 0.05, 0.25), rr(r, 0.02, 0.08));
    addInto(a, g, rr(r, 0.1, 0.5), Math.round(at * sr));
  }
  return a;
}

/** Bell / chime tone with inharmonic partials. kind: 'bell' | 'glass' | 'chime' */
export function chime(sr: number, r: Rng, f: number, dur: number, tau: number, kind: 'bell' | 'glass' | 'chime' | 'soft' = 'chime'): Sig {
  const n = secs(sr, dur);
  const sets: Record<string, [number, number, number][]> = {
    bell: [[0.5, 0.5, 1.4], [1, 1, 1], [1.19, 0.5, 0.8], [1.5, 0.45, 0.6], [2, 0.5, 0.5], [2.74, 0.3, 0.35], [3.76, 0.2, 0.25], [5.0, 0.12, 0.15]],
    glass: [[1, 1, 1], [2.32, 0.5, 0.5], [4.25, 0.3, 0.3], [6.63, 0.2, 0.18], [9.38, 0.1, 0.1]],
    chime: [[1, 1, 1], [2.0, 0.25, 0.5], [3.01, 0.18, 0.3], [4.17, 0.12, 0.18], [5.43, 0.06, 0.1]],
    soft: [[1, 1, 1], [2, 0.12, 0.4], [3, 0.05, 0.2]],
  };
  const list: [number, number, number][] = sets[kind].map(([m, a, t]) => [f * m, a, tau * t] as [number, number, number]);
  // slight detuned pair for shimmer
  list.push([f * 1.003, 0.35, tau * 0.9]);
  return modes(sr, n, list, undefined, r, 0.0008);
}

/** Electrical zap/crackle with FM buzz. */
export function zap(sr: number, r: Rng, dur: number, f0: number, f1: number): Sig {
  const n = secs(sr, dur);
  const f = xenv(sr, n, [0, f0, dur, f1]);
  const w = wander(sr, n, 90, r);
  for (let i = 0; i < n; i++) f[i] *= 1 + 0.35 * w[i];
  const s = osc(sr, n, f, 'saw');
  const buzz = osc(sr, n, f.map((v) => v * 0.13) as Sig, 'sqr');
  for (let i = 0; i < n; i++) s[i] *= 0.6 + 0.4 * buzz[i];
  const c = crackle(sr, r, dur, 900, 4200, 0.7);
  addInto(s, c, 0.6);
  return svf(s, sr, 6000, 0.7, 'lp');
}

/** Thunder: crack + rolling rumble. distance 0 (close) .. 1 (far). */
export function thunder(sr: number, r: Rng, dur: number, distance: number): Sig {
  const n = secs(sr, dur);
  const a = zeros(n);
  const near = 1 - distance;
  // crack: cluster of impulses shaped by high band noise
  if (near > 0.05) {
    const cn = secs(sr, 0.35);
    const cr = white(cn, r);
    const ce = zeros(cn);
    for (let k = 0; k < 7; k++) {
      const at = Math.round(Math.pow(r(), 1.5) * 0.08 * sr); const tau = rr(r, 0.004, 0.03) * sr; const amp = rr(r, 0.5, 1);
      for (let i = at; i < cn; i++) ce[i] += amp * Math.exp(-(i - at) / tau);
    }
    const crk = mul(svf(cr, sr, 2500 + near * 2500, 0.5, 'lp'), ce);
    drive(crk, 1.8);
    addInto(a, crk, near * 0.9);
    // tearing mid layer
    const tear = mul(svf(white(secs(sr, 0.9), r), sr, xenv(sr, secs(sr, 0.9), [0, 3000, 0.9, 600]), 0.8, 'bpn'), env(sr, secs(sr, 0.9), [0, 0, 0.01, 1, 0.9, 0], 2.5));
    addInto(a, tear, near * 0.6, Math.round(0.01 * sr));
  }
  // rolling rumble: multiple bumps
  const cutoff = 110 + near * 380;
  const base = svf(svf(brown(n, r), sr, cutoff, 0.6), sr, cutoff * 1.4, 0.6);
  addInto(base, svf(pink(n, r), sr, 300 + near * 900, 0.6, 'lp'), 0.25 + near * 0.3);
  const rollEnv = zeros(n);
  const bumps = ri(r, 4, 8);
  for (let k = 0; k < bumps; k++) {
    const at = (k === 0 ? rr(r, 0.02, 0.15) + distance * 0.4 : rr(r, 0.2, dur * 0.7)) * sr;
    const rise = rr(r, 0.05, 0.4) * sr, fall = rr(r, 0.5, 2.2) * sr;
    const amp = k === 0 ? 1 : rr(r, 0.3, 0.8);
    for (let i = Math.max(0, Math.round(at - rise)); i < n; i++) {
      const t = i - at;
      rollEnv[i] += amp * (t < 0 ? 1 + t / rise : Math.exp(-t / fall));
    }
  }
  const tailEnv = env(sr, n, [0, 1, dur * 0.8, 0.5, dur, 0]);
  for (let i = 0; i < n; i++) a[i] += base[i] * Math.min(1.6, rollEnv[i]) * tailEnv[i] * 1.4;
  return a;
}

/** Explosion core: sub drop + broadband blast + distortion. size ~1..3 */
export function explosion(sr: number, r: Rng, dur: number, size: number): Sig {
  const n = secs(sr, dur);
  const a = zeros(n);
  addInto(a, subBoom(sr, 70 + 20 / size, 28, dur, 0.35 * size), 1.1);
  const blast = mul(svf(white(n, r), sr, xenv(sr, n, [0, 5000, 0.08, 1800, dur, 250]), 0.6, 'lp'), env(sr, n, [0, 0, 0.004, 1, 0.1, 0.5, dur, 0], 2.5));
  addInto(a, blast, 0.9);
  const body = mul(svf(brown(n, r), sr, 400, 0.7, 'lp'), env(sr, n, [0, 0, 0.01, 1, dur * 0.4, 0.4, dur, 0], 2));
  addInto(a, body, 0.9);
  drive(a, 1.6);
  return a;
}

/** Creature vocalization synthesis (growls, roars, yelps). */
export interface VoiceOpts {
  dur: number;
  f0: number[];            // xenv breakpoints [t, hz, ...]
  amp: number[];           // env breakpoints
  formant: number[];       // formant scale over time breakpoints [t, scale]  (1 = 'aah' of a large animal)
  size?: number;           // formant base multiplier (smaller = bigger creature)
  rough?: number;          // 0..1 AM roughness
  sub?: number;            // subharmonic amount
  breath?: number;         // noise amount
  jitter?: number;         // pitch jitter
  drive?: number;
  layers?: number;         // unison layers
  vowel?: 'a' | 'o' | 'e' | 'u' | 'i';
  hiss?: number;           // high-frequency hiss layer (serpents)
}
const VOWELS: Record<string, [number, number, number, number]> = {
  a: [750, 1150, 2500, 3400],
  o: [480, 800, 2400, 3300],
  u: [330, 650, 2300, 3200],
  e: [550, 1750, 2500, 3500],
  i: [320, 2200, 2900, 3700],
};
export function creature(sr: number, r: Rng, o: VoiceOpts): Sig {
  const n = secs(sr, o.dur);
  const out = zeros(n);
  const layers = o.layers ?? 2;
  const size = o.size ?? 0.8;
  const V = VOWELS[o.vowel ?? 'a'];
  const fsc = env(sr, n, o.formant);
  const ampE = env(sr, n, o.amp, 1.3);
  for (let L = 0; L < layers; L++) {
    const det = L === 0 ? 1 : rr(r, 0.93, 1.08);
    const f = xenv(sr, n, o.f0);
    const jit = wander(sr, n, rr(r, 18, 35), r);
    const jit2 = wander(sr, n, rr(r, 3, 6), r);
    const J = o.jitter ?? 0.04;
    for (let i = 0; i < n; i++) f[i] *= det * (1 + J * jit[i] + J * 1.5 * jit2[i]);
    const src = osc(sr, n, f, 'saw');
    addInto(src, osc(sr, n, f, 'pulse', 0.3, 0.3), 0.5);
    if (o.sub) {
      const half = f.map((v) => v * 0.5) as Sig;
      addInto(src, osc(sr, n, half, 'saw', 0.1), o.sub);
    }
    if (o.rough) {
      const am = wander(sr, n, rr(r, 45, 80), r);
      const am2 = osc(sr, n, f.map((v) => v * 0.5) as Sig, 'sin');
      for (let i = 0; i < n; i++) src[i] *= 1 - o.rough * (0.4 + 0.3 * am[i] + 0.3 * am2[i]);
    }
    const br = white(n, r);
    for (let i = 0; i < n; i++) src[i] += br[i] * (o.breath ?? 0.3) * 1.2;
    const bank = V.map((vf, k) => {
      const fr = zeros(n); for (let i = 0; i < n; i++) fr[i] = vf * size * fsc[i] * (L === 0 ? 1 : rr(r, 0.97, 1.03));
      return { f: fr, q: [5, 7, 9, 10][k], g: [1, 0.75, 0.35, 0.2][k] };
    });
    const v = formants(src, sr, bank);
    addInto(v, lp(src, sr, 400 * size, 0.7), 0.35);
    addInto(out, v, L === 0 ? 1 : 0.6);
  }
  norm(out, 1);
  if (o.hiss) {
    const h = svf(white(n, r), sr, 4200, 1.2, 'bpn');
    addInto(h, svf(white(n, r), sr, 7000, 1.5, 'bpn'), 0.4);
    const hw = wander(sr, n, 18, r);
    for (let i = 0; i < n; i++) h[i] *= 0.7 + 0.3 * hw[i];
    addInto(out, h, o.hiss * 0.35);
  }
  mul(out, ampE);
  norm(out, 1);
  if (o.drive) drive(out, o.drive);
  return out;
}

/** Stick-slip creak (leather, wood, ice). */
export function creak(sr: number, r: Rng, dur: number, rate0: number, rate1: number, fc: number, q = 6): Sig {
  const n = secs(sr, dur);
  const rate = xenv(sr, n, [0, rate0, dur, rate1]);
  const w = wander(sr, n, 12, r);
  const pulses = zeros(n);
  let ph = 0;
  for (let i = 0; i < n; i++) { ph += rate[i] * (1 + 0.4 * w[i]) / sr; if (ph >= 1) { ph -= 1; pulses[i] = rr(r, 0.5, 1); } }
  const a = svf(pulses, sr, fc, q, 'bpn');
  addInto(a, svf(pulses, sr, fc * 2.2, q, 'bpn'), 0.5);
  scale(a, 4);
  return mul(a, bell(n, 0.4, 1));
}

/** Rising tonal riser: stacked saws with filter sweep. */
export function riser(sr: number, r: Rng, dur: number, f0: number, f1: number, voices = 5, cutoff0 = 400, cutoff1 = 8000): Sig {
  const n = secs(sr, dur);
  const a = zeros(n);
  const f = xenv(sr, n, [0, f0, dur, f1]);
  for (let v = 0; v < voices; v++) {
    const mult = [1, 1.5, 2, 3, 4, 0.5, 2.5][v % 7] * rr(r, 0.994, 1.006);
    addInto(a, osc(sr, n, f.map((x) => x * mult) as Sig, 'saw', r()), 1 / (1 + v * 0.4));
  }
  const lpd = svf(a, sr, xenv(sr, n, [0, cutoff0, dur, cutoff1]), 1.4, 'lp');
  const ns = svf(white(n, r), sr, xenv(sr, n, [0, cutoff0 * 2, dur, Math.min(sr * 0.4, cutoff1 * 1.4)]), 1.1, 'bpn');
  addInto(lpd, ns, 0.6);
  return mul(lpd, env(sr, n, [0, 0, dur * 0.95, 1, dur, 0], 2.2));
}

export { lp1, TAU, clamp, hp, bp, lp, env, xenv, ad, osc, white, pink, brown, svf, mul, addInto, scale, zeros, secs, drive, modes, dust, grain, wander, bell, norm, rr, ri, formants };
