// Locomotion & chocobo sounds.
import { Out, rr, pick, type Sig, type Rng } from '../dsp';
import {
  type Surface, rustle, crunch, clack, splash, thump, burst, metal, creak, whoosh,
  env, xenv, osc, white, svf, mul, addInto, zeros, secs, wander, formants, scale, lp, bell, ad, norm,
} from './layers';
import type { Recipe, RP } from './types';

function surfaceHit(sr: number, r: Rng, s: Surface, w: number): Sig {
  switch (s) {
    case 'grass': {
      const a = rustle(sr, r, 0.16 + 0.1 * w, rr(r, 0.85, 1.1), 1.1 + w * 0.4);
      addInto(a, crunch(sr, r, 0.1, 900, 300, 0.5), 0.25);
      return a;
    }
    case 'dirt': {
      const a = crunch(sr, r, 0.14 + 0.08 * w, rr(r, 1100, 1700), 700 + 500 * w, 0.35);
      addInto(a, burst(sr, r, 0.1, 450, 0.7, 0.002, 0.025, 'pink'), 0.6);
      return a;
    }
    case 'stone': {
      const a = clack(sr, r, rr(r, 1500, 2600), 0.12);
      addInto(a, clack(sr, r, rr(r, 900, 1300), 0.1), 0.5, secs(sr, rr(r, 0.004, 0.012)));
      addInto(a, burst(sr, r, 0.08, 4200, 0.8, 0.001, 0.015), 0.35 * w, secs(sr, 0.01));
      return a;
    }
    case 'water':
      return splash(sr, r, 0.25 + 0.45 * w);
    case 'sand': {
      const a = crunch(sr, r, 0.22 + 0.08 * w, rr(r, 2200, 3000), 1400 + 600 * w, 1);
      addInto(a, burst(sr, r, 0.2, 2600, 0.6, 0.01, 0.06), 0.4);
      return a;
    }
  }
}

export const chocobo_step: Recipe = ({ sr, r, surface }) => {
  const o = new Out(sr, 0.55);
  const soft = surface === 'sand' || surface === 'water' ? 0.7 : surface === 'grass' ? 0.85 : 1;
  o.add(thump(sr, rr(r, 80, 100), rr(r, 40, 48), 0.3, rr(r, 0.045, 0.065), 0.35, r), 0, 1.35 * soft);
  o.add(burst(sr, r, 0.14, 170, 0.7, 0.002, 0.03, 'brown'), 0, 0.9);
  const clawG = { stone: 0.7, dirt: 0.3, grass: 0.12, sand: 0.08, water: 0.05 }[surface];
  let t = rr(r, 0.0, 0.006);
  for (let k = 0; k < 3; k++) {
    o.add(clack(sr, r, rr(r, 3000, 5200), 0.035), t, clawG * rr(r, 0.5, 1), rr(r, -0.3, 0.3));
    t += rr(r, 0.005, 0.012);
  }
  o.addWide(surfaceHit(sr, r, surface, 1.4), 0.004, surface === 'grass' || surface === 'sand' ? 0.55 : 0.8, 0.4);
  if (r() < 0.25) o.add(rustle(sr, r, 0.2, 1.3, 0.6), rr(r, 0.05, 0.12), 0.15, rr(r, -0.5, 0.5));
  return o.clean().normalize(0.95);
};

export const cloud_step: Recipe = ({ sr, r, surface }) => {
  const o = new Out(sr, 0.4);
  const soft = surface === 'sand' || surface === 'grass' ? 0.7 : 1;
  o.add(thump(sr, rr(r, 120, 150), rr(r, 60, 75), 0.14, rr(r, 0.02, 0.03), 0.5, r), 0, 0.7 * soft);
  o.addWide(surfaceHit(sr, r, surface, 0.55), 0, 0.8, 0.3);
  const toe = rr(r, 0.045, 0.075);
  o.addWide(surfaceHit(sr, r, surface, 0.3), toe, 0.45, 0.3);
  if (surface !== 'water' && surface !== 'sand') o.add(clack(sr, r, rr(r, 1800, 2600), 0.04), 0, 0.2);
  if (r() < 0.3) o.add(metal(sr, r, rr(r, 3800, 5200), 0.25, 0.05, 1, 5), rr(r, 0.01, 0.06), 0.06, rr(r, -0.4, 0.4));
  return o.clean().normalize(0.95);
};

export const cloud_land: Recipe = ({ sr, r, surface }) => {
  const o = new Out(sr, 0.9);
  o.add(thump(sr, rr(r, 95, 110), 38, 0.5, 0.09, 0.6, r), 0, 1);
  o.add(burst(sr, r, 0.25, 220, 0.7, 0.002, 0.06, 'brown'), 0, 0.9);
  o.addWide(surfaceHit(sr, r, surface, 2.0), 0, 1, 0.6);
  o.addWide(surfaceHit(sr, r, surface, 0.8), rr(r, 0.05, 0.09), 0.5, 0.6);
  for (let k = 0; k < 4; k++) o.add(metal(sr, r, rr(r, 2800, 5000), 0.3, 0.06, 1, 6), rr(r, 0.005, 0.09), 0.12, rr(r, -0.5, 0.5));
  // buster sword shifting on the back: heavy low clank
  o.add(metal(sr, r, rr(r, 280, 340), 0.6, 0.18, 0.6, 7), rr(r, 0.03, 0.06), 0.18);
  o.addWide(rustle(sr, r, 0.35, 0.5, 1.5), 0.01, 0.35, 0.5);
  return o.clean().normalize(0.95);
};

export const cloth_rustle: Recipe = ({ sr, r }) => {
  const d = rr(r, 0.35, 0.6);
  const o = new Out(sr, d + 0.05);
  o.addWide(rustle(sr, r, d, rr(r, 0.4, 0.55), 1.8), 0, 1, 0.5);
  const n = secs(sr, d);
  const sw = mul(svf(white(n, r), sr, xenv(sr, n, [0, 900, d * 0.5, 1800, d, 1100]), 0.6, 'bpn'), bell(n, 0.4, 1.4));
  o.add(sw, 0, 0.5);
  return o.clean().normalize(0.95);
};

/** Chocobo vocal tract: pulse source + formants + syrinx whistle. */
function birdVoice(sr: number, r: Rng, o: {
  dur: number; f0: number[]; amp: number[]; F1: number[]; F2: number[]; F3: number[]; whistle?: number; breath?: number;
  vib?: number; vibRate?: number; trill?: number; trillRate?: number;
}): Sig {
  const n = secs(sr, o.dur);
  const f = xenv(sr, n, o.f0);
  const jit = wander(sr, n, 25, r);
  const vib = o.vib ?? 0.01;
  const vr = o.vibRate ?? 6;
  for (let i = 0; i < n; i++) f[i] *= 1 + 0.012 * jit[i] + vib * Math.sin(2 * Math.PI * vr * i / sr);
  const src = osc(sr, n, f, 'pulse', 0, 0.28);
  addInto(src, osc(sr, n, f, 'saw', 0.2), 0.6);
  addInto(src, white(n, r), o.breath ?? 0.08);
  const F1 = xenv(sr, n, o.F1), F2 = xenv(sr, n, o.F2), F3 = xenv(sr, n, o.F3);
  const v = formants(src, sr, [{ f: F1, q: 4, g: 1 }, { f: F2, q: 7, g: 0.9 }, { f: F3, q: 9, g: 0.5 }, { f: 3900, q: 6, g: 0.15 }]);
  // syrinx whistle: pure 2nd harmonic gives the "bird" quality
  const wh = osc(sr, n, f.map((x) => x * 2) as Sig, 'sin');
  addInto(v, wh, o.whistle ?? 0.25);
  const a = env(sr, n, o.amp, 1.2);
  if (o.trill) {
    const tr = o.trillRate ?? 26;
    for (let i = 0; i < n; i++) a[i] *= 1 - o.trill * (0.5 + 0.5 * Math.sin(2 * Math.PI * tr * i / sr));
  }
  mul(v, a);
  return norm(v, 1);
}

function kwehCall(sr: number, r: Rng, ps: number, at: number, o: Out, gain: number): void {
  const k = burst(sr, r, 0.03, 2900, 1.8, 0.001, 0.006);
  o.add(k, at, 0.35 * gain);
  const d = rr(r, 0.3, 0.38);
  const peak = rr(r, 0.1, 0.14);
  const v = birdVoice(sr, r, {
    dur: d,
    f0: [0, 400 * ps, 0.035, 610 * ps, peak, 660 * ps, d * 0.7, 540 * ps, d, 330 * ps],
    amp: [0, 0, 0.018, 1, peak + 0.03, 0.95, d * 0.75, 0.55, d, 0],
    F1: [0, 330, 0.05, 620, d, 560],
    F2: [0, 820, 0.06, 1850 * rr(r, 0.95, 1.08), d, 1650],
    F3: [0, 2400, 0.06, 2750, d, 2600],
    whistle: rr(r, 0.2, 0.35), vib: 0.012, vibRate: rr(r, 5, 8),
  });
  o.addWide(v, at + 0.016, gain, 0.15);
}

export const chocobo_kweh: Recipe = ({ sr, r, variant }) => {
  if (variant === 1) return chocoboHappy(sr, r);
  const o = new Out(sr, 0.5);
  kwehCall(sr, r, rr(r, 0.92, 1.12), 0, o, 1);
  return o.clean().normalize(0.95);
};

function chocoboHappy(sr: number, r: Rng): Out {
  const o = new Out(sr, 1.2);
  const ps = rr(r, 0.95, 1.1);
  kwehCall(sr, r, ps, 0, o, 1);
  // happy "weh-eh-eh" rolling warble
  const d = 0.7;
  const n = secs(sr, d);
  const syl = 4;
  const amp: number[] = [];
  for (let s = 0; s < syl; s++) {
    const t0 = s * d / syl; const t1 = t0 + d / syl;
    amp.push(t0, 0.05, t0 + 0.02, 1 - s * 0.12, t1 - 0.03, 0.5, t1 - 0.005, 0.05);
  }
  const v = birdVoice(sr, r, {
    dur: d,
    f0: [0, 520 * ps, d * 0.5, 640 * ps, d, 700 * ps],
    amp, F1: [0, 600, d, 520], F2: [0, 1900, d * 0.5, 2200, d, 2000], F3: [0, 2700, d, 2900],
    vib: 0.08, vibRate: 11, whistle: 0.3,
  });
  o.addWide(v, 0.33, 0.8, 0.2);
  return o.clean().normalize(0.95);
}

export const chocobo_warble: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.9);
  const ps = rr(r, 0.92, 1.1);
  const purr = birdVoice(sr, r, {
    dur: 0.38, f0: [0, 250 * ps, 0.38, 290 * ps], amp: [0, 0, 0.04, 0.8, 0.3, 0.7, 0.38, 0],
    F1: [0, 420, 0.38, 480], F2: [0, 1150, 0.38, 1300], F3: [0, 2400, 0.38, 2500], trill: 0.85, trillRate: rr(r, 24, 30), whistle: 0.1, breath: 0.12,
  });
  o.add(purr, 0, 0.7);
  const weh = birdVoice(sr, r, {
    dur: 0.28, f0: [0, 380 * ps, 0.12, 610 * ps, 0.28, 520 * ps], amp: [0, 0, 0.02, 1, 0.2, 0.6, 0.28, 0],
    F1: [0, 380, 0.1, 600, 0.28, 560], F2: [0, 900, 0.1, 1900, 0.28, 1800], F3: [0, 2500, 0.28, 2800], whistle: 0.3,
  });
  o.addWide(weh, 0.36, 0.9, 0.15);
  return o.clean().normalize(0.95);
};

export const chocobo_wing_flap: Recipe = ({ sr, r }) => {
  const flaps = r() < 0.6 ? 2 : 1;
  const o = new Out(sr, 0.35 + flaps * 0.16);
  for (let k = 0; k < flaps; k++) {
    const at = k * rr(r, 0.14, 0.18);
    const d = rr(r, 0.14, 0.2);
    const n = secs(sr, d);
    const air = mul(svf(white(n, r), sr, xenv(sr, n, [0, 350, d * 0.4, 700, d, 300]), 0.8, 'bpn'), bell(n, 0.35, 1.5));
    o.add(air, at, 1.0);
    o.add(lp(mul(white(n, r), bell(n, 0.35, 2)), sr, 220), at, 1.2);
    o.addWide(rustle(sr, r, d + 0.08, 1.25, 2.2), at + 0.01, 0.55, 0.5);
  }
  return o.clean().normalize(0.95);
};

export const mount: Recipe = (p) => {
  const { sr, r } = p;
  const o = new Out(sr, 1.3);
  o.mix(cloth_rustle(p), 0, 0.6);
  o.add(creak(sr, r, 0.45, rr(r, 35, 50), rr(r, 18, 28), rr(r, 800, 1100)), 0.33, 0.45);
  o.add(thump(sr, 110, 60, 0.25, 0.05, 0.3, r), 0.38, 0.5);
  o.add(metal(sr, r, rr(r, 3500, 4500), 0.3, 0.06, 1, 5), 0.4, 0.12, 0.3);
  const small = new Out(sr, 0.5);
  kwehCall(sr, r, rr(r, 0.85, 0.95), 0, small, 1);
  o.mix(small, 0.62, 0.25);
  return o.clean().normalize(0.95);
};

export const dismount_jump: Recipe = (p) => {
  const { sr, r } = p;
  const o = new Out(sr, 0.7);
  o.addWide(whoosh(sr, r, { dur: 0.4, f0: 300, f1: 450, fMid: 1100, q: 1.0, peakAt: 0.4 }), 0.05, 0.9, 0.3);
  o.mix(cloth_rustle(p), 0, 0.5);
  o.add(creak(sr, r, 0.2, 40, 60, 900), 0, 0.3);
  o.addWide(rustle(sr, r, 0.25, 1.3, 1.5), 0.08, 0.2, 0.5);
  return o.clean().normalize(0.95);
};

export { pick, ad, scale, zeros };
