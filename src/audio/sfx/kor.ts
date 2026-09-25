// Limit Break & Knights of the Round summon sounds.
import { Out, rr, ri, mtof, type Rng, type Sig } from '../dsp';
import {
  whoosh, thump, subBoom, explosion, rockCrack, debris, rumble, burst, metal, chime, sparkle, fireRoar, crackle,
  zap, thunder, riser, creak, splash, clack, crunch,
  env, xenv, osc, white, pink, brown, svf, mul, addInto, zeros, secs, wander, bell, ad, drive, lp, hp, norm, scale,
} from './layers';
import { thunder_strike, ice_shatter, fire_explode } from './magic';
import type { Recipe, RP } from './types';

export const heartbeat: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.75);
  const beat = (at: number, g: number, f: number): void => {
    o.add(thump(sr, f, f * 0.7, 0.3, 0.06, 0.1, r), at, g);
    o.add(lp(burst(sr, r, 0.12, 90, 0.7, 0.004, 0.03, 'brown'), sr, 160), at, g * 0.8);
  };
  beat(0, 1, rr(r, 58, 64));
  beat(rr(r, 0.2, 0.24), 0.75, rr(r, 50, 56));
  return o.clean().normalize(0.95);
};

export const limit_activate: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 4.2);
  const pre = 0.45;
  const n = secs(sr, pre);
  const up = mul(svf(white(n, r), sr, xenv(sr, n, [0, 400, pre, 7000]), 1.5, 'bpn'), env(sr, n, [0, 0, pre, 1], 2.5));
  o.addWide(up, 0, 0.7, 0.6);
  o.add(subBoom(sr, 110, 30, 2.4, 0.5), pre, 1.1);
  o.addWide(explosion(sr, r, 1.5, 1.2), pre, 0.5, 0.5);
  // bright chord stab (D major add9) with fast filter decay
  const ns = secs(sr, 2.2);
  const ch = zeros(ns);
  for (const m of [50, 57, 62, 66, 69, 74, 76]) for (const dt of [0.997, 1.003]) addInto(ch, osc(sr, ns, mtof(m) * dt, 'saw', r()), 0.12);
  const stab = mul(svf(ch, sr, xenv(sr, ns, [0, 9000, 0.3, 2500, 2.2, 600]), 1.1, 'lp'), env(sr, ns, [0, 0, 0.005, 1, 0.4, 0.5, 2.2, 0], 1.6));
  o.addWide(stab, pre, 0.6, 0.7);
  o.addWide(metal(sr, r, 1250, 2.5, 0.9, 1.2, 10), pre, 0.35, 0.5);
  o.addWide(sparkle(sr, r, 2.5, 80, 3000, 10000, 1.2), pre, 0.35, 1);
  o.addWide(whoosh(sr, r, { dur: 1.2, f0: 2000, f1: 300, fMid: 3500, q: 0.8, peakAt: 0.1, pow: 1.5, low: 0.8 }), pre, 0.5, 0.8);
  return o.clean().normalize(0.98);
};

export const wind_gust_big: Recipe = ({ sr, r }) => {
  const d = rr(r, 2.8, 3.4);
  const o = new Out(sr, d);
  const n = secs(sr, d);
  const pk = rr(r, 0.35, 0.5);
  const g = svf(pink(n, r), sr, xenv(sr, n, [0, 300, d * pk, rr(r, 800, 1100), d, 350]), 0.7, 'bpn');
  const wv = wander(sr, n, 3, r);
  const e = bell(n, pk, 1.3);
  for (let i = 0; i < n; i++) g[i] *= e[i] * (0.8 + 0.2 * wv[i]);
  o.add(g, 0, 1, -0.5);
  o.add(decor(g, sr), 0.03, 0.9, 0.5);
  const wh = mul(svf(white(n, r), sr, xenv(sr, n, [0, 1100, d * pk, 1700, d, 1200]), 14, 'bpn'), bell(n, pk, 2));
  o.addWide(wh, 0, 0.15, 0.6);
  o.add(mul(lp(brown(n, r), sr, 120), e), 0, 0.7);
  return o.clean().normalize(0.95);
};
function decor(x: Sig, sr: number): Sig { return svf(x, sr, 900, 0.5, 'notch'); }

export const kor_sky_transform: Recipe = ({ sr, r }) => {
  const d = 9;
  const o = new Out(sr, d);
  const n = secs(sr, d);
  const dr = zeros(n);
  for (const [m, g] of [[26, 1], [33, 0.7], [38, 0.5], [45, 0.3]] as const) for (const dt of [0.996, 1, 1.004]) addInto(dr, osc(sr, n, mtof(m) * dt, 'saw', r()), g * 0.2);
  const drone = mul(svf(dr, sr, xenv(sr, n, [0, 90, d * 0.5, 900, d, 250]), 2, 'lp'), env(sr, n, [0, 0, 2.5, 1, d * 0.8, 0.9, d, 0], 1.4));
  o.addWide(drone, 0, 0.8, 0.6);
  // swirling wind: two moving bandpasses in opposite channels
  const lfo = osc(sr, n, 0.35, 'sin');
  const fcL = zeros(n), fcR = zeros(n);
  for (let i = 0; i < n; i++) { fcL[i] = 700 * Math.pow(3, lfo[i]); fcR[i] = 700 * Math.pow(3, -lfo[i]); }
  const envW = env(sr, n, [0, 0, 3, 1, d, 0.2], 1.3);
  o.addSt(mul(svf(pink(n, r), sr, fcL, 3, 'bpn'), envW), mul(svf(pink(n, r), sr, fcR, 3, 'bpn'), envW), 0, 0.6);
  o.addWide(thunder(sr, r, 5, 0.8), rr(r, 1, 2), 0.35, 0.8);
  o.addWide(thunder(sr, r, 4, 0.9), rr(r, 4.5, 5.5), 0.25, 0.8);
  // rising shimmer of glass tones
  for (let k = 0; k < 16; k++) o.add(chime(sr, r, mtof(86 + [0, 2, 5, 7, 9, 12, 14][ri(r, 0, 6)]), 2.5, 1.2, 'glass'), 4.5 + k * 0.25, 0.1, rr(r, -0.8, 0.8));
  return o.clean().normalize(0.95);
};

export const kor_structure_rise: Recipe = ({ sr, r }) => {
  const d = 9;
  const o = new Out(sr, d);
  const n = secs(sr, d);
  const grind = lp(brown(n, r), sr, 220, 0.8);
  const gr = svf(dustSig(sr, n, r, env(sr, n, [0, 50, 3, 600, d, 300])), sr, 800, 1.2, 'bpn');
  addInto(grind, gr, 2.5);
  mul(grind, env(sr, n, [0, 0, 1.5, 1, d - 1, 1, d, 0], 1.3));
  o.addWide(grind, 0, 1, 0.7);
  for (let k = 0; k < 4; k++) o.addWide(creak(sr, r, rr(r, 1.2, 2), rr(r, 8, 14), rr(r, 5, 8), rr(r, 140, 260), 9), rr(r, 0.5, d - 2.5), 0.5, 0.5);
  o.addWide(metal(sr, r, rr(r, 70, 90), 4, 2.5, 0.7, 8), 2.0, 0.35, 0.4);
  const sub = mul(osc(sr, n, xenv(sr, n, [0, 24, d, 48]), 'sin'), env(sr, n, [0, 0, 2, 1, d - 0.5, 1, d, 0]));
  o.add(sub, 0, 0.7);
  o.addWide(debris(sr, r, d - 1, 10, 0), 1, 0.4, 0.9);
  return o.clean().normalize(0.95);
};
function dustSig(sr: number, n: number, r: Rng, rate: Sig): Sig {
  const o = zeros(n);
  for (let i = 0; i < n; i++) if (r() < rate[i] / sr) o[i] = rr(r, -1, 1);
  return o;
}

export const kor_portal_open: Recipe = ({ sr, r }) => {
  const d = 6.5;
  const o = new Out(sr, d);
  o.addWide(explosion(sr, r, 2.2, 2), 0, 0.8, 0.5);
  o.add(subBoom(sr, 80, 22, 3, 0.8), 0, 1);
  o.addWide(metal(sr, r, 310, 4, 1.8, 1, 10), 0, 0.3, 0.5);
  const n = secs(sr, d);
  const v = pink(n, r);
  const l1 = osc(sr, n, xenv(sr, n, [0, 0.4, d, 2.2]), 'sin');
  const l2 = osc(sr, n, xenv(sr, n, [0, 0.55, d, 2.9]), 'sin', 0.3);
  const base = xenv(sr, n, [0, 300, d, 1800]);
  const f1 = zeros(n), f2 = zeros(n);
  for (let i = 0; i < n; i++) { f1[i] = base[i] * Math.pow(2, l1[i]); f2[i] = base[i] * 1.6 * Math.pow(2, l2[i]); }
  const vx = env(sr, n, [0, 0, 0.8, 1, d - 1, 0.9, d, 0], 1.4);
  o.addSt(mul(svf(v, sr, f1, 4, 'bpn'), vx), mul(svf(v, sr, f2, 4, 'bpn'), vx), 0, 0.7);
  o.addWide(riser(sr, r, d * 0.7, 90, 360, 5, 200, 5000), 0.5, 0.4, 0.6);
  o.addWide(sparkle(sr, r, d - 1, 60, 2500, 9000, 1.4), 0.5, 0.25, 1);
  return o.clean().normalize(0.97);
};

type Mat = 'metal' | 'fire' | 'thunder' | 'crystal';
function knightMaterial(o: Out, sr: number, r: Rng, mat: Mat, at: number, sc: number, size: number): void {
  switch (mat) {
    case 'metal':
      o.addWide(metal(sr, r, 220 * sc, 3, 1.4, 1.1, 10), at, 0.6, 0.5);
      o.addWide(metal(sr, r, 900 * sc, 1.5, 0.5, 1.2, 8), at + 0.01, 0.3, 0.6);
      for (let k = 0; k < 6; k++) o.add(metal(sr, r, rr(r, 2500, 5000), 0.3, 0.05, 1, 5), at + rr(r, 0.02, 0.25), 0.1, rr(r, -0.7, 0.7));
      break;
    case 'fire': {
      const n = secs(sr, 1.8);
      o.addWide(mul(fireRoar(sr, r, 1.8, 2800, 0.8), env(sr, n, [0, 0, 0.02, 1, 1.8, 0], 2)), at, 0.8, 0.7);
      o.addWide(crackle(sr, r, 2, env(sr, secs(sr, 2), [0, 800, 2, 20]), 3000), at, 0.4, 0.8);
      break;
    }
    case 'thunder':
      o.addWide(thunder(sr, r, 3, 0.1), at - 0.02, 0.9, 0.6);
      o.addWide(zap(sr, r, 0.3, 3000 * sc, 200), at - 0.02, 0.3, 0.4);
      break;
    case 'crystal': {
      const root = 72 + Math.round(sc * 5);
      for (const iv of [0, 7, 12, 16, 19, 24]) o.add(chime(sr, r, mtof(root + iv), 2.5, 1.1, 'glass'), at + rr(r, 0, 0.05), 0.2, rr(r, -0.8, 0.8));
      o.addWide(sparkle(sr, r, 1.5, 40, 3000, 9000, 1.1), at, 0.3, 1);
      o.addWide(burst(sr, r, 0.2, 5000, 0.6, 0.0003, 0.03), at, 0.4, 0.5);
      break;
    }
  }
  void size;
}

export const kor_knight_arrive: Recipe = ({ sr, r, variant }) => {
  const v = ((variant % 13) + 13) % 13;
  const mats: Mat[] = ['metal', 'fire', 'thunder', 'crystal'];
  const mat = mats[v % 4];
  const size = 1 + v / 12 * 0.6;
  const sc = [1, 0.85, 1.15, 0.75, 1.3, 0.9, 1.05, 0.8, 1.2, 0.7, 1.1, 0.95, 0.6][v];
  const o = new Out(sr, 3.6);
  const pre = 0.55 + (v % 3) * 0.05;
  const dir = v % 2 ? 1 : -1;
  const wd = pre + 0.1;
  // descending teleport whoosh sweeping across the stereo field
  const n = secs(sr, wd);
  const ws = mul(svf(white(n, r), sr, xenv(sr, n, [0, 4500 * sc, wd, 350]), 1.3, 'bpn'), env(sr, n, [0, 0, wd * 0.85, 1, wd, 0.2], 2));
  const L = zeros(n), R = zeros(n);
  for (let i = 0; i < n; i++) { const u = i / n; const p = dir * (1 - 2 * u); L[i] = ws[i] * (0.5 - 0.5 * p); R[i] = ws[i] * (0.5 + 0.5 * p); }
  o.addSt(L, R, 0, 0.8);
  o.addWide(riser(sr, r, wd, 300 * sc, 90 * sc, 3, 3000, 400), 0, 0.2, 0.4);
  // landing
  o.add(thump(sr, 80 * sc, 28, 1.3, 0.22 * size, 0.6, r), pre, 1.1);
  o.addWide(explosion(sr, r, 1.4, size), pre, 0.45, 0.5);
  o.addWide(rockCrack(sr, r, 0.3, 1200 * sc), pre, 0.4, 0.5);
  if (v === 12) { for (const m of mats) knightMaterial(o, sr, r, m, pre, sc, size); o.add(subBoom(sr, 60, 18, 3, 0.9), pre, 1); }
  else knightMaterial(o, sr, r, mat, pre, sc, size);
  if (v % 3 === 2) o.addWide(debris(sr, r, 1.6, 30, 0.3), pre + 0.05, 0.3, 0.8);
  return o.clean().normalize(0.97);
};

/** Big blade whoosh + metallic shing + impact (reused by several slashes). */
function bladeHit(o: Out, sr: number, r: Rng, at: number, sc: number, weight: number): void {
  o.addWide(whoosh(sr, r, { dur: 0.45, f0: 200 * sc, f1: 300 * sc, fMid: 1600 * sc, q: 1, low: weight, tone: 0.5, peakAt: 0.7 }), at - 0.32, 0.8, 0.5);
  o.addWide(metal(sr, r, 1500 * sc, 1.6, 0.6, 1.3, 10), at, 0.45, 0.5);
  o.add(thump(sr, 90, 30, 0.9, 0.15 * weight, 0.5, r), at, 1);
  o.addWide(rockCrack(sr, r, 0.25, 1500), at, 0.5, 0.4);
}

export const kor_slash: Recipe = (p) => {
  const { sr, r } = p;
  const v = ((p.variant % 13) + 13) % 13;
  const o = new Out(sr, v === 12 ? 6 : 3.6);
  const t = 0.35;
  switch (v) {
    case 0: // heavy blade
      bladeHit(o, sr, r, t, 1, 1.4);
      o.add(subBoom(sr, 80, 26, 1.5, 0.4), t, 0.8);
      break;
    case 1: { // spear thrust
      const n = secs(sr, 0.3);
      const th = mul(svf(white(n, r), sr, xenv(sr, n, [0, 600, 0.3, 5000]), 2, 'bpn'), env(sr, n, [0, 0, 0.28, 1, 0.3, 0], 2.5));
      o.addWide(th, t - 0.3, 0.8, 0.3);
      o.add(thump(sr, 160, 50, 0.6, 0.08, 0.8, r), t, 0.9);
      o.add(burst(sr, r, 0.04, 3000, 1, 0.0002, 0.005), t, 0.8);
      o.addWide(metal(sr, r, 2400, 1.4, 0.7, 1.2, 8), t, 0.4, 0.3);
      o.addWide(whoosh(sr, r, { dur: 0.5, f0: 3000, f1: 400, fMid: 4000, q: 1.2, peakAt: 0.1 }), t, 0.35, 0.6);
      break;
    }
    case 2: // hammer quake
      o.addWide(whoosh(sr, r, { dur: 0.5, f0: 100, f1: 150, fMid: 450, q: 0.7, low: 1.8, peakAt: 0.8 }), t - 0.35, 0.7, 0.4);
      o.add(thump(sr, 60, 20, 2, 0.4, 0.7, r), t, 1.3);
      o.addWide(explosion(sr, r, 2, 2), t, 0.6, 0.5);
      o.addWide(rumble(sr, r, 3, 90, 5, 0.05, 0.3), t, 0.9, 0.5);
      o.addWide(debris(sr, r, 2.6, 40, 0.3), t + 0.1, 0.5, 0.9);
      break;
    case 3: { // twin blades flurry
      for (let k = 0; k < 7; k++) {
        const at = 0.05 + k * rr(r, 0.07, 0.1);
        o.add(whoosh(sr, r, { dur: 0.16, f0: 800, f1: 1100, fMid: rr(r, 2800, 3800), q: 1.4, peakAt: 0.6 }), at, 0.6, k % 2 ? 0.6 : -0.6);
        o.add(metal(sr, r, rr(r, 2200, 3200), 0.6, 0.2, 1.2, 7), at + 0.12, 0.25, k % 2 ? 0.5 : -0.5);
        o.add(thump(sr, 150, 60, 0.15, 0.03, 0.6, r), at + 0.12, 0.35);
      }
      o.addWide(metal(sr, r, 1800, 1.5, 0.6, 1.3, 10), 0.8, 0.4, 0.5);
      o.add(subBoom(sr, 90, 30, 1, 0.3), 0.8, 0.6);
      break;
    }
    case 4: { // fire eruption
      const fe = fire_explode(p);
      o.mix(fe, t, 1);
      o.addWide(mul(fireRoar(sr, r, 2.5, 2500, 0.9), env(sr, secs(sr, 2.5), [0, 0, 0.3, 1, 2.5, 0], 1.5)), t - 0.2, 0.6, 0.7);
      o.add(subBoom(sr, 70, 25, 2, 0.5), t, 0.7);
      break;
    }
    case 5: { // lightning
      const ts = thunder_strike(p);
      o.mix(ts, 0.05, 1);
      o.addWide(zap(sr, r, 0.6, 2500, 300), 0, 0.4, 0.6);
      break;
    }
    case 6: { // ice
      o.addWide(riser(sr, r, 0.4, 1200, 3200, 4, 2000, 9000), 0, 0.3, 0.6);
      o.mix(ice_shatter(p), t, 1);
      o.add(thump(sr, 120, 40, 0.8, 0.12, 0.5, r), t, 0.8);
      for (const m of [88, 95, 100]) o.add(chime(sr, r, mtof(m), 2, 1, 'glass'), t, 0.2, rr(r, -0.6, 0.6));
      break;
    }
    case 7: { // wind (tornado)
      const n = secs(sr, 3.2);
      const lfo = osc(sr, n, xenv(sr, n, [0, 1, 3.2, 5]), 'sin');
      const fcL = zeros(n), fcR = zeros(n);
      for (let i = 0; i < n; i++) { fcL[i] = 900 * Math.pow(2.5, lfo[i]); fcR[i] = 900 * Math.pow(2.5, -lfo[i]); }
      const e = env(sr, n, [0, 0, 0.5, 1, 2.4, 0.8, 3.2, 0], 1.3);
      o.addSt(mul(svf(pink(n, r), sr, fcL, 2, 'bpn'), e), mul(svf(pink(n, r), sr, fcR, 2, 'bpn'), e), 0, 1);
      o.add(mul(lp(brown(n, r), sr, 150), e), 0, 0.8);
      o.addWide(whoosh(sr, r, { dur: 1, f0: 200, f1: 300, fMid: 1200, q: 0.8, low: 1 }), 1.2, 0.6, 0.6);
      break;
    }
    case 8: { // holy light
      const n = secs(sr, 3);
      const ch = zeros(n);
      for (const m of [62, 69, 74, 78, 81, 86]) for (const dt of [0.996, 1.004]) addInto(ch, osc(sr, n, mtof(m) * dt, 'tri', r()), 0.1);
      mul(ch, env(sr, n, [0, 0, 0.3, 1, 1.5, 0.6, 3, 0], 1.5));
      o.addWide(lp(ch, sr, 5000), 0.05, 0.6, 0.7);
      o.addWide(whoosh(sr, r, { dur: 0.4, f0: 2000, f1: 5000, fMid: 7000, q: 1, peakAt: 0.9, bright: 1.5 }), 0, 0.5, 0.5);
      o.add(subBoom(sr, 100, 35, 1.5, 0.35), t, 0.8);
      o.addWide(metal(sr, r, 2600, 2.4, 1.2, 1, 8), t, 0.3, 0.6);
      o.addWide(sparkle(sr, r, 2.5, 70, 3000, 10000, 1.3), t, 0.4, 1);
      break;
    }
    case 9: { // dark void
      const n = secs(sr, 0.9);
      const suck = mul(svf(pink(n, r), sr, xenv(sr, n, [0, 4000, 0.9, 150]), 1.5, 'bpn'), env(sr, n, [0, 0, 0.85, 1, 0.9, 0], 2.5));
      o.addWide(suck, 0, 0.8, 0.6);
      const b = explosion(sr, r, 2.4, 2);
      drive(b, 2.5);
      o.addWide(lp(b, sr, 1500), 0.9, 0.8, 0.5);
      o.add(subBoom(sr, 50, 16, 2.5, 0.8), 0.9, 1.1);
      o.addWide(riser(sr, r, 1.5, 180, 60, 4, 2000, 200), 0.9, 0.3, 0.6);
      break;
    }
    case 10: // axe
      o.addWide(whoosh(sr, r, { dur: 0.5, f0: 150, f1: 220, fMid: 900, q: 0.9, low: 1.4, tone: 0.8, peakAt: 0.75 }), t - 0.35, 0.8, 0.4);
      o.add(thump(sr, 110, 35, 1, 0.14, 0.6, r), t, 1.1);
      o.addWide(crunch(sr, r, 0.5, 1000, 3000, 0.3), t, 0.7, 0.5);
      o.addWide(rockCrack(sr, r, 0.4, 900), t, 0.7, 0.5);
      o.addWide(metal(sr, r, 700, 1.2, 0.4, 0.9, 8), t, 0.3, 0.3);
      break;
    case 11: { // arrow volley
      for (let k = 0; k < 16; k++) {
        const at = rr(r, 0, 0.6);
        const nd = secs(sr, 0.35);
        const f0 = rr(r, 1800, 3500);
        const w = mul(osc(sr, nd, xenv(sr, nd, [0, f0, 0.35, f0 * 0.6]), 'sin'), bell(nd, 0.6, 2));
        addInto(w, mul(svf(white(nd, r), sr, f0 * 1.5, 3, 'bpn'), bell(nd, 0.6, 2)), 0.6);
        const pan = rr(r, -1, 1);
        o.add(w, at, 0.15, pan);
        o.add(thump(sr, 180, 80, 0.12, 0.02, 0.8, r), at + 0.35, 0.3, pan);
        o.add(clack(sr, r, rr(r, 900, 1600), 0.06), at + 0.35, 0.2, pan);
      }
      o.addWide(debris(sr, r, 1.5, 20, 0.2), 0.7, 0.3, 0.9);
      break;
    }
    case 12: { // final colossal
      o.addWide(whoosh(sr, r, { dur: 1.2, f0: 80, f1: 140, fMid: 700, q: 0.6, low: 2, tone: 1, peakAt: 0.85, pow: 1.3 }), 0, 0.9, 0.6);
      const at = 1.0;
      o.add(thump(sr, 55, 18, 3, 0.6, 0.8, r), at, 1.3);
      o.addWide(explosion(sr, r, 3.5, 3), at, 0.8, 0.6);
      o.addWide(metal(sr, r, 180, 4, 2, 1.2, 10), at, 0.4, 0.5);
      o.addWide(thunder(sr, r, 4, 0.05), at, 0.6, 0.6);
      o.addWide(debris(sr, r, 4, 40, 0.8), at + 0.1, 0.5, 0.9);
      break;
    }
  }
  return o.clean().normalize(0.97);
};

export const kor_impact_big: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 3.8);
  o.add(thump(sr, 65, 22, 2, 0.35, 0.8, r), 0, 1.2);
  o.addWide(explosion(sr, r, 2.8, 2.5), 0, 0.8, 0.5);
  o.addWide(rockCrack(sr, r, 0.4, 1200), 0, 0.6, 0.5);
  o.addWide(debris(sr, r, 3, 40, 0.6), 0.1, 0.5, 0.9);
  o.addWide(metal(sr, r, 140, 3, 1.5, 0.8, 8), 0, 0.25, 0.4);
  return o.clean().normalize(0.98);
};

export const kor_lightning: Recipe = (p) => {
  const { sr, r } = p;
  const o = new Out(sr, 7.5);
  o.mix(thunder_strike(p), 0, 1);
  o.addWide(zap(sr, r, 0.25, 3500, 400), 0.6, 0.4, 0.8);
  o.addWide(thunder(sr, r, 5, 0.25), 0.7, 0.6, 0.7);
  o.addWide(zap(sr, r, 0.2, 3000, 300), 1.2, 0.3, 0.8);
  o.add(subBoom(sr, 60, 20, 3, 0.8), 0, 0.9);
  return o.clean().normalize(0.98);
};

export const kor_fire: Recipe = (p) => {
  const { sr, r } = p;
  const o = new Out(sr, 5);
  o.addWide(whoosh(sr, r, { dur: 0.6, f0: 200, f1: 900, fMid: 1600, q: 0.7, low: 1, peakAt: 0.9 }), 0, 0.6, 0.5);
  o.mix(fire_explode(p), 0.5, 1);
  const n = secs(sr, 3.5);
  o.addWide(mul(fireRoar(sr, r, 3.5, 2200, 0.9), env(sr, n, [0, 0, 0.2, 1, 2.2, 0.7, 3.5, 0], 1.5)), 0.5, 0.8, 0.8);
  o.add(subBoom(sr, 70, 22, 2.5, 0.6), 0.5, 0.9);
  return o.clean().normalize(0.98);
};

export const kor_ice: Recipe = (p) => {
  const { sr, r } = p;
  const o = new Out(sr, 4.5);
  o.addWide(creak(sr, r, 1.5, 60, 260, 2500, 14), 0, 0.6, 0.5);
  for (let k = 0; k < 20; k++) o.add(clack(sr, r, rr(r, 2500, 8000), 0.05), k * 0.065, 0.3, rr(r, -0.8, 0.8));
  o.addWide(riser(sr, r, 1.4, 700, 2600, 4, 1500, 9000), 0, 0.3, 0.5);
  o.mix(ice_shatter(p), 1.4, 1);
  o.add(thump(sr, 100, 30, 1.5, 0.25, 0.5, r), 1.4, 1);
  o.add(subBoom(sr, 75, 24, 2, 0.5), 1.4, 0.7);
  for (const m of [81, 88, 93, 100]) o.add(chime(sr, r, mtof(m), 2.5, 1.2, 'glass'), 1.42, 0.2, rr(r, -0.6, 0.6));
  return o.clean().normalize(0.98);
};

export const kor_final_charge: Recipe = ({ sr, r }) => {
  const d = 6.3;
  const o = new Out(sr, d + 0.1);
  const n = secs(sr, d);
  const target = mtof(57); // A3 unison
  const starts = [45, 70, 110, 180, 320, 520, 880, 1300];
  const mix = zeros(n);
  starts.forEach((f0, k) => {
    const mult = [0.5, 1, 1, 2, 2, 3, 4, 6][k];
    const f = zeros(n);
    for (let i = 0; i < n; i++) { const u = Math.pow(i / n, 1.8); f[i] = f0 * Math.pow((target * mult) / f0, u); }
    addInto(mix, osc(sr, n, f, k % 2 ? 'saw' : 'sqr', r()), 0.13);
  });
  const trem = osc(sr, n, xenv(sr, n, [0, 3, d, 32]), 'sin');
  for (let i = 0; i < n; i++) mix[i] *= 0.65 + 0.35 * trem[i];
  const conv = mul(svf(mix, sr, xenv(sr, n, [0, 300, d, 9000]), 1.6, 'lp'), env(sr, n, [0, 0, d * 0.97, 1, d, 0.2], 1.8));
  o.addWide(conv, 0, 0.7, 0.7);
  const ns = mul(svf(white(n, r), sr, xenv(sr, n, [0, 300, d, 9000]), 1.8, 'bpn'), env(sr, n, [0, 0, d * 0.97, 1, d, 0], 2.4));
  o.addWide(ns, 0, 0.6, 0.9);
  const sub = mul(osc(sr, n, xenv(sr, n, [0, 25, d, 58]), 'sin'), env(sr, n, [0, 0, d * 0.95, 1, d, 0], 1.2));
  o.add(sub, 0, 0.9);
  o.addWide(sparkle(sr, r, d, 90, 2500, 5000, 2.2), d * 0.3, 0.2, 1);
  return o.clean().normalize(0.97);
};

export const kor_final_impact: Recipe = ({ sr, r }) => {
  const d = 14;
  const o = new Out(sr, d);
  // sub drop
  const ns = secs(sr, 5);
  const sub = mul(osc(sr, ns, xenv(sr, ns, [0, 75, 0.4, 42, 3, 18, 5, 15]), 'sin'), env(sr, ns, [0, 0, 0.003, 1, 1, 0.8, 5, 0], 1.6));
  o.add(sub, 0, 1.2);
  // layered booms
  o.addWide(explosion(sr, r, 4, 3.5), 0, 0.9, 0.6);
  o.addWide(explosion(sr, r, 3.5, 3), 0.025, 0.6, 0.8);
  o.add(thump(sr, 55, 17, 4, 0.9, 1, r), 0, 1.1);
  o.addWide(thunder(sr, r, 7, 0.0), 0, 0.7, 0.7);
  const nb = secs(sr, 1.2);
  const mid = mul(svf(white(nb, r), sr, 1400, 0.6, 'bpn'), env(sr, nb, [0, 0, 0.003, 1, 0.2, 0.4, 1.2, 0], 2));
  drive(mid, 3);
  o.addWide(mid, 0, 0.6, 0.6);
  o.addWide(metal(sr, r, 85, 7, 3.5, 0.8, 10), 0, 0.3, 0.5);
  // long tail
  o.addWide(rumble(sr, r, d - 0.5, 80, 1.5, 0.3, 0.4), 0.2, 1.1, 0.7);
  o.addWide(debris(sr, r, d - 2.5, 22, 0.2), 1.5, 0.5, 1);
  const nw = secs(sr, d - 3);
  const wind = mul(svf(pink(nw, r), sr, 600, 0.8, 'bpn'), env(sr, nw, [0, 0, 2, 1, d - 3, 0], 1.4));
  o.addWide(wind, 2.5, 0.25, 0.9);
  o.normalize(1); drive(o.L, 1.9); drive(o.R, 1.9);
  return o.clean().normalize(0.99);
};

export const aftermath_debris: Recipe = ({ sr, r }) => {
  const d = 7;
  const o = new Out(sr, d);
  o.addWide(debris(sr, r, d, 11, 0.15, 0.9), 0, 0.8, 1);
  o.addWide(crackle(sr, r, d, env(sr, secs(sr, d), [0, 40, d, 15]), 3000), 0, 0.35, 0.9);
  for (let k = 0; k < 14; k++) o.add(chime(sr, r, rr(r, 3000, 8000), 0.8, rr(r, 0.1, 0.4), 'glass'), rr(r, 0.3, d - 1), rr(r, 0.05, 0.15), rr(r, -1, 1));
  return o.clean().normalize(0.9);
};

export const aftermath_wind: Recipe = ({ sr, r }) => {
  const d = 9;
  const o = new Out(sr, d);
  const n = secs(sr, d);
  const w = svf(pink(n, r), sr, xenv(sr, n, [0, 400, d * 0.5, 700, d, 450]), 0.8, 'bpn');
  const wv = wander(sr, n, 0.8, r);
  const e = env(sr, n, [0, 0, 2, 1, d - 2.5, 0.8, d, 0], 1.4);
  for (let i = 0; i < n; i++) w[i] *= e[i] * (0.7 + 0.3 * wv[i]);
  o.addWide(w, 0, 1, 0.9);
  const wh = mul(svf(white(n, r), sr, xenv(sr, n, [0, 1300, d, 1600]), 16, 'bpn'), e);
  o.addWide(wh, 0, 0.08, 0.6);
  return o.clean().normalize(0.9);
};

export const thunder_distant: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 7.5);
  o.addWide(thunder(sr, r, 7.2, rr(r, 0.75, 0.92)), 0, 1, 0.8);
  return o.clean().normalize(0.95);
};

export { hp, norm, scale, splash, ad };
export type { RP };
